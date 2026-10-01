import { completeFromSchema, type ElementSpec } from '@codemirror/lang-xml';
import { completionPath, javascript, javascriptLanguage, scopeCompletionSource } from '@codemirror/lang-javascript';
import { LanguageSupport, syntaxTree } from '@codemirror/language';
import { completeFromList, ifNotIn, type Completion, type CompletionSource } from '@codemirror/autocomplete';
import { styleTags, tags } from '@lezer/highlight';
import type { ComponentDef, ScriptApi, ScriptApiMethod } from '../../core/protocol';
import { defOf, type XmlNode } from '../../core/xmlModel';
import { docComments } from './docComment';
import type { HoverSource } from './codeEditor';

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
	const fn = value && /^(FunctionExpression|ArrowFunction)$/.test(value.name);
	const params = fn ? value.getChild('ParamList') : null;
	return {
		label,
		type: fn ? 'function' : value?.name === 'ObjectExpression' ? 'namespace' : 'property',
		detail: params ? text.slice(params.from, params.to).replace(/\s+/g, ' ') : undefined,
		info: doc && (() => Object.assign(document.createElement('div'), { className: 'ws-doc-desc', textContent: doc })),
	};
}

const moduleCache = new WeakMap<object, Members>();

function moduleMembers(files: { text: string }[]): Members {
	const cached = moduleCache.get(files);
	if (cached) { return cached; }
	const members: Members = new Map();
	const { add, namespace } = memberAdder(members);
	for (const { text } of files) {
		for (let st = javascriptLanguage.parser.parse(text).topNode.firstChild; st; st = st.nextSibling) {
			const assign = st.name === 'ExpressionStatement' && st.firstChild?.name === 'AssignmentExpression' ? st.firstChild : null;
			const left = assign ? assign.firstChild : st.name === 'VariableDeclaration' ? st.getChild('VariableDefinition') : null;
			const value = assign ? assign.lastChild : left?.nextSibling?.name === 'Equals' ? left.nextSibling.nextSibling : null;
			const name = left && text.slice(left.from, left.to).replace(/\s+/g, '').replace(/^window\./, '');
			if (!name || !/^[\w$]+(\.[\w$]+)*$/.test(name)) { continue; }
			const dot = name.lastIndexOf('.'), owner = name.slice(0, Math.max(dot, 0));
			if (owner) { namespace(owner); }
			add(owner, memberOption(text, name.slice(dot + 1), value, jsDoc(text, st.prevSibling)));
			for (const prop of value?.name === 'ObjectExpression' ? value.getChildren('Property') : []) {
				const key = prop.getChild('PropertyDefinition');
				if (key) { add(name, memberOption(text, text.slice(key.from, key.to), prop.lastChild, jsDoc(text, prop.prevSibling))); }
			}
		}
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
			add(owner, {
				label: method.name,
				type: 'method',
				detail: 'WebSquare',
				info: () => renderMethodDoc(method),
			});
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
export function scriptTools(root: XmlNode | undefined, defs: ComponentDef[], api: ScriptApi, modules: { text: string }[] = []): { complete: CompletionSource; hover: HoverSource } {
	let built: Members | undefined;
	const members = () => built ??= scriptMembers(root, defs, api, modules);
	return { complete: scriptCompletions(members), hover: scriptHover(members) };
}

/** `개체.멤버`·변수에 마우스를 올리면 그 멤버의 설명(API 문서, 공통 JS의 JSDoc, 컴포넌트 종류) */
function scriptHover(members: () => Members): HoverSource {
	return (view, pos, side) => {
		const node = syntaxTree(view.state).resolveInner(pos, side);
		const name = view.state.sliceDoc(node.from, node.to);
		let option: Completion | undefined;
		if (node.name === 'PropertyName' && node.parent?.name === 'MemberExpression') {
			const object = node.parent.firstChild;
			option = object ? members().get(view.state.sliceDoc(object.from, object.to).replace(/\s+/g, ''))?.get(name) : undefined;
		} else if (node.name === 'VariableName') {
			option = members().get('')?.get(name);
		}
		const dom = option && hoverDom(option);
		return dom ? { pos: node.from, end: node.to, above: true, create: () => ({ dom }) } : null;
	};
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
		return { from: context.pos - path.name.length, options: [...options.values()], validFor: /^[\w$]*$/ };
	};
}
