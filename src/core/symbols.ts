// 코드 편집기 기호 빠른 이동(Ctrl+Shift+O)용 기호 추출: JS(Script·공통), Java, XML(MyBatis·WebSquare), CSS
import { parse, type Options as AcornOptions } from 'acorn';
import { parse as parseLoose } from 'acorn-loose';
import { parser as javaParser } from '@lezer/java';
import { parser as cssParser } from '@lezer/css';
import type { SyntaxNode } from '@lezer/common';

export type SymbolKind = 'class' | 'interface' | 'method' | 'function' | 'sql' | 'tag';
export type SymbolLang = 'js' | 'java' | 'xml' | 'css';

export interface CodeSymbol {
	name: string;
	kind: SymbolKind;
	/** 이름 글자 시작·끝 위치(문서 offset) */
	from: number;
	to: number;
	/** 1부터 시작하는 줄 번호 */
	line: number;
	/** 부가 구분(select·insert·클래스명·태그명 등) */
	detail?: string;
}

const blank = (s: string) => s.replace(/[^\n]/g, ' ');
const JS_OPTIONS: AcornOptions = {
	ecmaVersion: 'latest',
	sourceType: 'script',
	allowReturnOutsideFunction: true,
	allowAwaitOutsideFunction: true,
	allowHashBang: true,
};
/** acorn-loose가 빠진 식별자 자리에 넣는 자리표시자 */
const DUMMY_ID = '✖';

/** 줄 시작 offset 표를 한 번 만들어 이진 탐색으로 줄 번호(1부터)를 구한다 */
function lineFinder(text: string): (offset: number) => number {
	const starts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10) { starts.push(i + 1); }
	}
	return offset => {
		let lo = 0, hi = starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (starts[mid] <= offset) { lo = mid; } else { hi = mid - 1; }
		}
		return lo + 1;
	};
}

interface JsNode {
	type: string;
	start?: number;
	end?: number;
	[key: string]: unknown;
}

const isFuncNode = (n: JsNode | undefined) => !!n && (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');
const validId = (n: JsNode | undefined): n is JsNode & { name: string; start: number; end: number } =>
	!!n && n.type === 'Identifier' && typeof n.name === 'string' && n.name !== '' && n.name !== DUMMY_ID
	&& typeof n.start === 'number' && typeof n.end === 'number' && n.start < n.end;

function memberName(node: JsNode): { name: string; from: number; to: number; detail?: string } | undefined {
	if (node.type !== 'MemberExpression' || node.computed) { return undefined; }
	const prop = node.property as JsNode, obj = node.object as JsNode;
	if (!validId(prop)) { return undefined; }
	if (validId(obj)) {
		return { name: `${obj.name}.${prop.name}`, from: prop.start, to: prop.end, detail: obj.name };
	}
	if (obj?.type === 'MemberExpression') {
		const parent = memberName(obj);
		if (parent) {
			return { name: `${parent.name}.${prop.name}`, from: prop.start, to: prop.end, detail: parent.name };
		}
	}
	return undefined;
}

/** JS·Script 기호: `scwin.*` 대입, 함수 선언·함수 변수, 클래스와 메서드. 문법 오류 시 acorn-loose로 복구 */
function extractJsSymbols(text: string): CodeSymbol[] {
	const lineOf = lineFinder(text);
	const out: CodeSymbol[] = [];
	const push = (name: string, kind: SymbolKind, from: number, to: number, detail?: string) => {
		out.push({ name, kind, from, to, line: lineOf(from), ...detail ? { detail } : {} });
	};
	let ast: JsNode;
	try {
		ast = parse(text, JS_OPTIONS) as unknown as JsNode;
	} catch {
		ast = parseLoose(text, JS_OPTIONS) as unknown as JsNode;
	}
	const walk = (node: JsNode, owner?: string) => {
		if (node.type === 'FunctionDeclaration') {
			const id = node.id as JsNode | undefined;
			if (validId(id)) {
				push(id.name, 'function', id.start, id.end, owner);
			}
		} else if (node.type === 'ClassDeclaration') {
			const id = node.id as JsNode | undefined;
			if (validId(id)) {
				push(id.name, 'class', id.start, id.end, owner);
				const body = (node.body as JsNode | undefined)?.body;
				if (Array.isArray(body)) {
					for (const item of body as JsNode[]) {
						if (item.type === 'MethodDefinition') {
							const key = item.key as JsNode;
							if (validId(key)) {
								push(key.name, 'method', key.start, key.end, id.name);
							}
						}
					}
				}
				return;
			}
		} else if (node.type === 'VariableDeclarator') {
			const id = node.id as JsNode, init = node.init as JsNode | undefined;
			if (validId(id) && isFuncNode(init)) {
				push(id.name, 'function', id.start, id.end, owner);
			}
		} else if (node.type === 'AssignmentExpression') {
			const left = node.left as JsNode, right = node.right as JsNode;
			const mem = memberName(left);
			if (mem && (mem.detail === 'scwin' || isFuncNode(right))) {
				push(mem.name, 'function', mem.from, mem.to, mem.detail);
			}
		}
		for (const [k, v] of Object.entries(node)) {
			if (k === 'body' && isFuncNode(node)) { continue; }
			for (const child of Array.isArray(v) ? v : [v]) {
				if (child && typeof child === 'object' && typeof (child as JsNode).type === 'string') {
					walk(child as JsNode, owner);
				}
			}
		}
	};
	walk(ast);
	return out;
}

const JAVA_TYPES = new Set(['ClassDeclaration', 'InterfaceDeclaration', 'EnumDeclaration', 'RecordDeclaration']);
const JAVA_METHODS = new Set(['MethodDeclaration', 'ConstructorDeclaration', 'CompactConstructorDeclaration']);

/** Java 기호(@lezer/java CST): 클래스·인터페이스·열거형·레코드와 본문 안 메서드·생성자 선언 */
function extractJavaSymbols(text: string): CodeSymbol[] {
	const lineOf = lineFinder(text);
	const out: CodeSymbol[] = [];
	const walk = (node: SyntaxNode, owner?: string) => {
		if (JAVA_TYPES.has(node.name)) {
			const def = node.getChild('Definition');
			if (def) {
				const name = text.slice(def.from, def.to);
				const kind: SymbolKind = node.name === 'InterfaceDeclaration' ? 'interface' : 'class';
				out.push({ name, kind, from: def.from, to: def.to, line: lineOf(def.from), ...owner ? { detail: owner } : {} });
				for (let child = node.firstChild; child; child = child.nextSibling) {
					walk(child, name);
				}
				return;
			}
		} else if (JAVA_METHODS.has(node.name)) {
			const def = node.getChild('Definition');
			if (def) {
				out.push({ name: text.slice(def.from, def.to), kind: 'method', from: def.from, to: def.to, line: lineOf(def.from), ...owner ? { detail: owner } : {} });
			}
			// 메서드 본문(Block) 안 지역 선언·호출은 건너뛴다
			return;
		} else if (node.name === 'Block' || node.name === 'FieldDeclaration') {
			return;
		}
		for (let child = node.firstChild; child; child = child.nextSibling) {
			walk(child, owner);
		}
	};
	walk(javaParser.parse(text).topNode);
	return out;
}

const MYBATIS_STMT = /<(select|insert|update|delete|sql|resultMap|parameterMap)\b[^>]*?\bid\s*=\s*(["'])([^"']+)\2/g;
const XML_ID_TAG = /<([A-Za-z_][\w:.-]*)\b[^>]*?\bid\s*=\s*(["'])([^"']+)\2/g;

/** XML 기호: MyBatis 매퍼는 namespace·SQL/resultMap id, 일반(WebSquare 화면) XML은 id 있는 요소 */
function extractXmlSymbols(text: string): CodeSymbol[] {
	const cleaned = text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, blank);
	const lineOf = lineFinder(text);
	const out: CodeSymbol[] = [];
	const ns = /<mapper\b[^>]*?\bnamespace\s*=\s*(["'])([^"']+)\1/.exec(cleaned);
	if (ns) {
		const from = ns.index + ns[0].length - 1 - ns[2].length;
		out.push({ name: ns[2], kind: 'interface', from, to: from + ns[2].length, line: lineOf(from), detail: 'mapper' });
		for (const m of cleaned.matchAll(MYBATIS_STMT)) {
			const fromId = m.index + m[0].length - 1 - m[3].length;
			out.push({ name: m[3], kind: 'sql', from: fromId, to: fromId + m[3].length, line: lineOf(fromId), detail: m[1] });
		}
		return out;
	}
	for (const m of cleaned.matchAll(XML_ID_TAG)) {
		const fromId = m.index + m[0].length - 1 - m[3].length;
		out.push({ name: m[3], kind: 'tag', from: fromId, to: fromId + m[3].length, line: lineOf(fromId), detail: m[1] });
	}
	return out;
}

/** CSS 기호(@lezer/css CST): 최상위 및 @media·@supports 안 선택자와 @keyframes */
function extractCssSymbols(text: string): CodeSymbol[] {
	const lineOf = lineFinder(text);
	const out: CodeSymbol[] = [];
	const pushHeader = (node: SyntaxNode, block: SyntaxNode, detail: string) => {
		const raw = text.slice(node.from, block.from).replace(/\/\*[\s\S]*?\*\//g, ' ');
		const lead = raw.length - raw.trimStart().length;
		const name = raw.trim().replace(/\s+/g, ' ');
		if (!name) { return; }
		const from = node.from + lead;
		out.push({ name, kind: 'tag', from, to: from + Math.min(name.length, block.from - from), line: lineOf(from), detail });
	};
	const walk = (node: SyntaxNode, context = 'css') => {
		if (node.name === 'RuleSet') {
			const block = node.getChild('Block');
			if (block) {
				pushHeader(node, block, context);
				// 중첩 CSS 규칙(CSS Nesting) 탐색
				for (let child = block.firstChild; child; child = child.nextSibling) {
					if (child.name === 'RuleSet' || child.name.endsWith('Statement')) { walk(child, context); }
				}
			}
			return;
		}
		if (node.name === 'KeyframesStatement') {
			const block = node.getChild('KeyframeList') ?? node.getChild('Block');
			if (block) { pushHeader(node, block, '@keyframes'); }
			return;
		}
		if (node.name === 'MediaStatement' || node.name === 'SupportsStatement' || node.name === 'LayerStatement' || node.name === 'AtRule') {
			const block = node.getChild('Block');
			if (block) {
				const kw = node.firstChild ? text.slice(node.firstChild.from, node.firstChild.to).trim() : 'css';
				for (let child = block.firstChild; child; child = child.nextSibling) {
					walk(child, kw || context);
				}
			}
			return;
		}
		for (let child = node.firstChild; child; child = child.nextSibling) {
			walk(child, context);
		}
	};
	walk(cssParser.parse(text).topNode);
	return out;
}

/** 언어별 기호 목록(문서 순서대로) */
export function extractSymbols(text: string, lang: SymbolLang): CodeSymbol[] {
	if (!text.trim()) { return []; }
	switch (lang) {
		case 'js': return extractJsSymbols(text);
		case 'java': return extractJavaSymbols(text);
		case 'xml': return extractXmlSymbols(text);
		case 'css': return extractCssSymbols(text);
	}
}
