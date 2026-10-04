import { completeFromSchema, type ElementSpec } from '@codemirror/lang-xml';
import { completionPath, javascript, javascriptLanguage, scopeCompletionSource } from '@codemirror/lang-javascript';
import { LanguageSupport, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { completeFromList, ifNotIn, type Completion, type CompletionSource } from '@codemirror/autocomplete';
import { styleTags, tags } from '@lezer/highlight';
import type { ComponentDef, ScriptApi, ScriptApiMethod, SignatureInfo } from '../../core/protocol';
import { defOf, type XmlNode } from '../../core/xmlModel';
import { docComments } from './docComment';
import { colorDoc } from './themes';
import type { DefinitionSource, HoverSource, LocalSignatureSource } from './codeEditor';

const NOT_CODE = ['TemplateString', 'String', 'RegExp', 'LineComment', 'BlockComment', 'VariableDefinition', 'Label', 'PropertyDefinition', 'PropertyName', '.', '?.'];
const MORE_KEYWORDS = ['async', 'await', 'null', 'undefined', 'of', 'else', 'catch', 'void', 'debugger'];

export const scriptLanguage = new LanguageSupport(
	javascriptLanguage.configure({ props: [styleTags({ 'await yield': tags.controlKeyword, 'in of void typeof delete instanceof': tags.keyword })] }),
	[javascript().support, docComments('js'), javascriptLanguage.data.of({ autocomplete: ifNotIn(NOT_CODE, completeFromList(MORE_KEYWORDS.map(label => ({ label, type: 'keyword' })))) })],
);

function renderMethodDoc(method: ScriptApiMethod): HTMLElement {
	const dom = document.createElement('div');
	const add = (parent: HTMLElement, tag: string, className: string, text = '') => {
		const e = parent.appendChild(document.createElement(tag));
		e.className = className;
		e.textContent = text;
		return e;
	};
	const section = (title: string, rows: [label: string, description: string][] = []) => {
		if (rows.length) {
			add(dom, 'div', 'ws-doc-section', title);
		}
		for (const [label, description] of rows) {
			const row = add(dom, 'div', 'ws-doc-param-item');
			add(row, 'span', 'ws-doc-badge', label);
			if (description) {
				add(row, 'span', 'ws-doc-param-desc', ` - ${description}`);
			}
		}
	};
	add(dom, 'div', 'ws-doc-sig', method.signature || method.name);
	if (method.description) {
		add(dom, 'div', 'ws-doc-desc', method.description);
	}
	section('Parameters:', method.params?.map(p => [`${p.name} - ${p.type}${p.required ? `:${p.required}` : ''}`, p.description]));
	section('Returns:', method.returns?.map(r => [r.type, r.description]));
	if (method.sample) {
		add(dom, 'div', 'ws-doc-section', 'Sample:');
		add(dom, 'pre', 'ws-doc-sample', method.sample);
	}
	return dom;
}

export function lazy(make: () => CompletionSource): CompletionSource {
	let source: CompletionSource | undefined;
	return context => (source ??= make())(context);
}

function nodes(root: XmlNode | undefined, visit: (node: XmlNode) => void) {
	if (!root) { return; }
	visit(root);
	root.children.forEach(child => nodes(child, visit));
}

export function xmlCompletions(root: XmlNode | undefined, defs: ComponentDef[]): CompletionSource {
	const elements = new Map<string, ElementSpec>();
	const namespaces = new Map<string, string>();
	nodes(root, n => {
		for (const [name, value] of Object.entries(n.attrs)) {
			if (name === 'xmlns' || name.startsWith('xmlns:')) { namespaces.set(value, name === 'xmlns' ? '' : name.slice(6) + ':'); }
		}
		const previous = elements.get(n.tag)?.attributes ?? [];
		elements.set(n.tag, { name: n.tag, attributes: [...new Set([...previous, ...Object.keys(n.attrs)])] });
	});
	for (const def of defs) {
		const prefix = namespaces.get(def.ns);
		if (prefix === undefined) { continue; }
		const name = prefix + def.id;
		elements.set(name, { name, attributes: [...new Set([
			...elements.get(name)?.attributes ?? [], ...def.properties.map(p => p.name),
		])] });
	}
	return completeFromSchema([...elements.values()], []);
}

/** 속성 이름에 마우스를 올리면 그 컴포넌트 정의의 속성·이벤트 설명 */
export function xmlHover(root: XmlNode | undefined, defs: ComponentDef[]): HoverSource {
	let namespaces: Map<string, string> | undefined;
	return (view, pos, side) => {
		const node = syntaxTree(view.state).resolveInner(pos, side);
		const tag = node.name === 'AttributeName' ? node.parent?.parent?.getChild('TagName') : null;
		if (!tag) { return null; }
		if (!namespaces) {
			const found = namespaces = new Map<string, string>();
			nodes(root, n => Object.entries(n.attrs).forEach(([name, value]) => name.startsWith('xmlns:') && found.set(name.slice(6), value)));
		}
		const [prefix, local] = view.state.sliceDoc(tag.from, tag.to).split(':');
		const ns = namespaces.get(prefix), id = local ?? prefix;
		const name = view.state.sliceDoc(node.from, node.to).replace(/^.*:/, '');
		const candidates = defs.filter(d => d.id === id && (local === undefined || d.ns === ns));
		const found = candidates.flatMap(d => [...d.properties, ...d.events].filter(p => p.name === name))
			.find(p => p.description);
		if (!found) { return null; }
		const options = 'options' in found ? found.options : undefined;
		const dom = Object.assign(document.createElement('div'), { className: 'ws-hover' });
		dom.append(Object.assign(document.createElement('div'), { className: 'ws-doc-sig', textContent: name }),
			Object.assign(document.createElement('div'), { className: 'ws-doc-desc', textContent: found.description }));
		if (options?.length) {
			dom.append(Object.assign(document.createElement('div'), { className: 'ws-doc-desc', textContent: `값: ${options.join(' | ')}` }));
		}
		return { pos: node.from, end: node.to, above: true, create: () => ({ dom }) };
	};
}

type Members = Map<string, Map<string, Completion>>;

function memberAdder(members: Members) {
	const add = (owner: string, option: Completion) => {
		if (!members.has(owner)) { members.set(owner, new Map()); }
		members.get(owner)!.set(option.label, option);
	};
	const namespace = (name: string) => {
		const parts = name.split('.');
		parts.forEach((label, i) => {
			const owner = parts.slice(0, i).join('.');
			if (!members.get(owner)?.has(label)) { add(owner, { label, type: 'namespace' }); }
		});
	};
	return { add, namespace };
}

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

function jsDoc(text: string, comment: SyntaxNode | null): string | undefined {
	const raw = comment?.name === 'BlockComment' ? text.slice(comment.from, comment.to) : '';
	return raw.startsWith('/**') ? raw.slice(3, -2).split('\n').map(l => l.replace(/^\s*\*? ?/, '')).join('\n').trim() || undefined : undefined;
}

function memberOption(text: string, label: string, value: SyntaxNode | null, doc?: string): Completion {
	const fn = value && /^(FunctionExpression|ArrowFunction|FunctionDeclaration)$/.test(value.name);
	const params = fn ? value.getChild('ParamList') : null;
	const option: Completion = {
		label,
		type: fn ? 'function' : value?.name === 'ObjectExpression' ? 'namespace' : 'property',
		detail: params ? text.slice(params.from, params.to).replace(/\s+/g, ' ') : undefined,
		info: doc && (() => jsDocDom(doc)),
	};
	if (params) {
		// 파라미터 힌트: 실제 파라미터 글자(기본값·구조 분해 그대로) + JSDoc의 타입·설명
		const tags = jsDocParams(doc);
		shapeOf.set(option, {
			name: label, doc: doc && jsDocDescription(doc),
			params: commaGroups(params).map(([from, to]) => {
				const name = text.slice(from, to).replace(/\s+/g, ' '), tag = tags.get(name.replace(/\s*=.*$/, ''));
				return { text: tag?.type ? `${name}: ${tag.type}` : name, doc: tag?.doc };
			}),
		});
	}
	return option;
}

/** 파라미터 힌트 재료: 함수 이름, 파라미터마다 보이는 글자·설명, 함수 설명 */
interface CallShape { name: string; params: { text: string; doc?: string }[]; doc?: string }
/** 자동완성 항목(함수·API 메서드) → 파라미터 힌트 재료. 멤버 목록을 그대로 찾아 쓰려고 항목에 붙인다 */
const shapeOf = new WeakMap<Completion, CallShape>();

/** 괄호 묶음(ParamList·ArgList) 안을 최상위 쉼표로 나눈 각 조각의 글자 범위(빈 조각 제외) */
function commaGroups(list: SyntaxNode): [number, number][] {
	const groups: [number, number][] = [];
	let start: number | undefined, end = 0;
	for (let c = list.firstChild; c; c = c.nextSibling) {
		if (c.name === ',' || c.name === ')') {
			if (start !== undefined) { groups.push([start, end]); }
			start = undefined;
		} else if (c.name !== '(' && c.name !== '⚠') {
			start ??= c.from;
			end = c.to;
		}
	}
	if (start !== undefined) { groups.push([start, end]); }
	return groups;
}

/** JSDoc의 @param: 이름 → 타입·설명(`[name=기본값]`·`name.속성`은 이름만) */
function jsDocParams(doc?: string): Map<string, { type?: string; doc?: string }> {
	const out = new Map<string, { type?: string; doc?: string }>();
	for (const m of (doc ?? '').matchAll(/@param\s+(?:\{([^}]*)\}\s*)?\[?([\w$]+)[^\s\]]*\]?\s*(?:-\s*)?([^\n]*)/g)) {
		out.set(m[2], { type: m[1]?.trim() || undefined, doc: docText(m[3]) || undefined });
	}
	return out;
}

/** JSDoc에서 태그 앞 설명 */
const jsDocDescription = (doc: string) => docText(doc.split(/\n\s*@\w/)[0]) || undefined;

/**
 * JSDoc 설명 글: HTML 태그를 글자로 두지 않는다(`<br/>`·`<p>`는 줄바꿈, 나머지 태그는 지움, 문자 엔티티는 글자로).
 * 줄마다 앞뒤 공백은 지운다(JSDoc 줄 이음). 코드 예(@example)에는 쓰지 않는다(코드 안 "<b>" 같은 글자는 그대로)
 */
const docText = (text: string) => text
	.replace(/<br\s*\/?>[ \t]*\n?/gi, '\n').replace(/<\/?(?:p|div)\b[^>]*>/gi, '\n').replace(/<\/?[a-zA-Z][^>]*>/g, '')
	.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
	.split('\n').map(l => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();

/** 이름이 이미 보이므로 숨기는 태그 */
const HIDDEN_TAGS = new Set(['memberOf', 'memberof', 'function', 'method', 'name']);

/** JSDoc 본문 → 설명·Parameters·Returns·Example·나머지 태그(흐리게) */
export function jsDocDom(doc: string): HTMLElement {
	const dom = document.createElement('div');
	const add = (parent: HTMLElement, tag: string, className: string, text = '') => {
		const e = parent.appendChild(document.createElement(tag));
		e.className = className;
		e.textContent = text;
		return e;
	};
	const blocks = doc.split(/\n(?=\s*@\w)/);
	const description = blocks[0].trimStart().startsWith('@') ? '' : blocks.shift()!.trim();
	const tags = blocks.map(b => /^\s*@(\w+)\s*([\s\S]*)$/.exec(b)).filter(m => !!m).map(([, name, body]) => ({ name, body: body.replace(/\s+$/, '') }));
	if (description) { add(dom, 'div', 'ws-doc-desc', docText(description)); }
	const params = tags.filter(t => t.name === 'param'), returns = tags.filter(t => /^returns?$/.test(t.name));
	const rows = (title: string, list: typeof tags, named: boolean) => {
		if (!list.length) { return; }
		add(dom, 'div', 'ws-doc-section', title);
		for (const t of list) {
			const m = /^(?:\{([^}]*)\}\s*)?([\s\S]*)$/.exec(t.body)!;
			// 이름(파라미터만)은 첫 낱말, 나머지는 줄바꿈 그대로 설명
			const [, name = '', after = m[2]] = named ? /^(\S*)\s*([\s\S]*)$/.exec(m[2])! : [];
			// 중괄호 없이 `@return String 설명`이면 첫 낱말이 타입처럼(대문자로 시작) 생겼을 때 타입으로
			const bare = !m[1] && !named ? /^([A-Z][\w.$<>[\]|]*)\s+([\s\S]*)$/.exec(after) : null;
			const type = m[1] ?? bare?.[1], text = docText(bare ? bare[2] : after).replace(/^-\s*/, '');
			const row = add(dom, 'div', 'ws-doc-param-item');
			if (name) { add(row, 'span', 'ws-doc-badge', name.replace(/^\[|\]$/g, '')); }
			if (type) { add(row, 'span', 'ws-doc-type', `${name ? ' ' : ''}${type}`); }
			if (text) { add(row, 'span', 'ws-doc-param-desc', name || type ? ` — ${text}` : text); }
		}
	};
	rows('Parameters:', params, true);
	rows('Returns:', returns, false);
	for (const t of tags.filter(t => t.name === 'example')) {
		add(dom, 'div', 'ws-doc-section', 'Example:');
		add(dom, 'pre', 'ws-doc-sample', t.body.replace(/^\n+/, ''));
	}
	const meta = tags.filter(t => !['param', 'return', 'returns', 'example'].includes(t.name) && !HIDDEN_TAGS.has(t.name));
	if (meta.length) {
		add(dom, 'div', 'ws-doc-meta', meta.map(t => `@${t.name} ${docText(t.body)}`.trim()).join('  ·  '));
	}
	return dom;
}

const moduleCache = new WeakMap<object, Members>();

/** 맨 위 정의 하나: owner(점으로 이은 개체 이름, 전역은 '')의 label. at은 이름 글자 자리(정의로 이동) */
interface TopMember { owner: string; label: string; value: SyntaxNode | null; doc?: string; at: { from: number; to: number } }

/** 파일 맨 위의 정의들: `a.b = …`, `var a = …`(객체면 그 속성까지), `function f…` */
function eachMember(text: string, visit: (m: TopMember) => void) {
	for (let st = javascriptLanguage.parser.parse(text).topNode.firstChild; st; st = st.nextSibling) {
		const assign = st.name === 'ExpressionStatement' && st.firstChild?.name === 'AssignmentExpression' ? st.firstChild : null;
		const left = assign ? assign.firstChild : st.name === 'VariableDeclaration' ? st.getChild('VariableDefinition') : null;
		const value = assign ? assign.lastChild : left?.nextSibling?.name === 'Equals' ? left.nextSibling.nextSibling : null;
		if (st.name === 'FunctionDeclaration') {
			const fnName = st.getChild('VariableDefinition');
			if (fnName) { visit({ owner: '', label: text.slice(fnName.from, fnName.to), value: st, doc: jsDoc(text, st.prevSibling), at: fnName }); }
			continue;
		}
		const name = left && text.slice(left.from, left.to).replace(/\s+/g, '').replace(/^window\./, '');
		if (!left || !name || !/^[\w$]+(\.[\w$]+)*$/.test(name)) { continue; }
		const dot = name.lastIndexOf('.');
		// `a.b.c =`이면 이름 자리는 마지막 c
		const at = left.name === 'MemberExpression' ? left.lastChild ?? left : left;
		visit({ owner: name.slice(0, Math.max(dot, 0)), label: name.slice(dot + 1), value, doc: jsDoc(text, st.prevSibling), at });
		for (const prop of value?.name === 'ObjectExpression' ? value.getChildren('Property') : []) {
			const key = prop.getChild('PropertyDefinition');
			if (key) { visit({ owner: name, label: text.slice(key.from, key.to), value: prop.lastChild, doc: jsDoc(text, prop.prevSibling), at: key }); }
		}
	}
}

/** owner의 label이 정의된 이름 자리(맨 위 정의만) */
function definitionIn(text: string, owner: string, label: string): { from: number; to: number } | undefined {
	let found: { from: number; to: number } | undefined;
	eachMember(text, m => { if (!found && m.owner === owner && m.label === label) { found = { from: m.at.from, to: m.at.to }; } });
	return found;
}

function moduleMembers(files: { text: string }[]): Members {
	const cached = moduleCache.get(files);
	if (cached) { return cached; }
	const members: Members = new Map();
	const { add, namespace } = memberAdder(members);
	for (const { text } of files) {
		eachMember(text, ({ owner, label, value, doc }) => {
			if (owner) { namespace(owner); }
			add(owner, memberOption(text, label, value, doc));
		});
	}
	moduleCache.set(files, members);
	return members;
}

/** 객체 이름(owner) → 멤버. API 문서·공통 JS·화면 컴포넌트 id(그 컴포넌트 종류의 메서드)를 모은다. 자동완성과 hover 설명이 함께 쓴다 */
function scriptMembers(root: XmlNode | undefined, defs: ComponentDef[], api: ScriptApi, modules: { text: string }[]): Members {
	const members: Members = new Map();
	const { add, namespace } = memberAdder(members);
	for (const [owner, options] of moduleMembers(modules)) {
		options.forEach(option => add(owner, option));
	}
	for (const [owner, methods] of Object.entries(api)) {
		namespace(owner);
		for (const method of methods) {
			const option: Completion = {
				label: method.name,
				type: 'method',
				detail: 'WebSquare',
				info: () => renderMethodDoc(method),
			};
			// 파라미터 표가 없으면 signature 글자(`name(a, b)`)의 괄호 안 이름으로
			const listed = method.params?.length ? method.params.map(p => ({ text: p.type ? `${p.name}: ${p.type}` : p.name, doc: p.description || undefined }))
				: (/\(([^)]*)\)/.exec(method.signature)?.[1] ?? '').split(',').map(s => s.trim()).filter(Boolean).map(text => ({ text }));
			shapeOf.set(option, { name: method.name, doc: method.description || undefined, params: listed });
			add(owner, option);
		}
	}
	namespace('scwin');
	namespace('$p');
	namespace('WebSquare');
	nodes(root, node => {
		const id = node.attrs.id;
		const def = defOf(node, defs);
		if (!id || !/^[\p{ID_Start}_$][\p{ID_Continue}$]*$/u.test(id) || !def) { return; }
		add('', { label: id, type: 'variable', detail: def.realType });
		members.set(id, members.get(`WebSquare.uiplugin.${def.realType}`) ?? new Map());
	});
	return members;
}

/** Script 편집기의 자동완성과 hover 설명(같은 멤버 목록을 한 번만 만든다) */
export function scriptTools(root: XmlNode | undefined, defs: ComponentDef[], api: ScriptApi, modules: { path: string; text: string }[] = []):
	{ complete: CompletionSource; hover: HoverSource; definition: DefinitionSource; signature: LocalSignatureSource } {
	let built: Members | undefined;
	const members = () => built ??= scriptMembers(root, defs, api, modules);
	return {
		complete: scriptCompletions(members), hover: scriptHover(members),
		definition: (state, pos) => scriptDefinition(state, pos, modules),
		signature: (state, pos) => scriptSignature(state, pos, members()),
	};
}

/**
 * Script 파라미터 힌트: 커서를 감싼 호출 괄호의 함수(API 문서·공통 JS·같은 Script 함수의 실제 파라미터와 JSDoc).
 * 지금 파라미터는 커서 앞 최상위 쉼표 개수. 모르는 함수면 undefined
 */
function scriptSignature(state: EditorState, pos: number, members: Members): SignatureInfo | undefined {
	let args: SyntaxNode | null = null;
	for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
		// 닫는 괄호가 아직 없으면(입력 중) 끝까지 안쪽
		if (n.name === 'ArgList' && pos > n.from && (pos < n.to || state.sliceDoc(n.to - 1, n.to) !== ')')) {
			args = n;
			break;
		}
	}
	const callee = args?.prevSibling;
	const name = callee?.name === 'MemberExpression' ? callee.lastChild : callee?.name === 'VariableName' ? callee : null;
	if (!args || !name) { return undefined; }
	const owner = name === callee ? '' : state.sliceDoc(callee!.firstChild!.from, callee!.firstChild!.to).replace(/\s+/g, '');
	const label = state.sliceDoc(name.from, name.to);
	const find = (all: Members) => { const o = all.get(owner)?.get(label); return o && shapeOf.get(o); };
	const shape = find(members) ?? find(moduleMembers([{ text: state.doc.toString() }]));
	if (!shape) { return undefined; }
	let active = 0;
	for (let c = args.firstChild; c; c = c.nextSibling) {
		if (c.name === ',' && c.to <= pos) { active++; }
	}
	let text = `${shape.name}(`;
	const params = shape.params.map((p, i): [number, number] => {
		text += i ? ', ' : '';
		const at = text.length;
		text += p.text;
		return [at, text.length];
	});
	text += ')';
	return {
		label: text, params, index: 1, count: 1, doc: shape.doc,
		...active < params.length && { active, paramDoc: shape.params[active].doc },
	};
}

/** `개체.멤버`·변수에 마우스를 올리면 그 멤버의 설명(API 문서, 공통 JS의 JSDoc, 컴포넌트 종류) */
function scriptHover(members: () => Members): HoverSource {
	return (view, pos, side) => {
		const target = memberAt(view.state, pos, side);
		if (!target) { return null; }
		const find = (all: Members) => all.get(target.owner)?.get(target.label);
		// 없으면 이 Script 안에서 정의한 함수(scwin.f = function…, function f…)의 JSDoc
		let option = find(members());
		if (!option?.info) {
			option = find(moduleMembers([{ text: view.state.doc.toString() }])) ?? option;
		}
		const dom = option && hoverDom(option);
		return dom ? { pos: target.from, end: target.to, above: true, create: () => ({ dom: colorDoc(dom, view.state) }) } : null;
	};
}

/** 그 자리 이름이 어느 개체(owner, 전역은 '')의 어떤 멤버(label)인지: `a.b.c`의 c면 owner 'a.b', 변수면 '' */
function memberAt(state: EditorState, pos: number, side: -1 | 1 = 1): { owner: string; label: string; from: number; to: number } | undefined {
	const node = syntaxTree(state).resolveInner(pos, side);
	const label = state.sliceDoc(node.from, node.to);
	if (node.name === 'PropertyName' && node.parent?.name === 'MemberExpression') {
		const object = node.parent.firstChild;
		return object ? { owner: state.sliceDoc(object.from, object.to).replace(/\s+/g, ''), label, from: node.from, to: node.to } : undefined;
	}
	return node.name === 'VariableName' || node.name === 'VariableDefinition' ? { owner: '', label, from: node.from, to: node.to } : undefined;
}

/** 정의 위치: 이 Script 안이면 그 범위, 공통 JS면 그 파일(웹 경로)과 줄·글자 */
export type ScriptDefinition = { from: number; to: number } | { path: string; line: number; ch: number; endLine: number; endCh: number };

/**
 * Script 정의로 이동: 같은 Script의 맨 위 정의(`scwin.f = function`, `function f`) 먼저, 없으면 공통 JS.
 * WebSquare API(`$p.*` 등)는 소스가 없어 undefined
 */
export function scriptDefinition(state: EditorState, pos: number, modules: { path: string; text: string }[]): ScriptDefinition | undefined {
	const target = memberAt(state, pos) ?? memberAt(state, pos, -1);
	if (!target) { return undefined; }
	const here = definitionIn(state.doc.toString(), target.owner, target.label);
	if (here) { return here; }
	for (const file of modules) {
		const at = definitionIn(file.text, target.owner, target.label);
		if (at) {
			const lineCh = (offset: number) => {
				const before = file.text.slice(0, offset).split(/\r\n?|\n/);
				return { line: before.length - 1, ch: before.at(-1)!.length };
			};
			const start = lineCh(at.from), end = lineCh(at.to);
			return { path: file.path, line: start.line, ch: start.ch, endLine: end.line, endCh: end.ch };
		}
	}
	return undefined;
}

function hoverDom({ label, detail, info }: Completion): HTMLElement | undefined {
	const content = typeof info === 'function' ? info({ label }) : info;
	if (content instanceof HTMLElement) {
		return content.classList.add('ws-hover'), content;
	}
	if (typeof content === 'string' || detail) {
		const dom = Object.assign(document.createElement('div'), { className: 'ws-hover ws-doc-desc' });
		dom.textContent = typeof content === 'string' ? content : `${label} ${detail}`;
		return dom;
	}
	return undefined;
}

function scriptCompletions(members: () => Members): CompletionSource {
	const browser = scopeCompletionSource(globalThis);
	return async context => {
		const path = completionPath(context);
		if (!path) { return null; }
		const owner = path.path.join('.');
		const options = new Map(members().get(owner));
		syntaxTree(context.state).iterate({ enter(node) {
			if (node.name !== 'AssignmentExpression') { return; }
			const left = node.node.firstChild;
			if (left?.name !== 'MemberExpression') { return; }
			const name = context.state.sliceDoc(left.from, left.to).replace(/\s+/g, '');
			const dot = name.lastIndexOf('.');
			if (name.slice(0, dot) !== owner || !/^[\w$]+$/.test(name.slice(dot + 1))) { return; }
			const label = name.slice(dot + 1);
			if (!options.has(label)) { options.set(label, { label, type: 'property' }); }
		} });
		let standard;
		try { standard = await browser(context); } catch { /* 브라우저의 접근 제한 getter는 건너뛴다. */ }
		for (const option of standard?.options ?? []) {
			if (!options.has(option.label)) { options.set(option.label, option); }
		}
		// 설명(API 문서·JSDoc)의 라벨에 지금 코드 테마 색
		const themed = [...options.values()].map(o => typeof o.info !== 'function' ? o : {
			...o, info: (c: Completion) => { const r = (o.info as (c: Completion) => unknown)(c); return r instanceof HTMLElement ? colorDoc(r, context.state) : r; },
		} as Completion);
		return { from: context.pos - path.name.length, options: themed, validFor: /^[\w$]*$/ };
	};
}
