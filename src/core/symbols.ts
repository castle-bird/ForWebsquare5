// 코드 편집기 기호 빠른 이동(Ctrl+Shift+O)용 기호 추출: JS(Script·공통), Java, XML(MyBatis·WebSquare), CSS
import { parse } from 'acorn';
import { blankComments } from './actionMapping';

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

function memberName(node: JsNode): { name: string; from: number; to: number; detail?: string } | undefined {
	if (node.type !== 'MemberExpression' || node.computed) { return undefined; }
	const prop = node.property as JsNode, obj = node.object as JsNode;
	if (prop?.type !== 'Identifier' || typeof prop.name !== 'string' || prop.start === undefined || prop.end === undefined) { return undefined; }
	if (obj?.type === 'Identifier' && typeof obj.name === 'string') {
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

/** JS·Script 기호: `scwin.*` 대입, 함수 선언·함수 변수, 클래스와 메서드. 문법 오류 시 정규식 폴백 */
function extractJsSymbols(text: string): CodeSymbol[] {
	const lineOf = lineFinder(text);
	const out: CodeSymbol[] = [];
	const push = (name: string, kind: SymbolKind, from: number, to: number, detail?: string) => {
		out.push({ name, kind, from, to, line: lineOf(from), ...detail ? { detail } : {} });
	};
	try {
		const ast = parse(text, {
			ecmaVersion: 'latest',
			sourceType: 'script',
			allowReturnOutsideFunction: true,
			allowAwaitOutsideFunction: true,
			allowHashBang: true,
		}) as unknown as JsNode;
		const walk = (node: JsNode, owner?: string) => {
			if (node.type === 'FunctionDeclaration') {
				const id = node.id as JsNode | undefined;
				if (id?.type === 'Identifier' && typeof id.name === 'string' && id.start !== undefined && id.end !== undefined) {
					push(id.name, 'function', id.start, id.end, owner);
				}
			} else if (node.type === 'ClassDeclaration') {
				const id = node.id as JsNode | undefined;
				if (id?.type === 'Identifier' && typeof id.name === 'string' && id.start !== undefined && id.end !== undefined) {
					push(id.name, 'class', id.start, id.end, owner);
					const body = (node.body as JsNode | undefined)?.body;
					if (Array.isArray(body)) {
						for (const item of body as JsNode[]) {
							if (item.type === 'MethodDefinition') {
								const key = item.key as JsNode;
								if (key?.type === 'Identifier' && typeof key.name === 'string' && key.start !== undefined && key.end !== undefined) {
									push(key.name, 'method', key.start, key.end, id.name);
								}
							}
						}
					}
					return;
				}
			} else if (node.type === 'VariableDeclarator') {
				const id = node.id as JsNode, init = node.init as JsNode | undefined;
				if (id?.type === 'Identifier' && typeof id.name === 'string' && id.start !== undefined && id.end !== undefined && isFuncNode(init)) {
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
	} catch {
		const cleaned = blankComments(text).replace(/`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, blank);
		const seen = new Set<number>();
		for (const m of cleaned.matchAll(/\b(scwin)\.([A-Za-z_$][\w$]*)\s*=/g)) {
			const from = m.index + m[1].length + 1;
			if (!seen.has(from)) { seen.add(from); push(`${m[1]}.${m[2]}`, 'function', from, from + m[2].length, m[1]); }
		}
		for (const m of cleaned.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
			const from = m.index + m[0].indexOf(m[1]);
			if (!seen.has(from)) { seen.add(from); push(m[1], 'function', from, from + m[1].length); }
		}
		return out.sort((a, b) => a.from - b.from);
	}
}

const JAVA_CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'throw', 'assert', 'synchronized', 'super', 'this', 'yield']);

/** Java 기호: 클래스·인터페이스·열거형·레코드와 본문 안 메서드·생성자 선언 */
function extractJavaSymbols(text: string): CodeSymbol[] {
	const cleaned = blankComments(text).replace(/"""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, blank);
	const lineOf = lineFinder(text);
	const out: CodeSymbol[] = [];
	const typeStack: { name: string; depth: number }[] = [];
	const word = /[A-Za-z_$][\w$]*/y;
	let braces = 0, parens = 0;
	let pendingType: { name: string; kind: SymbolKind; from: number; to: number } | undefined;

	for (let i = 0; i < cleaned.length; i++) {
		const c = cleaned[i];
		if (c === '{') {
			braces++;
			if (pendingType) {
				typeStack.push({ name: pendingType.name, depth: braces });
				pendingType = undefined;
			}
		} else if (c === '}') {
			if (typeStack.at(-1)?.depth === braces) { typeStack.pop(); }
			braces = Math.max(0, braces - 1);
		} else if (c === '(') {
			parens++;
		} else if (c === ')') {
			parens = Math.max(0, parens - 1);
		} else if (parens === 0 && /[A-Za-z_$]/.test(c)) {
			word.lastIndex = i;
			const m = word.exec(cleaned)!;
			const token = m[0];
			const after = i + token.length;
			let prev = i - 1;
			while (prev >= 0 && /\s/.test(cleaned[prev])) { prev--; }
			const prevCh = prev >= 0 ? cleaned[prev] : '';

			if ((token === 'class' || token === 'interface' || token === 'enum' || token === 'record') && prevCh !== '.' && prevCh !== '@') {
				const next = /^\s+([A-Za-z_$][\w$]*)/.exec(cleaned.slice(after));
				if (next) {
					const name = next[1];
					const from = after + next[0].length - name.length;
					const kind: SymbolKind = token === 'interface' ? 'interface' : 'class';
					out.push({ name, kind, from, to: from + name.length, line: lineOf(from), ...typeStack.length ? { detail: typeStack.at(-1)!.name } : {} });
					pendingType = { name, kind, from, to: from + name.length };
					i = from + name.length - 1;
					continue;
				}
			} else if (typeStack.length && braces === typeStack.at(-1)!.depth && !JAVA_CONTROL.has(token) && prevCh !== '@' && prevCh !== '.' && prevCh !== '=') {
				let j = after;
				while (j < cleaned.length && /\s/.test(cleaned[j])) { j++; }
				if (cleaned[j] === '(') {
					// 괄호 닫힌 뒤 `{`, `;`, `throws`가 이어지면 메서드·생성자 선언(필드 초기화 호출은 제외)
					let p = 1, k = j + 1;
					while (k < cleaned.length && p > 0) {
						if (cleaned[k] === '(') { p++; } else if (cleaned[k] === ')') { p--; }
						k++;
					}
					const tail = cleaned.slice(k, k + 200);
					if (/^\s*(?:\{|;|throws\b|default\b)/.test(tail)) {
						out.push({ name: token, kind: 'method', from: i, to: after, line: lineOf(i), detail: typeStack.at(-1)!.name });
					}
				}
			}
			i = after - 1;
		}
	}
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

/** CSS 기호: 최상위 선택자·@규칙 */
function extractCssSymbols(text: string): CodeSymbol[] {
	const cleaned = text.replace(/\/\*[\s\S]*?\*\//g, blank);
	const lineOf = lineFinder(text);
	const out: CodeSymbol[] = [];
	let depth = 0, start = 0;
	for (let i = 0; i < cleaned.length; i++) {
		const c = cleaned[i];
		if (c === '{') {
			if (depth === 0) {
				const raw = cleaned.slice(start, i);
				const lead = raw.length - raw.trimStart().length;
				const name = raw.trim().replace(/\s+/g, ' ');
				if (name) {
					const from = start + lead;
					out.push({ name, kind: 'tag', from, to: from + Math.min(name.length, i - from), line: lineOf(from), detail: 'css' });
				}
			}
			depth++;
		} else if (c === '}') {
			depth = Math.max(0, depth - 1);
			if (depth === 0) { start = i + 1; }
		} else if (c === ';' && depth === 0) {
			start = i + 1;
		}
	}
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
