import { create } from 'zustand';
import type { CodeTarget, LinkState, ToExtension, ToWebview, XmlElementSpec } from '../core/protocol';
import { DEFAULT_LINK_EXTS, DEFAULT_LINK_TABS, type LinkTab } from '../core/links';
import type { CodeThemeId } from '../core/codeTheme';
import { DEFAULT_CODE_OPTIONS, type CodeOptions } from '../core/codeOptions';
import { findNode, nodeAt, pathTo, type XmlNode } from '../core/xmlModel';
import type { DropPosition } from '../core/paste';
import { leadOf } from '../core/edit';
import { setStyle, styleChanges } from '../core/style';
import type { TextTarget } from './design/renderers';

declare function acquireVsCodeApi(): { postMessage(msg: ToExtension): void };
export const vscode = acquireVsCodeApi();
export const post = (msg: ToExtension) => vscode.postMessage(msg);

export type Doc = Extract<ToWebview, { type: 'document' }>;
export type Defs = Extract<ToWebview, { type: 'definitions' }>;
export type Styles = Extract<ToWebview, { type: 'styles' }>;
export type ScriptApi = Extract<ToWebview, { type: 'scriptApi' }>;
export type Modules = Extract<ToWebview, { type: 'modules' }>;

interface EditorState {
	doc?: Doc;
	defs?: Defs;
	styles?: Styles;
	api?: ScriptApi;
	modules?: Modules;
	selected?: number;
	extra: number[];
	copied?: string[];
	pendingSelect?: string;
	links: Record<string, LinkState>;
	linkTabs: LinkTab[];
	tabOrder?: string[];
	codeTheme: CodeThemeId;
	codeOptions: CodeOptions;
	gitBases: Partial<Record<CodeTarget, string>>;
	/** 연결 탭 경로 입력의 파일 검색 목록(탭 id별) */
	linkFiles: Record<string, string[]>;
	/** 연결할 수 있는 확장자(설정) */
	linkExts: string[];
	/** 연결한 XML의 DTD 스키마(탭 id별, 없으면 기본 MyBatis 목록) */
	xmlSchemas: Record<string, XmlElementSpec[] | undefined>;

	handleMessage: (data: ToWebview) => void;
	setSelected: (selected?: number, additive?: boolean) => void;
	editAttr: (name: string, value: string | undefined, index?: number) => void;
	editSelected: (name: string, value: string | undefined) => void;
	editText: (t: TextTarget, value: string) => void;
	openFrame: (index: number) => void;
	copy: () => boolean;
	paste: () => boolean;
	cut: () => boolean;
	del: () => boolean;
	move: (dragged: number, target: number, position: DropPosition) => void;
	setTabOrder: (order: string[]) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
	doc: undefined,
	defs: undefined,
	styles: undefined,
	api: undefined,
	modules: undefined,
	selected: undefined,
	extra: [],
	links: {},
	linkTabs: DEFAULT_LINK_TABS,
	codeTheme: 'vscode',
	codeOptions: DEFAULT_CODE_OPTIONS,
	gitBases: {},
	linkFiles: {},
	linkExts: DEFAULT_LINK_EXTS,
	xmlSchemas: {},

	handleMessage: (data) => {
		if (data.type === 'document') {
			const { pendingSelect } = get();
			const added = pendingSelect && data.root && findNode(data.root, n => n.attrs.id === pendingSelect);
			set({ doc: data, extra: [], ...added && { selected: added.index, pendingSelect: undefined } });
		} else if (data.type === 'select') {
			set({ pendingSelect: data.id });
		} else if (data.type === 'definitions') {
			set({ defs: data });
		} else if (data.type === 'styles') {
			// 외부 웹 폰트: @font-face는 Shadow DOM 안에서 안 먹어서 문서에 붙인다 (폰트는 캔버스에서도 보인다)
			for (const href of data.imports ?? []) {
				if (!document.querySelector(`link[href="${CSS.escape(href)}"]`)) {
					document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));
				}
			}
			set({ styles: data });
		} else if (data.type === 'scriptApi') {
			set({ api: data });
		} else if (data.type === 'modules') {
			set({ modules: data });
		} else if (data.type === 'linked') {
			set({ links: { ...get().links, [data.kind]: data } });
		} else if (data.type === 'linkTabs') {
			set({ linkTabs: data.tabs, linkExts: data.exts });
		} else if (data.type === 'xmlSchema') {
			set({ xmlSchemas: { ...get().xmlSchemas, [data.kind]: data.elements } });
		} else if (data.type === 'files') {
			set({ linkFiles: { ...get().linkFiles, [data.kind]: data.files } });
		} else if (data.type === 'gitBase') {
			set({ gitBases: { ...get().gitBases, [data.target]: data.text } });
		} else if (data.type === 'codeTheme') {
			set({ codeTheme: data.theme });
		} else if (data.type === 'codeOptions') {
			set({ codeOptions: { wordWrap: data.wordWrap, sqlDialect: data.sqlDialect } });
		} else if (data.type === 'tabOrder') {
			set({ tabOrder: data.order });
		}
	},

	setSelected: (selected, additive) => {
		if (!additive || selected === undefined) {
			set({ selected, extra: [] });
			return;
		}
		const { selected: primary, extra } = get();
		const current = primary === undefined ? extra : [...extra, primary];
		if (current.includes(selected)) {
			const rest = current.filter(i => i !== selected);
			set({ selected: rest.at(-1), extra: rest.slice(0, -1) });
		} else {
			set({ selected, extra: current });
		}
	},

	editAttr: (name, value, index = get().selected) => {
		const { doc } = get();
		const root = doc?.root;
		const node = root && nodeAt(root, index);
		if (doc && node) {
			post({ type: 'setAttr', version: doc.version, index: node.index, name, value });
		}
	},

	/** Property 창: 선택한 컴포넌트 모두에(id는 겹치면 안 돼 마지막 선택만). style은 바뀐 CSS 속성만 각자의 style에 */
	editSelected: (name, value) => {
		const { doc, selected, extra } = get();
		const root = doc?.root, node = root && nodeAt(root, selected);
		if (!doc || !root || !node) {
			return;
		}
		const changes = name === 'style' ? styleChanges(node.attrs.style, value) : undefined;
		const more = name === 'id' || (changes && !Object.keys(changes).length) ? [] : extra.flatMap(index => {
			const other = index !== node.index ? nodeAt(root, index) : undefined;
			const next = other && (changes ? setStyle(other.attrs.style, changes) || undefined : value);
			return other && next !== other.attrs[name] ? [{ index, value: next }] : [];
		});
		post({ type: 'setAttr', version: doc.version, index: node.index, name, value, ...more.length && { more } });
	},

	editText: (t, value) => {
		const { doc } = get();
		if (doc) {
			post(t.attr
				? { type: 'setAttr', version: doc.version, index: t.index, name: t.attr, value: value || undefined }
				: { type: 'setText', version: doc.version, index: t.index, value });
		}
	},

	openFrame: (index) => {
		post({ type: 'openFrame', index });
	},

	copy: () => {
		const { doc } = get();
		const nodes = targets(get());
		if (!doc || !nodes.length) {
			return false;
		}
		set({ copied: nodes.map(node => (leadOf(doc.text, node.start) ?? '') + doc.text.slice(node.start, node.end)) });
		return true;
	},

	paste: () => {
		const { doc, selected, copied } = get();
		const path = doc?.root && pathTo(doc.root, selected);
		if (!doc || !copied || !path || path.length < 2 || selected === undefined) {
			return false;
		}
		post({ type: 'paste', version: doc.version, index: selected, xml: copied });
		return true;
	},

	del: () => {
		const { doc } = get();
		const [node, ...more] = targets(get());
		if (!doc || !node) {
			return false;
		}
		post({ type: 'delete', version: doc.version, index: node.index, ...more.length && { more: more.map(n => n.index) } });
		set({ selected: pathTo(doc.root!, node.index)!.at(-2)!.index, extra: [] });
		return true;
	},

	cut: () => {
		const { copy, del } = get();
		return copy() && del();
	},

	move: (dragged, target, position) => {
		const { doc } = get();
		if (doc) {
			const group = targets(get()).map(n => n.index);
			const more = group.includes(dragged) ? group.filter(i => i !== dragged) : [];
			post({ type: 'move', version: doc.version, dragged, target, position, ...more.length && { more } });
		}
	},

	setTabOrder: (order) => {
		set({ tabOrder: order });
		post({ type: 'setTabOrder', order });
	},
}));

function targets({ doc, selected, extra }: EditorState): XmlNode[] {
	const root = doc?.root;
	if (!root) { return []; }
	const nodes = [...extra, ...selected === undefined ? [] : [selected]]
		.map(i => pathTo(root, i)).filter(path => path && path.length > 2).map(path => path!.at(-1)!);
	return nodes.filter(n => !nodes.some(o => o !== n && o.start <= n.start && n.end <= o.end)).sort((a, b) => a.start - b.start);
}

