// 컴포넌트·데이터 id를 바꿀 때 Script와 이벤트 핸들러도 같이 바꾼다. 글자 바꾸기가 아니라 JS 문법(acorn)으로 그 id를 가리키는 자리만:
// - 변수로 쓰는 id(`btnSave.setValue()`). 속성 이름(`a.btnSave`)·객체 키·문자열·주석·더 긴 이름(`btnSave2`, `%btnSave%`)은 그대로
// - `getComponentById('btnSave')`의 첫 인자 문자열
// - 그 컴포넌트에 걸린 핸들러 `scwin.btnSave_onclick` → `scwin.btnNew_onclick`(이벤트 속성 값과 Script의 정의·호출)
import { parse } from 'acorn';
import { scriptBody, type TextEdit } from './edit';
import { EV, type XmlNode } from './xmlModel';

export interface IdRenameResult {
	/** Script 본문 편집(화면 XML 원문 기준) */
	script: TextEdit[];
	/** 노드마다 바꿀 이벤트 속성(핸들러 이름) */
	attrs: Map<XmlNode, [string, string][]>;
	/** 알림에 붙일 줄(바꾼 것·건너뛴 이유) */
	notes: string[];
}

interface Node { type: string; start: number; end: number; [key: string]: unknown }

const IDENT = /^[A-Za-z_$][\w$]*$/;
const handlerOf = (value: string) => /^scwin\.([\w$]+)$/.exec(value.trim())?.[1];

/** 바인딩 이름이 생기는 자리(선언·파라미터): 여기 있는 이름이면 그 id 변수를 가린다 */
function bindingNames(parent: Node, key: string): boolean {
	return (parent.type === 'VariableDeclarator' && key === 'id')
		|| (/^(FunctionDeclaration|FunctionExpression|ClassDeclaration|ClassExpression)$/.test(parent.type) && key === 'id')
		|| (/Function/.test(parent.type) && key === 'params')
		|| (parent.type === 'CatchClause' && key === 'param')
		|| (parent.type === 'AssignmentPattern' && key === 'left');
}

/** 이름(Identifier)이 변수 읽기·쓰기 자리가 아니면 true: 속성 이름·키·라벨 */
function notVariable(parent: Node, key: string): boolean {
	return (parent.type === 'MemberExpression' && key === 'property' && !parent.computed)
		|| (/^(Property|MethodDefinition|PropertyDefinition)$/.test(parent.type) && key === 'key' && !parent.computed)
		|| (parent.type === 'Property' && !!parent.shorthand)
		|| /^(LabeledStatement|BreakStatement|ContinueStatement)$/.test(parent.type)
		|| /^(ImportSpecifier|ExportSpecifier|MetaProperty)$/.test(parent.type);
}

function walk(node: Node, visit: (node: Node, parent: Node | undefined, key: string) => void, parent?: Node, key = '') {
	visit(node, parent, key);
	for (const [k, v] of Object.entries(node)) {
		for (const child of Array.isArray(v) ? v : [v]) {
			if (child && typeof child === 'object' && typeof (child as Node).type === 'string') { walk(child as Node, visit, node, k); }
		}
	}
}

/**
 * node의 id를 from → to로 바꿀 때 함께 바꿀 Script·이벤트 속성. handlers가 false면(데이터 등) 핸들러 이름은 안 바꾼다.
 * Script가 없거나 고칠 수 없는 모양·문법 오류면 Script와 핸들러는 그대로 두고 이유를 notes에
 */
export function renameIdRefs(text: string, root: XmlNode, node: XmlNode, from: string, to: string, handlers = true): IdRenameResult {
	const result: IdRenameResult = { script: [], attrs: new Map(), notes: [] };
	const body = scriptBody(text, root);
	// 원문 글자 자리 = Script 글자 자리(+시작)여야 고칠 수 있다(문자 참조·나뉜 CDATA가 없을 때)
	if (typeof body !== 'object' || text.slice(body.start, body.end) !== body.text) { return result; }
	let ast: Node;
	try {
		ast = parse(body.text, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowHashBang: true }) as unknown as Node;
	} catch {
		result.notes.push('Script에 문법 오류가 있어 Script·핸들러는 바꾸지 않았습니다.');
		return result;
	}
	// 이 컴포넌트에 걸린 `scwin.{from}_…` 핸들러 → 새 이름
	const renames = new Map<string, string>();
	if (handlers) {
		for (const [name, value] of Object.entries(node.attrs)) {
			const handler = name.startsWith(EV) ? handlerOf(value) : undefined;
			if (handler?.startsWith(`${from}_`)) { renames.set(handler, `${to}${handler.slice(from.length)}`); }
		}
	}
	const declared = new Set<string>(), defined = new Set<string>();
	const refs: Node[] = [], strings: Node[] = [], members: Node[] = [];
	walk(ast, (n, parent, key) => {
		if (n.type === 'Identifier' && parent) {
			const name = n.name as string;
			if (bindingNames(parent, key)) { declared.add(name); }
			if (name === from && !notVariable(parent, key) && !bindingNames(parent, key)) { refs.push(n); }
		} else if (n.type === 'Literal' && n.value === from && parent?.type === 'CallExpression' && key === 'arguments' && (parent.arguments as Node[])[0] === n) {
			const callee = parent.callee as Node;
			const name = callee.type === 'MemberExpression' && !callee.computed ? (callee.property as Node).name : callee.type === 'Identifier' ? callee.name : undefined;
			if (name === 'getComponentById') { strings.push(n); }
		} else if (n.type === 'MemberExpression' && !n.computed && (n.object as Node).type === 'Identifier' && (n.object as Node).name === 'scwin') {
			const name = (n.property as Node).name as string;
			defined.add(name);
			if (renames.has(name)) { members.push(n.property as Node); }
		}
	});
	const at = (offset: number) => body.start + offset;
	// id 변수: Script가 같은 이름을 선언했으면 그 변수일 수 있고, 새 이름이 선언돼 있으면 그 변수로 바뀌므로 둘 다 건드리지 않는다
	if (refs.length) {
		const skip = !IDENT.test(to) ? `새 id \`${to}\`는 변수 이름으로 쓸 수 없어` : declared.has(from) ? `Script에 \`${from}\` 변수가 있어` : declared.has(to) ? `Script에 \`${to}\` 변수가 있어` : undefined;
		if (skip) { result.notes.push(`${skip} \`${from}\` 참조 ${refs.length}곳은 그대로 두었습니다.`); }
		else { refs.forEach(n => result.script.push({ start: at(n.start), end: at(n.end), replacement: to })); }
	}
	strings.forEach(n => result.script.push({ start: at(n.start + 1), end: at(n.end - 1), replacement: to }));
	const changed = result.script.length;
	// 핸들러: 새 이름이 이미 있으면(다른 함수) 섞이므로 그 핸들러는 그대로
	for (const [old, next] of renames) {
		if (!IDENT.test(next) || defined.has(next)) {
			result.notes.push(`\`scwin.${next}\`${IDENT.test(next) ? '가 이미 있어' : '는 함수 이름으로 쓸 수 없어'} \`scwin.${old}\`는 그대로 두었습니다.`);
			renames.delete(old);
		}
	}
	members.filter(n => renames.has(n.name as string)).forEach(n => result.script.push({ start: at(n.start), end: at(n.end), replacement: renames.get(n.name as string)! }));
	const visit = (n: XmlNode) => {
		const attrs = Object.entries(n.attrs).flatMap(([name, value]): [string, string][] => {
			const handler = name.startsWith(EV) ? handlerOf(value) : undefined;
			return handler && renames.has(handler) ? [[name, `scwin.${renames.get(handler)}`]] : [];
		});
		if (attrs.length) { result.attrs.set(n, attrs); }
		n.children.forEach(visit);
	};
	if (renames.size) { visit(root); }
	if (changed) { result.notes.unshift(`Script의 \`${from}\` 참조 ${changed}곳`); }
	for (const [old, next] of renames) { result.notes.push(`\`scwin.${old}\` → \`scwin.${next}\``); }
	return result;
}
