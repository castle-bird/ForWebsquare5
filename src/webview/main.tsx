import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import type { SettingsMenuItem, ToExtension, ToWebview } from '../core/protocol';
import { defOf, findNode, findTag, nodeAt, pathTo, type XmlNode } from '../core/xmlModel';
import { DATA_KINDS, isDataNode, type DataKind } from '../core/data';
import { newSubmissionFields, submissionFields, type SubmissionFields } from '../core/submission';
import { Canvas } from './design/canvas';
import { PropertyPane } from './ui/properties';
import { DataEditor } from './ui/dataEditor';
import { SubmissionEditor } from './ui/submissionEditor';
import { GridBindDialog } from './ui/gridBindDialog';
import { GridCellsEditor } from './ui/gridCellsEditor';
import { InfoPane } from './ui/infoPane';
import { UsedTablesPane } from './ui/usedTablesPane';
import { ChoicesEditor, choicesKind, type ChoicesKind } from './ui/choicesEditor';
import { boundColumnIds, canMoveGridColumn, listColumns } from '../core/grid';
import { xmlSupport } from './editor/xmlSupport';
import { CodeEditor, type CodeEditorHandle } from './editor/codeEditor';
import { lazy, scriptLanguage, scriptTools, xmlCompletions, xmlHover } from './editor/completions';
import { Tabs } from './ui/tabs';
import { PalettePane } from './ui/palette';
import { ThemeColorsEditor } from './ui/themeColorsEditor';
import { Toast } from './ui/toast';
import { Menu } from './ui/menu';
import { useLinkTabs } from './ui/linkedFile';
import { FIXED_TABS, linkTarget } from '../core/links';
import { useFold } from './ui/tree';
import { TreePane } from './ui/treePane';
import { useEventHandler } from './eventHandler';
import { canMerge, canUnmerge, gridOfCells, post, targets, useEditorStore } from './store';
import { isMergeCell } from '../core/merge';
import '@vscode/codicons/dist/codicon.css';
import './style.css';

const XML = xmlSupport();

/** 탭 줄 톱니바퀴 메뉴(null은 구분선). 찾기 어려운 설정·명령을 한곳에 */
const SETTINGS_MENU: ([SettingsMenuItem, string] | null)[] = [
	['codeTheme', '코드 편집기 테마 변경…'], ['importCodeTheme', '테마 파일 가져오기…'], ['themeColors', '테마 색 덮어쓰기…'], null,
	['sqlDialect', 'SQL 방언…'], ['setup', '도구 경로 설정…'], null,
	['settings', '확장 설정 모두 보기…'],
];
const GRID_MENU = { columnLeft: '왼쪽에 Column 추가', column: 'Column 추가', row: 'Row 추가', header: 'Header 추가', subTotal: 'subTotal 추가', footer: 'footer 추가' } as const;

const LOADING = <p className="empty">불러오는 중…</p>;
/** 실험 기능 탭: 탭 줄 오른쪽(설정 버튼 왼쪽)에 고정 */
const ERD_TAB = 'ERD';

type Popup = { key: string; error?: string; busy?: boolean } & (
	| { kind: 'data'; id: string }
	| { kind: 'submission'; initial: SubmissionFields; source?: { id?: string; index: number } }
	| { kind: 'choices'; index: number; id?: string; choices: ChoicesKind }
	| { kind: 'gridCells'; index: number; id?: string });

/**
 * 마우스 뒤로·앞으로 버튼(button 3·4), IDE처럼: 이 편집기 안에서 본 탭 순서를 먼저 따라가고, 끝에 닿으면 VS Code 이동 기록(이전·다음 파일)으로 넘긴다.
 * 탭이 바뀌는 길(클릭·이벤트 코드 버튼 → Script 등)이 여러 곳이라 보이는 탭(shownTab)이 바뀔 때 기록한다. 지워진 연결 탭은 건너뜀(exists).
 * 버튼을 누를 때도 막아야 웹뷰 안에서 브라우저 뒤로 가기가 안 일어난다
 */
function useTabHistory(shownTab: string, show: (name: string) => void, exists: (name: string) => boolean) {
	const back = useRef<string[]>([]), forward = useRef<string[]>([]), prev = useRef(shownTab), moving = useRef(false);
	useEffect(() => {
		if (prev.current === shownTab) { return; }
		if (!moving.current) { back.current.push(prev.current); forward.current = []; }
		moving.current = false;
		prev.current = shownTab;
	}, [shownTab]);
	const navigate = useRef<(isBack: boolean) => void>(undefined);
	navigate.current = isBack => {
		const from = isBack ? back.current : forward.current;
		let name = from.pop();
		while (name !== undefined && (name === shownTab || !exists(name))) { name = from.pop(); }
		if (name === undefined) { post({ type: 'navigate', back: isBack }); return; }
		(isBack ? forward.current : back.current).push(shownTab);
		moving.current = true;
		show(name);
	};
	useEffect(() => {
		const onMouse = (e: globalThis.MouseEvent) => {
			if (e.button !== 3 && e.button !== 4) { return; }
			e.preventDefault();
			if (e.type === 'mouseup') { navigate.current?.(e.button === 3); }
		};
		window.addEventListener('mousedown', onMouse, true);
		window.addEventListener('mouseup', onMouse, true);
		return () => {
			window.removeEventListener('mousedown', onMouse, true);
			window.removeEventListener('mouseup', onMouse, true);
		};
	}, []);
}

function useComponentShortcuts() {
	useEffect(() => {
		// 캔버스에 그린 컴포넌트 안의 input·select(미리보기 모양)는 클릭하면 포커스를 가져가지만 실제 입력칸이 아니다 → 제외.
		// 이걸 입력칸으로 보면 input류 컴포넌트를 고른 뒤 Delete·복붙이 간헐적으로 안 먹는다
		const inEditable = (e: Event) => {
			const el = e.composedPath()[0] as HTMLElement;
			// 팝업 안에 포커스가 있으면 이벤트가 body로 와도(VS Code 복사·붙여넣기는 글자 선택이 없으면 body로 보낸다) 팝업 것
			// ERD 탭(사용 테이블 그림)이 보이면 Design 단축키는 쉰다: 그림의 Delete·복붙은 그림 것(포커스가 body여도). 숨은 ERD는 상관없음
			return !!el.closest?.('input, textarea, select, dialog, [contenteditable], .code-editor, .used-tables') && !el.closest('[data-wse]') || !!document.activeElement?.closest('dialog')
				|| !!document.querySelector('.used-tables')?.getClientRects().length;
		};
		const onClip = (e: ClipboardEvent) => {
			if (inEditable(e) || String(window.getSelection() ?? '')) {
				return;
			}
			const { copy, cut, paste } = useEditorStore.getState();
			const done = e.type === 'copy' ? copy(e.clipboardData) : e.type === 'cut' ? cut(e.clipboardData) : paste(e.clipboardData);
			if (done) {
				e.preventDefault();
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Delete' && !inEditable(e) && useEditorStore.getState().del()) {
				e.preventDefault();
			}
			// 포커스가 아무 데도 없을 때(VS Code가 웹뷰로 돌아오며 body에 둔 경우) Space·PageUp/Down으로 브라우저가 스크롤하지 않게
			if (e.target === document.body && [' ', 'PageDown', 'PageUp'].includes(e.key) && !e.defaultPrevented) {
				e.preventDefault();
			}
		};
		// 캡처 단계에서 본다: 코드 편집기는 cut을 처리하며 잘린 줄 DOM을 다시 그려, 버블 단계에선 이벤트 대상이 문서에서 떨어져
		// 편집기 안인지 못 알아본다(→ 고른 컴포넌트를 잘라 클립보드를 XML로 덮어썼다)
		document.addEventListener('copy', onClip, true);
		document.addEventListener('cut', onClip, true);
		document.addEventListener('paste', onClip, true);
		window.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('copy', onClip, true);
			document.removeEventListener('cut', onClip, true);
			document.removeEventListener('paste', onClip, true);
			window.removeEventListener('keydown', onKey);
		};
	}, []);
}

function App() {
	const doc = useEditorStore(s => s.doc);
	// 코드 편집기 합자: VS Code editor.fontLigatures(themes.ts editorBase가 읽는다)
	const fontFeatures = useEditorStore(s => s.codeOptions.fontFeatures);
	useEffect(() => document.body.style.setProperty('--code-font-features', fontFeatures), [fontFeatures]);
	const defs = useEditorStore(s => s.defs);
	const styles = useEditorStore(s => s.styles);
	const api = useEditorStore(s => s.api);
	const modules = useEditorStore(s => s.modules);
	const selected = useEditorStore(s => s.selected);
	const extra = useEditorStore(s => s.extra);
	const setSelected = useEditorStore(s => s.setSelected);
	const handleMessage = useEditorStore(s => s.handleMessage);
	const editAttr = useEditorStore(s => s.editAttr);
	const editSelected = useEditorStore(s => s.editSelected);
	const editText = useEditorStore(s => s.editText);
	const openFrame = useEditorStore(s => s.openFrame);
	const move = useEditorStore(s => s.move);
	const tabOrder = useEditorStore(s => s.tabOrder);
	const setTabOrder = useEditorStore(s => s.setTabOrder);
	const tabPosition = useEditorStore(s => s.tabPosition);
	const minimapOn = useEditorStore(s => s.minimap);
	const setTabPosition = useEditorStore(s => s.setTabPosition);
	const otherSide = tabPosition === 'top' ? 'bottom' : 'top';
	const events = api?.events;
	const [activeTab, setActiveTab] = useState('Design');
	const [paletteOpen, setPaletteOpen] = useState(false);
	const rightPanel = usePanelRef();
	const [rightOpen, setRightOpen] = useState(true);
	// ERD(그림이 넓어야 함)에 들어가면 우측 패널을 접고, 나오면 들어가기 전 상태로
	const reopenRight = useRef(false);
	const showTab = (name: string) => {
		if (name === ERD_TAB && shownTab !== ERD_TAB) {
			reopenRight.current = !rightPanel.current?.isCollapsed();
			rightPanel.current?.collapse();
		} else if (name !== ERD_TAB && shownTab === ERD_TAB && reopenRight.current) {
			reopenRight.current = false;
			rightPanel.current?.expand();
		}
		setActiveTab(name);
	};
	const [settingsMenu, setSettingsMenu] = useState<HTMLElement>();
	const [themeColors, setThemeColors] = useState(false);
	/**
	 * merge: 병합 메뉴를 보이고(값은 켜짐 여부). unmerge: 병합 해제 대상 셀(있으면 메뉴를 보임). mergeOnly: 그 메뉴들만(Outline·group 셀).
	 * grid.column: 누른 칸의 열 옮기기·지우기(cells: 지울 칸들, left·right: 옮길 수 있는지)
	 */
	const [dataMenu, setDataMenu] = useState<{ x: number; y: number; index: number; merge?: boolean; unmerge?: number[]; mergeOnly?: boolean;
		grid?: { hasFooter: boolean; at: number; onColumn: boolean; column?: { index: number; cells: number[]; left: boolean; right: boolean } } }>();
	const [popups, setPopups] = useState<Popup[]>([]);
	const [gridBind, setGridBind] = useState<{ grid: number; list: number }>();
	const linkTabs = useLinkTabs(activeTab, LOADING);
	// 보고 있던 연결 탭이 지워지면 Design으로
	const shownTab = FIXED_TABS.includes(activeTab) || activeTab === ERD_TAB || linkTabs.labels.includes(activeTab) ? activeTab : 'Design';
	useTabHistory(shownTab, showTab, name => FIXED_TABS.includes(name) || name === ERD_TAB || linkTabs.labels.includes(name));
	const pendingDataCreate = useRef<{ kind: DataKind; ids: Set<string>; version: number } | undefined>(undefined);
	const scriptRef = useRef<CodeEditorHandle>(null);

	const updatePopup = (key: string, patch: Partial<Popup>) => setPopups(curr => curr.map(p => p.key === key ? { ...p, ...patch } as Popup : p));
	const closePopup = (key: string) => setPopups(curr => curr.filter(p => p.key !== key));
	const postPopupEdit = (key: string, msg: Extract<ToExtension, { popup: string }>) => {
		updatePopup(key, { error: '', busy: true });
		post(msg);
	};

	useEffect(() => {
		const onMessage = (e: MessageEvent<ToWebview>) => {
			const msg = e.data;
			if (msg.type === 'linkTabs') {
				// 보고 있던 탭의 이름이 바뀌면 새 이름으로 계속 본다
				const before = useEditorStore.getState().linkTabs;
				const renamed = (label: string) => msg.tabs.find(t => t.id === before.find(b => b.label === label)?.id)?.label;
				setActiveTab(active => msg.select ?? renamed(active) ?? active);
			}
			if (msg.type === 'reveal') {
				// 정의로 이동: 그 편집기 탭을 보인다(자리 이동은 편집기가 같은 메시지로)
				const label = useEditorStore.getState().linkTabs.find(t => linkTarget(t.id) === msg.target)?.label;
				if (label) {
					setActiveTab(label);
				}
			}
			if (msg.type === 'popupAck') {
				const { popup, ok, error } = msg;
				setPopups(curr => ok ? curr.filter(p => p.key !== popup)
					: curr.map(p => p.key === popup ? { ...p, busy: false, error: error ?? '적용하지 못했습니다.' } : p));
			} else {
				handleMessage(msg);
			}
		};
		window.addEventListener('message', onMessage);
		post({ type: 'ready' });
		return () => window.removeEventListener('message', onMessage);
	}, [handleMessage]);

	useComponentShortcuts();

	const root = doc?.root;
	const xmlComplete = useMemo(() => lazy(() => xmlCompletions(root, defs?.defs ?? [])), [root, defs]);
	const xmlHoverSource = useMemo(() => xmlHover(root, defs?.defs ?? []), [root, defs]);
	const jsTools = useMemo(() => scriptTools(root, defs?.defs ?? [], api?.api ?? {}, modules?.files), [root, defs, api, modules]);
	const nodePath = root && selected !== undefined ? pathTo(root, selected) : undefined, node = nodePath?.at(-1);
	// 바인딩된 그리드의 본문 셀: id를 dataList 컬럼 id 목록에서 고른다
	const cellIds = root && nodePath && boundColumnIds(root, nodePath);
	const body = root && root.children.find(c => c.tag === 'body');
	const head = root?.children.find(c => c.tag === 'head');
	const model = root && findTag(root, 'xf:model');
	const dataCollection = model?.children.find(c => c.tag === 'w2:dataCollection');
	// 매 렌더 새 배열이면 아래 dataRoots useMemo가 매번 깨져 Data 트리가 다시 그려진다
	const submissions = useMemo(() => model?.children.filter(c => c.tag === 'xf:submission') ?? [], [model]);
	const dataRoots = useMemo(() => [
		...dataCollection ? [dataCollection] : [],
		...model ? [{ index: -1, tag: 'Submission', ns: '', attrs: {}, start: -1, end: -1, children: submissions }] : [],
	], [dataCollection, submissions, model]);

	const outline = useFold(), data = useFold();
	const openSubmissionEditor = () => {
		if (!doc || !root || !model) { return; }
		setSelected(-1);
		setPopups(curr => [...curr, { key: crypto.randomUUID(), kind: 'submission', initial: newSubmissionFields(root) }]);
	};
	const editSubmission = (item: XmlNode) => {
		if (!doc) { return; }
		setSelected(item.index);
		const key = `sub_${item.attrs.id ?? item.index}`;
		setPopups(curr => curr.some(p => p.key === key) ? curr
			: [...curr, { key, kind: 'submission', initial: submissionFields(item), source: { id: item.attrs.id, index: item.index } }]);
	};
	const dataContext = (e: MouseEvent<HTMLDivElement>, n: XmlNode) => {
		if (n.index !== -1 && n.index !== dataCollection?.index) { return; }
		e.preventDefault();
		setSelected(n.index);
		setDataMenu({ x: e.clientX, y: e.clientY, index: n.index });
	};
	const addData = (kind: DataKind) => {
		if (doc && dataMenu && dataCollection) {
			if (kind === 'dataMap' || kind === 'dataList') {
				pendingDataCreate.current = { kind, ids: new Set(dataCollection.children.map(c => c.attrs.id)), version: doc.version };
			}
			data.reveal([dataCollection]);
			post({ type: 'addData', version: doc.version, index: dataMenu.index, kind });
		}
		setDataMenu(undefined);
	};
	useEffect(() => {
		const pending = pendingDataCreate.current;
		if (!pending || !doc || doc.version === pending.version) { return; }
		pendingDataCreate.current = undefined;
		const created = dataCollection?.children.find(c => c.tag.endsWith(`:${pending.kind}`) && c.attrs.id && !pending.ids.has(c.attrs.id));
		if (created) { openDataPopup(created.attrs.id); }
	}, [doc?.version, dataCollection]);
	const openDataPopup = (id: string) => setPopups(curr => [...curr.filter(p => p.key !== `data:${id}`), { key: `data:${id}`, kind: 'data', id }]);
	const openDataEditor = (item: XmlNode) => {
		if (item.index === -1) { openSubmissionEditor(); return; }
		if (item.tag === 'xf:submission') { editSubmission(item); return; }
		if (doc && isDataNode(item) && item.attrs.id) {
			setSelected(item.index);
			openDataPopup(item.attrs.id);
		}
	};
	const findSubmission = (source: { id?: string; index: number }) => submissions.find(s => source.id ? s.attrs.id === source.id : s.index === source.index);
	const applySubmission = (key: string, source: { id?: string; index: number } | undefined, fields: SubmissionFields) => {
		if (!doc || !model) { return; }
		const submissionRoot = dataRoots.find(n => n.index === -1);
		if (submissionRoot) { data.reveal([submissionRoot]); }
		if (!source) {
			postPopupEdit(key, { type: 'addSubmission', version: doc.version, index: model.index, popup: key, fields });
			return;
		}
		const node = findSubmission(source);
		if (node) {
			postPopupEdit(key, { type: 'editSubmission', version: doc.version, index: node.index, popup: key, fields });
		} else {
			updatePopup(key, { error: '원래 Submission을 찾지 못했습니다. 다시 열어 주세요.' });
		}
	};
	const bindRefTo = (index: number, value: string) => {
		if (!doc || !root) { return; }
		const target = nodeAt(root, index);
		const isGrid = !!target?.tag.endsWith(':gridView');
		const isList = !value.includes('.');
		if (isGrid !== isList) {
			post({ type: 'warn', message: isGrid ? 'gridView에는 dataList를 끌어다 놓아 주세요.' : 'dataList는 gridView에만 바인딩할 수 있습니다.' });
			return;
		}
		setSelected(index);
		if (isGrid) {
			const list = dataCollection?.children.find(c => c.tag.endsWith(':dataList') && `data:${c.attrs.id}` === value);
			if (list) { setGridBind({ grid: index, list: list.index }); }
			return;
		}
		post({ type: 'setAttr', version: doc.version, index, name: 'ref', value });
	};
	const openGridCells = (grid: XmlNode) => {
		setSelected(grid.index);
		setPopups(curr => [...curr.filter(p => p.kind !== 'gridCells'), { key: `gridCells:${grid.attrs.id ?? grid.index}`, kind: 'gridCells', index: grid.index, id: grid.attrs.id }]);
	};
	const openEditor = (index: number) => {
		const n = body && nodeAt(body, index);
		// 그리드(칸 밖 빈 곳·Outline): 칸 속성 표
		if (n?.tag.endsWith(':gridView')) { openGridCells(n); return true; }
		const kind = n && choicesKind(n, defOf(n, defs?.defs));
		if (!n || !kind) { return false; }
		setSelected(index);
		setPopups(curr => [...curr.filter(p => p.kind !== 'choices'), { key: `choices:${n.attrs.id ?? index}`, kind: 'choices', index, id: n.attrs.id, choices: kind }]);
		return true;
	};
	const choicesNode = (p: Extract<Popup, { kind: 'choices' }>) => {
		const n = root && (p.id ? findNode(root, c => c.attrs.id === p.id && choicesKind(c, defOf(c, defs?.defs)) === p.choices) : nodeAt(root, p.index));
		return n && choicesKind(n, defOf(n, defs?.defs)) === p.choices ? n : undefined;
	};
	// 고른 셀들이 여럿(Ctrl+클릭)이면 그 안에서 연 메뉴는 선택을 그대로 둬야 병합할 수 있다
	const keepsSelection = (index: number) => extra.length > 0 && (selected === index || extra.includes(index));
	const canvasContext = (index: number, x: number, y: number) => {
		const path = body && pathTo(body, index);
		const grid = path?.filter(n => n.tag.endsWith(':gridView')).at(-1), cell = path?.filter(isMergeCell).at(-1);
		if (!grid && !cell) { return; }
		// 여러 칸을 골라 둔 채 그 안에서 열었으면 고른 칸들, 아니면 누른 칸
		const multi = !!cell && keepsSelection(cell.index), picked = multi ? targets(useEditorStore.getState()) : cell ? [cell] : [];
		const column = grid && path?.at(-1)?.tag.endsWith(':column') ? path.at(-1) : undefined;
		if (!multi) { setSelected(grid ? grid.index : cell!.index); }
		setDataMenu({ x, y, index: (grid ?? cell)!.index, merge: cell ? canMerge() : undefined, unmerge: cell ? picked.map(n => n.index) : undefined, mergeOnly: !grid,
			...grid && { grid: { hasFooter: grid.children.some(c => c.tag.endsWith(':footer')), at: index, onColumn: !!column,
				column: column && { index: column.index, cells: (multi && root && gridOfCells(root, picked) === grid ? picked : [column]).map(n => n.index),
					left: canMoveGridColumn(grid, column.index, 'left'), right: canMoveGridColumn(grid, column.index, 'right') } } } });
	};
	const outlineContext = (e: MouseEvent<HTMLDivElement>, n: XmlNode) => {
		if (!isMergeCell(n)) { return; }
		e.preventDefault();
		const unmerge = keepsSelection(n.index) ? targets(useEditorStore.getState()).map(t => t.index) : [n.index];
		if (!keepsSelection(n.index)) { setSelected(n.index); }
		setDataMenu({ x: e.clientX, y: e.clientY, index: n.index, merge: canMerge(), unmerge, mergeOnly: true });
	};
	const openEventHandler = useEventHandler({ doc, defs: defs?.defs, events, scriptRef, editAttr, showScript: () => setActiveTab('Script') });

	return (<>
		<Group orientation="horizontal" className="shell">
			<Panel minSize={200}>
				<div className="canvas-frame">
					<Tabs position={tabPosition} end={<><button className={`tab-settings codicon codicon-settings-gear${settingsMenu ? ' active' : ''}`} title="설정" aria-label="설정" aria-haspopup="menu" aria-expanded={!!settingsMenu} draggable={false}
						// 열려 있을 때 누르면 닫기만(바깥 클릭으로 닫힌 뒤 다시 열리지 않게)
						onPointerDown={e => { if (settingsMenu) { e.stopPropagation(); } }}
						onClick={e => { const button = e.currentTarget; setSettingsMenu(open => open ? undefined : button); }} />
						<button className={`tab-panel-right codicon codicon-layout-sidebar-right${rightOpen ? ' active' : ''}`}
						title={rightOpen ? '우측 패널 접기' : '우측 패널 펼치기'} aria-label="우측 패널" aria-expanded={rightOpen} aria-controls="right-panel" draggable={false}
						onClick={() => { if (rightPanel.current?.isCollapsed()) { rightPanel.current.expand(); } else { rightPanel.current?.collapse(); } }} /></>} start={<><button className={`tab-palette codicon codicon-layout-sidebar-left${paletteOpen ? ' active' : ''}`}
						title={paletteOpen ? '팔레트 접기' : '팔레트 펼치기'} aria-label="팔레트" aria-expanded={paletteOpen} draggable={false} disabled={shownTab !== 'Design'} onClick={() => setPaletteOpen(open => !open)} />
						<button draggable={false} className={`tab-move codicon codicon-arrow-${otherSide === 'top' ? 'up' : 'down'}`}
						title={`탭을 ${otherSide === 'top' ? '위' : '아래'}로`} aria-label={`탭을 ${otherSide === 'top' ? '위' : '아래'}로`} onClick={() => setTabPosition(otherSide)} /></>} pinned={[ERD_TAB]} keepMounted={['Script', 'Source', ERD_TAB, ...linkTabs.labels]} order={tabOrder} onReorder={setTabOrder} active={shownTab} onActive={showTab} hints={linkTabs.hints} keys={linkTabs.keys} onTabMenu={linkTabs.onTabMenu} onAdd={() => post({ type: 'addTab' })} items={{
						Design: doc?.error ? <p className="error">{doc.error}</p>
							: body && defs ? <Group orientation="horizontal" className="design-layout">
								{paletteOpen && <Panel key="palette" id="palette" defaultSize={220} minSize={150} maxSize={360}><PalettePane /></Panel>}
								{paletteOpen && <Separator key="palette-resizer" className="resizer" />}
								<Panel key="design-canvas" id="design-canvas" minSize={100}><div className="design-canvas">
									{styles?.error && <p className="warning" title={styles.error}>{styles.error}</p>}
									<Canvas body={body} dataCollection={dataCollection} defs={defs.defs} sheets={styles?.css} selected={selected} extra={extra} onSelect={setSelected} onEditText={editText}
										onSelectCells={(primary, cells) => useEditorStore.setState({ selected: primary, extra: cells.filter(i => i !== primary) })}
										onMove={move} onEditAttr={editAttr} onOpenFrame={openFrame} onOpenEditor={openEditor} onBindRef={bindRefTo} onContextMenu={canvasContext}
										onInsertComponent={(drag, index, position) => post({ type: 'insertComponent', ...drag, index, position })}
										idChoices={i => { const at = root && pathTo(root, i); return at && boundColumnIds(root, at); }} />
								</div></Panel>
							</Group>
								: LOADING,
						Info: doc?.error ? <p className="error">{doc.error}</p>
							: head && doc ? <InfoPane head={head} onAttr={(name, value) => editAttr(name, value, head.index)}
								onHistory={rows => post({ type: 'editHistory', version: doc.version, index: head.index, rows })} />
							: doc ? <p className="empty">head가 없는 화면입니다.</p> : LOADING,
						[ERD_TAB]: <UsedTablesPane />,
						Script: doc ? <CodeEditor ref={scriptRef} target="script" lang={scriptLanguage} complete={jsTools.complete} hover={jsTools.hover} definition={jsTools.definition} signature={jsTools.signature} lint="js" text={doc.script.text} version={doc.version}
							readOnly={!!doc.script.note} notes={[api?.error, modules?.error, doc.script.note]} post={post} /> : LOADING,
						Source: doc ? <CodeEditor target="source" lang={XML} complete={xmlComplete} hover={xmlHoverSource} lint="xml" text={doc.text} version={doc.version} post={post} /> : LOADING,
						...linkTabs.items,
					}} />
				</div>
			</Panel>
			<Separator className={`resizer${rightOpen ? '' : ' collapsed'}`} />
			<Panel id="right-panel" className="right-panel" panelRef={rightPanel} defaultSize={320} minSize={220} collapsible collapsedSize={0} onResize={size => setRightOpen(size.asPercentage > 0)}>
				<div className="right-panel-content" inert={!rightOpen}>
				<Group orientation="vertical">
					<Panel defaultSize="55%" minSize={120}>
						<PropertyPane node={node} def={node && defOf(node, defs?.defs)} choices={cellIds ? { id: cellIds } : undefined} warning={defs?.error} onEdit={editSelected} onScript={eventName => node && openEventHandler(node, eventName)} />
					</Panel>
					<Separator className="resizer" />
					<Panel defaultSize="45%" minSize={120}>
						<TreePane body={body} dataRoots={dataRoots} model={model} dataCollection={dataCollection} outline={outline} data={data}
							onOutlineContext={outlineContext} onDataContext={dataContext} onOpenEditor={openEditor} onOpenDataEditor={openDataEditor} />
					</Panel>
				</Group>
				</div>
			</Panel>
		</Group>
		{dataMenu && <Menu key={`${dataMenu.x},${dataMenu.y}`} x={dataMenu.x} y={dataMenu.y} onClose={() => setDataMenu(undefined)}>
				{dataMenu.mergeOnly ? null : dataMenu.grid ? (Object.keys(GRID_MENU) as (keyof typeof GRID_MENU)[]).filter(part => part !== 'columnLeft' || dataMenu.grid!.onColumn).map(part => <button key={part} role="menuitem" disabled={part === 'footer' && dataMenu.grid!.hasFooter}
					onClick={() => { if (doc) { post({ type: 'addGridPart', version: doc.version, index: dataMenu.index, part, at: dataMenu.grid!.at }); } setDataMenu(undefined); }}>
					{part === 'column' && dataMenu.grid!.onColumn ? '오른쪽에 Column 추가' : GRID_MENU[part]}</button>).concat(dataMenu.grid.column ? [
						<div key="column-separator" className="menu-separator" role="separator" />,
						...(['left', 'right'] as const).map(dir => <button key={dir} role="menuitem" disabled={!dataMenu.grid!.column![dir]}
							onClick={() => { setDataMenu(undefined); useEditorStore.getState().gridColumns(dir, dataMenu.index, [dataMenu.grid!.column!.index]); }}>
							열 {dir === 'left' ? '왼쪽' : '오른쪽'}으로 이동</button>),
						<button key="delete" role="menuitem" onClick={() => { setDataMenu(undefined); useEditorStore.getState().gridColumns('delete', dataMenu.index, dataMenu.grid!.column!.cells); }}>
							열 삭제<kbd>Delete</kbd></button>,
					] : [], [
						<div key="cells-separator" className="menu-separator" role="separator" />,
						<button key="cells" role="menuitem" onClick={() => { setDataMenu(undefined); const grid = body && nodeAt(body, dataMenu.index); if (grid) { openGridCells(grid); } }}>칸 속성 표…</button>,
					])
				: dataMenu.index === -1
					? <button role="menuitem" onClick={() => { setDataMenu(undefined); openSubmissionEditor(); }}>Submission 추가</button>
					: DATA_KINDS.map(kind => <button key={kind} role="menuitem" onClick={() => addData(kind)}>{kind[0].toUpperCase() + kind.slice(1)} 추가</button>)}
				{dataMenu.merge !== undefined && <>
					{!dataMenu.mergeOnly && <div className="menu-separator" role="separator" />}
					<button role="menuitem" disabled={!dataMenu.merge} onClick={() => { setDataMenu(undefined); useEditorStore.getState().merge(); }}>병합</button>
					{dataMenu.unmerge && <button role="menuitem" disabled={!canUnmerge(dataMenu.unmerge)} onClick={() => { setDataMenu(undefined); useEditorStore.getState().unmerge(dataMenu.unmerge); }}>병합 해제</button>}
				</>}
			</Menu>}
		{settingsMenu && <Menu anchor={settingsMenu} placement="bottom-end" onClose={() => setSettingsMenu(undefined)}>
			{SETTINGS_MENU.map((item, i) => item
				? <button key={item[0]} role="menuitem" onClick={() => {
					setSettingsMenu(undefined);
					// 테마 색 덮어쓰기는 웹뷰 팝업(settings.json은 팝업 안 링크로)
					if (item[0] === 'themeColors') { setThemeColors(true); } else { post({ type: 'settingsMenu', item: item[0] }); }
				}}>{item[1]}</button>
				: <div key={i} className="menu-separator" role="separator" />)}
			<div className="menu-separator" role="separator" />
			{/* 웹뷰 안 설정: 바로 바꾸고 메뉴는 닫는다 */}
			<button role="menuitemcheckbox" aria-checked={minimapOn} onClick={() => { setSettingsMenu(undefined); useEditorStore.getState().setMinimap(!minimapOn); }}>
				<span className="menu-label"><span className={`codicon codicon-${minimapOn ? 'check' : 'blank'}`} />코드 미니맵</span></button>
		</Menu>}
		{themeColors && <ThemeColorsEditor onClose={() => setThemeColors(false)} />}
		<Toast />
		{linkTabs.menu}
		{popups.map((p, offsetIndex) => {
			const common = { externalError: p.error, offsetIndex, onClose: () => closePopup(p.key) };
			if (p.kind === 'data') {
				const node = dataCollection?.children.find(c => c.attrs.id === p.id && isDataNode(c));
				return node && <DataEditor key={p.key} {...common} node={node}
					onApply={(fields, id) => { if (doc) { postPopupEdit(p.key, { type: 'editDataFields', version: doc.version, index: node.index, popup: p.key, fields, id }); } }} />;
			}
			if (p.kind === 'submission') {
				const { source } = p;
				return <SubmissionEditor key={p.key} {...common} initial={p.initial} editing={!!source} busy={!!p.busy}
					onScript={source && ((eventName, current) => { const target = findSubmission(source); return target && openEventHandler(target, eventName, current); })}
					onConfirm={fields => applySubmission(p.key, source, fields)} />;
			}
			if (p.kind === 'gridCells') {
				const grid = root && (p.id ? findNode(root, c => c.attrs.id === p.id && c.tag.endsWith(':gridView')) : nodeAt(root, p.index));
				return grid?.tag.endsWith(':gridView') && <GridCellsEditor key={p.key} {...common} grid={grid} defs={defs?.defs}
					onApply={cells => { if (doc) { postPopupEdit(p.key, { type: 'editGridCells', version: doc.version, index: grid.index, popup: p.key, cells }); } }} />;
			}
			const node = choicesNode(p);
			return node && <ChoicesEditor key={p.key} {...common} node={node} kind={p.choices}
				sources={dataCollection?.children.filter(c => isDataNode(c) && c.attrs.id).map(c => ({ nodeset: `data:${c.attrs.id}`,
					fields: c.children.find(i => /:(columnInfo|keyInfo)$/.test(i.tag))?.children.flatMap(f => f.attrs.id ? [f.attrs.id] : []) ?? [] })) ?? []}
				onApply={fields => { if (doc) { postPopupEdit(p.key, { type: 'editChoices', version: doc.version, index: node.index, popup: p.key, fields }); } }} />;
		})}
		{gridBind && root && (() => {
			const grid = nodeAt(root, gridBind.grid), list = nodeAt(root, gridBind.list);
			if (!grid || !list) { return null; }
			return <GridBindDialog key={`${gridBind.grid}:${gridBind.list}`} gridId={grid.attrs.id ?? ''} listId={list.attrs.id ?? ''} columnCount={listColumns(list).length}
				hasContent={grid.children.some(c => /:(header|gBody)$/.test(c.tag))} onClose={() => setGridBind(undefined)}
				onConfirm={(mode, extras) => { if (doc) { post({ type: 'bindGrid', version: doc.version, index: grid.index, list: list.index, mode, extras }); } setGridBind(undefined); }} />;
		})()}
	</>);
}

createRoot(document.getElementById('root')!).render(<App />);
