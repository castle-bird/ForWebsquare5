import { create } from 'zustand';
import type { CodeTarget, LinkState, TabPosition, ToExtension, ToWebview, XmlElementSpec } from '../core/protocol';
import { DEFAULT_LINK_EXTS, DEFAULT_LINK_TABS, type LinkTab } from '../core/links';
import type { CodeThemeState } from '../core/codeTheme';
import type { Blame } from '../core/blame';
import { DEFAULT_CODE_OPTIONS, type CodeOptions } from '../core/codeOptions';
import { findNode, nodeAt, pathTo, type XmlNode } from '../core/xmlModel';
import type { DropPosition } from '../core/paste';
import { movedIndexes } from '../core/move';
import { leadOf } from '../core/edit';
import { isStructure } from '../core/paste';
import { isMerged, mergeProblem } from '../core/merge';
import { setStyle, styleChanges } from '../core/style';
import type { TextTarget } from './design/renderers';
import { paletteKey } from '../core/palette';
import type { ComponentDef } from '../core/protocol';

declare function acquireVsCodeApi(): { postMessage(msg: ToExtension): void };
export const vscode = acquireVsCodeApi();
export const post = (msg: ToExtension) => vscode.postMessage(msg);

export type Doc = Extract<ToWebview, { type: 'document' }>;
type Defs = Extract<ToWebview, { type: 'definitions' }>;
type Styles = Extract<ToWebview, { type: 'styles' }>;
export type ScriptApi = Extract<ToWebview, { type: 'scriptApi' }>;
type Modules = Extract<ToWebview, { type: 'modules' }>;

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
	/** 보낸 옮기기(version: 보낸 때 문서): 그 결과 문서가 오면 선택·펼침 번호를 옮긴 뒤 번호로 바꾼다(movedIndexes) */
	pendingMove?: { version: number; map: Map<number, number>; check: [number, string][] };
	/** 문서가 바뀌며 번호가 바뀌었음(펼침 상태도 따라 바꾸게, key: 매번 새 값) */
	remap?: { map: Map<number, number>; key: number };
	links: Record<string, LinkState>;
	linkTabs: LinkTab[];
	tabOrder?: string[];
	tabPosition: TabPosition;
	/** 코드 편집기 미니맵(모든 화면 공통) */
	minimap: boolean;
	/** 코드 편집기 커서 줄 끝 Git blame(모든 화면 공통) */
	codeBlame: boolean;
	/** 편집기마다 마지막으로 받은 blame(문서 버전과 함께) */
	blames: Partial<Record<CodeTarget, { version: number; data?: Blame }>>;
	paletteFavorites: string[];
	codeTheme: CodeThemeState;
	/** 테마 색 덮어쓰기 팝업이 고치는 중인 공통·이 테마 층(열린 코드 편집기 미리 보기) */
	codeThemeDraft?: Pick<CodeThemeState, 'common' | 'own'>;
	codeOptions: CodeOptions;
	gitBases: Partial<Record<CodeTarget, string>>;
	/** VS Code가 연결 파일에 낸 문제(편집기가 뜨기 전에 와도 남도록 여기에) */
	diagnostics: Partial<Record<CodeTarget, Extract<ToWebview, { type: 'diagnostics' }>>>;
	/** 연결 탭 경로 입력의 파일 검색 목록(탭 id별) */
	linkFiles: Record<string, string[]>;
	/** 탭마다 마지막으로 연결하지 못한 이유(입력을 바꾸면 지움) */
	linkProblems: Record<string, string | undefined>;
	/** 잠깐 뜨는 알림(key: 같은 글도 다시 띄움) */
	toast?: { message: string; key: number };
	/** 연결할 수 있는 확장자(설정) */
	linkExts: string[];
	/** 연결한 XML의 DTD 스키마(탭 id별, 없으면 기본 MyBatis 목록) */
	xmlSchemas: Record<string, XmlElementSpec[] | undefined>;

	handleMessage: (data: ToWebview) => void;
	setSelected: (selected?: number, additive?: boolean) => void;
	/** 고른 컴포넌트의 부모를 고른다(body 위로는 안 감). 옮겼으면 true */
	selectParent: () => boolean;
	editAttr: (name: string, value: string | undefined, index?: number) => void;
	editSelected: (name: string, value: string | undefined) => void;
	/** also: 같은 노드의 다른 속성도 함께(그리드 헤더 칸의 너비·높이) */
	editText: (t: TextTarget, value: string, also?: { name: string; value?: string }[]) => void;
	openFrame: (index: number) => void;
	/** clip: 복사·붙여넣기 이벤트의 클립보드. 화면(웹뷰)마다 store가 따로라 다른 화면 XML로 붙여 넣으려면 클립보드를 거친다 */
	copy: (clip?: DataTransfer | null) => boolean;
	/** at: 우클릭한 컴포넌트의 앞·뒤에(없으면 고른 것 기준 기본 자리) */
	paste: (clip?: DataTransfer | null, at?: { index: number; position: 'before' | 'after' }) => boolean;
	cut: (clip?: DataTransfer | null) => boolean;
	/** 고른 셀을 하나로 병합(표·그리드). 못 하면 이유를 알리고 false */
	merge: () => boolean;
	/** 병합 풀기: cells(없으면 고른 노드) 중 병합된 셀 */
	unmerge: (cells?: number[]) => boolean;
	/** 그리드(grid) 칸들의 열 지우기, 또는 첫 칸의 열 옮기기 */
	gridColumns: (op: 'delete' | 'left' | 'right', grid: number, cells: number[]) => void;
	del: () => boolean;
	move: (dragged: number, target: number, position: DropPosition) => void;
	setTabOrder: (order: string[]) => void;
	setTabPosition: (position: TabPosition) => void;
	setMinimap: (on: boolean) => void;
	setCodeBlame: (on: boolean) => void;
	togglePaletteFavorite: (component: ComponentDef) => void;
	reorderPaletteFavorites: (keys: string[]) => void;
}

/** 클립보드에 넣는 복사한 노드(XML 조각 목록, JSON) 형식 */
const CLIP_NODES = 'application/x-websquare5-nodes';

const fromClip = (clip: DataTransfer | null | undefined): string[] | undefined => {
	try {
		const items: unknown = JSON.parse(clip?.getData(CLIP_NODES) || 'null');
		return Array.isArray(items) && items.length && items.every(i => typeof i === 'string') ? items as string[] : undefined;
	} catch {
		return undefined;
	}
};

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
	codeTheme: { theme: 'vscode' },
	codeOptions: DEFAULT_CODE_OPTIONS,
	gitBases: {},
	tabPosition: 'top',
	minimap: true,
	codeBlame: true,
	blames: {},
	paletteFavorites: [],
	diagnostics: {},
	linkFiles: {},
	linkProblems: {},
	linkExts: DEFAULT_LINK_EXTS,
	xmlSchemas: {},

	handleMessage: (data) => {
		if (data.type === 'document') {
			const { pendingSelect, pendingMove, selected } = get();
			const added = pendingSelect && data.root && findNode(data.root, n => n.attrs.id === pendingSelect);
			// 옮긴 결과 문서: 옮긴 노드가 계산한 번호에 그대로 있을 때만(다른 변경이 섞였으면 번호를 믿을 수 없다)
			const moved = pendingMove && data.version !== pendingMove.version && data.root
				&& pendingMove.check.every(([old, tag]) => nodeAt(data.root!, pendingMove.map.get(old))?.tag === tag) ? pendingMove.map : undefined;
			set({ doc: data, extra: [], ...pendingMove && data.version !== pendingMove.version && { pendingMove: undefined },
				...moved && { selected: selected === undefined ? undefined : moved.get(selected), remap: { map: moved, key: Date.now() } },
				...added && { selected: added.index, pendingSelect: undefined } });
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
		} else if (data.type === 'toast') {
			set({ toast: { message: data.message, key: Date.now() } });
		} else if (data.type === 'linkProblem') {
			set({ linkProblems: { ...get().linkProblems, [data.kind]: data.message } });
		} else if (data.type === 'files') {
			set({ linkFiles: { ...get().linkFiles, [data.kind]: data.files } });
		} else if (data.type === 'gitBase') {
			set({ gitBases: { ...get().gitBases, [data.target]: data.text } });
		} else if (data.type === 'diagnostics') {
			set({ diagnostics: { ...get().diagnostics, [data.target]: data } });
		} else if (data.type === 'codeTheme') {
			const { type: _type, ...theme } = data;
			set({ codeTheme: theme });
		} else if (data.type === 'codeOptions') {
			set({ codeOptions: { wordWrap: data.wordWrap, sqlDialect: data.sqlDialect, fontFeatures: data.fontFeatures } });
		} else if (data.type === 'paletteFavorites') {
			set({ paletteFavorites: data.keys });
		} else if (data.type === 'tabOrder') {
			set({ tabOrder: data.order });
		} else if (data.type === 'tabPosition') {
			set({ tabPosition: data.position });
		} else if (data.type === 'minimap') {
			set({ minimap: data.on });
		} else if (data.type === 'codeBlame') {
			set({ codeBlame: data.on });
		} else if (data.type === 'blame') {
			set({ blames: { ...get().blames, [data.target]: { version: data.version, data: data.data } } });
		}
	},

	selectParent: () => {
		const { doc, selected } = get();
		const path = doc?.root && selected !== undefined ? pathTo(doc.root, selected) : undefined;
		const body = path?.findIndex(n => n.tag.replace(/^.*:/, '') === 'body') ?? -1;
		if (!path || body < 0 || path.length - 1 <= body) { return false; }
		get().setSelected(path[path.length - 2].index);
		return true;
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

	editText: (t, value, also) => {
		const { doc } = get();
		if (doc) {
			post(t.attr
				? { type: 'setAttr', version: doc.version, index: t.index, name: t.attr, value: value || undefined, ...also?.length ? { also } : {} }
				: { type: 'setText', version: doc.version, index: t.index, value });
		}
	},

	openFrame: (index) => {
		post({ type: 'openFrame', index });
	},

	copy: (clip) => {
		const { doc } = get();
		const nodes = targets(get());
		if (!doc || !nodes.length) {
			return false;
		}
		if (nodes.some(isStructure)) {
			post({ type: 'warn', message: '화면 구조(xf:model 등)는 복사할 수 없습니다. 안의 submission·dataMap·컴포넌트를 골라 복사해 주세요.' });
			return false;
		}
		const copied = nodes.map(node => (leadOf(doc.text, node.start) ?? '') + doc.text.slice(node.start, node.end));
		set({ copied });
		// 다른 화면용(이 확장만 읽는 형식) + 글자로(Source·다른 편집기에 붙여 넣기)
		clip?.setData(CLIP_NODES, JSON.stringify(copied));
		clip?.setData('text/plain', copied.map(xml => xml.trim()).join('\n'));
		return true;
	},

	paste: (clip, at) => {
		const { doc, selected } = get();
		const copied = fromClip(clip) ?? get().copied;
		// Data 트리의 Submission 루트(번호 -1)는 xf:model에 붙여 넣는다
		const index = at?.index ?? (selected === -1 && doc?.root ? findNode(doc.root, n => n.tag === 'xf:model')?.index : selected);
		const path = doc?.root && pathTo(doc.root, index);
		if (!doc || !copied || !path || path.length < 2 || index === undefined) {
			return false;
		}
		post({ type: 'paste', version: doc.version, index, xml: copied, ...at && { position: at.position } });
		return true;
	},

	del: () => {
		const { doc, gridColumns } = get();
		const [node, ...more] = targets(get());
		if (!doc || !node) {
			return false;
		}
		// 그리드 칸만 골랐으면 칸 하나가 아니라 그 열을 지운다(header·gBody 등 모든 행, 행·열이 어긋나지 않게)
		const grid = gridOfCells(doc.root!, [node, ...more]);
		if (grid) {
			gridColumns('delete', grid.index, [node, ...more].map(n => n.index));
			return true;
		}
		post({ type: 'delete', version: doc.version, index: node.index, ...more.length && { more: more.map(n => n.index) } });
		set({ selected: pathTo(doc.root!, node.index)!.at(-2)!.index, extra: [] });
		return true;
	},

	cut: (clip) => {
		const { copy, del } = get();
		return copy(clip) && del();
	},

	unmerge: (cells) => {
		const { doc } = get(), root = doc?.root;
		const merged = root && (cells?.map(i => nodeAt(root, i)).filter((n): n is XmlNode => !!n) ?? targets(get())).filter(n => isMerged(root, n));
		if (!doc || !merged?.length) {
			if (doc) { post({ type: 'warn', message: '병합된 셀을 골라 주세요.' }); }
			return false;
		}
		post({ type: 'unmergeCells', version: doc.version, index: merged[0].index, more: merged.slice(1).map(n => n.index) });
		set({ selected: merged[0].index, extra: [] });
		return true;
	},

	gridColumns: (op, grid, cells) => {
		const { doc } = get();
		if (!doc || !cells.length) {
			return;
		}
		post({ type: 'gridColumns', version: doc.version, index: grid, cells, op });
		// 지우면 그리드를, 옮기면 그 칸을 고른 채로(옮긴 뒤 번호가 바뀌므로 그리드)
		set({ selected: grid, extra: [] });
	},

	merge: () => {
		const { doc } = get();
		const nodes = targets(get());
		if (!doc?.root || !nodes.length) {
			return false;
		}
		const problem = mergeProblem(doc.root, nodes);
		if (problem) {
			post({ type: 'warn', message: problem });
			return false;
		}
		post({ type: 'mergeCells', version: doc.version, index: nodes[0].index, more: nodes.slice(1).map(n => n.index) });
		// 왼쪽 위 셀(문서에서 가장 앞)이 남는다. 그 앞 노드 번호는 안 바뀐다
		set({ selected: nodes[0].index, extra: [] });
		return true;
	},

	move: (dragged, target, position) => {
		const { doc } = get();
		if (doc) {
			const group = targets(get()).map(n => n.index);
			const more = group.includes(dragged) ? group.filter(i => i !== dragged) : [];
			const map = doc.root && movedIndexes(doc.root, [dragged, ...more], target, position);
			const check = [dragged, ...more].map(i => [i, (doc.root && nodeAt(doc.root, i)?.tag) ?? ''] as [number, string]);
			set({ pendingMove: map ? { version: doc.version, map, check } : undefined });
			post({ type: 'move', version: doc.version, dragged, target, position, ...more.length && { more } });
		}
	},

	// 탭 줄(Design… · Property/Event · Outline/Data)마다 이름이 달라 한 목록에 같이 둔다: 바꾼 줄의 순서 + 다른 줄의 순서는 그대로
	setTabOrder: (order) => {
		const merged = [...order, ...(get().tabOrder ?? []).filter(n => !order.includes(n))];
		set({ tabOrder: merged });
		post({ type: 'setTabOrder', order: merged });
	},

	reorderPaletteFavorites: (keys) => {
		set({ paletteFavorites: keys });
		post({ type: 'reorderPaletteFavorites', keys });
	},
	togglePaletteFavorite: (def) => {
		const key = paletteKey(def), current = get().paletteFavorites, favorite = !current.includes(key);
		set({ paletteFavorites: favorite ? [...current, key] : current.filter(k => k !== key) });
		post({ type: 'setPaletteFavorite', component: { id: def.id, ns: def.ns, realType: def.realType }, favorite });
	},

	setTabPosition: (position) => {
		set({ tabPosition: position });
		post({ type: 'setTabPosition', position });
	},

	setMinimap: (on) => {
		set({ minimap: on });
		post({ type: 'setMinimap', on });
	},

	setCodeBlame: (on) => {
		set({ codeBlame: on });
		post({ type: 'setCodeBlame', on });
	},
}));

/** 지금 고른 셀들을 병합할 수 있는지 */
export function canMerge(): boolean {
	const state = useEditorStore.getState(), root = state.doc?.root;
	return !!root && !mergeProblem(root, targets(state));
}

/** 모두 같은 gridView의 칸(column)이면 그 그리드 */
export function gridOfCells(root: XmlNode, cells: XmlNode[]): XmlNode | undefined {
	const grids = cells.map(c => { const path = pathTo(root, c.index); return path?.at(-1)?.tag.endsWith(':column') ? path.find(n => n.tag.endsWith(':gridView')) : undefined; });
	return grids[0] && grids.every(g => g === grids[0]) ? grids[0] : undefined;
}

/** 병합을 풀 수 있는 셀이 있는지(메뉴 켜짐). cells가 없으면 고른 노드 */
export function canUnmerge(cells?: number[]): boolean {
	const state = useEditorStore.getState(), root = state.doc?.root;
	return !!root && (cells?.map(i => nodeAt(root, i)).filter((n): n is XmlNode => !!n) ?? targets(state)).some(n => isMerged(root, n));
}

/** 지금 고른 노드들(문서 순서, 안에 든 것은 제외) */
export function targets({ doc, selected, extra }: EditorState): XmlNode[] {
	const root = doc?.root;
	if (!root) { return []; }
	const nodes = [...extra, ...selected === undefined ? [] : [selected]]
		.map(i => pathTo(root, i)).filter(path => path && path.length > 2).map(path => path!.at(-1)!);
	return nodes.filter(n => !nodes.some(o => o !== n && o.start <= n.start && n.end <= o.end)).sort((a, b) => a.start - b.start);
}

