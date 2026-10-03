import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import type { SettingsMenuItem, ToExtension, ToWebview } from '../core/protocol';
import { defOf, findNode, findTag, nodeAt, pathTo, type XmlNode } from '../core/xmlModel';
import { DATA_KINDS, type DataKind } from '../core/data';
import { newSubmissionFields, submissionFields, type SubmissionFields } from '../core/submission';
import { Canvas } from './design/canvas';
import { PropertyPane } from './ui/properties';
import { DataEditor } from './ui/dataEditor';
import { SubmissionEditor } from './ui/submissionEditor';
import { GridBindDialog } from './ui/gridBindDialog';
import { ChoicesEditor, choicesKind, type ChoicesKind } from './ui/choicesEditor';
import { boundColumnIds, listColumns } from '../core/grid';
import { xmlSupport } from './editor/xmlSupport';
import { CodeEditor, type CodeEditorHandle } from './editor/codeEditor';
import { lazy, scriptLanguage, scriptTools, xmlCompletions, xmlHover } from './editor/completions';
import { Tabs } from './ui/tabs';
import { PalettePane } from './ui/palette';
import { ThemeColorsEditor } from './ui/themeColorsEditor';
import { Toast } from './ui/toast';
import { Menu } from './ui/menu';
import { useLinkTabs } from './ui/linkedFile';
import { FIXED_TABS } from '../core/links';
import { dropZone, TreeItem, useDataReorder, useFold, useTreeRename, type DragData, type Fold, type Problems } from './ui/tree';
import { problemAncestors, screenProblems } from '../core/check';
import { useEventHandler } from './eventHandler';
import { canMerge, post, useEditorStore } from './store';
import { isMergeCell } from '../core/merge';
import { isModKey } from './keys';
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

const isDataNode = (n: XmlNode) => /:(dataMap|dataList)$/.test(n.tag);

type Popup = { key: string; error?: string; busy?: boolean } & (
	| { kind: 'data'; id: string }
	| { kind: 'submission'; initial: SubmissionFields; source?: { id?: string; index: number } }
	| { kind: 'choices'; index: number; id?: string; choices: ChoicesKind });

function useComponentShortcuts() {
	useEffect(() => {
		// 캔버스에 그린 컴포넌트 안의 input·select(미리보기 모양)는 클릭하면 포커스를 가져가지만 실제 입력칸이 아니다 → 제외.
		// 이걸 입력칸으로 보면 input류 컴포넌트를 고른 뒤 Delete·복붙이 간헐적으로 안 먹는다
		const inEditable = (e: Event) => {
			const el = e.composedPath()[0] as HTMLElement;
			return !!el.closest?.('input, textarea, select, dialog, [contenteditable], .code-editor') && !el.closest('[data-wse]');
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
			} else if (isModKey(e, 'm') && !inEditable(e) && useEditorStore.getState().merge()) {
				// 셀 병합(Ctrl+M)
				e.preventDefault();
			}
		};
		document.addEventListener('copy', onClip);
		document.addEventListener('cut', onClip);
		document.addEventListener('paste', onClip);
		window.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('copy', onClip);
			document.removeEventListener('cut', onClip);
			document.removeEventListener('paste', onClip);
			window.removeEventListener('keydown', onKey);
		};
	}, []);
}

function App() {
	const doc = useEditorStore(s => s.doc);
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
	const setTabPosition = useEditorStore(s => s.setTabPosition);
	const otherSide = tabPosition === 'top' ? 'bottom' : 'top';
	const events = api?.events;
	const [activeTab, setActiveTab] = useState('Design');
	const [paletteOpen, setPaletteOpen] = useState(false);
	const rightPanel = usePanelRef();
	const [rightOpen, setRightOpen] = useState(true);
	const [settingsMenu, setSettingsMenu] = useState<HTMLElement>();
	const [themeColors, setThemeColors] = useState(false);
	/** merge: 병합 메뉴를 보이고(값은 켜짐 여부). mergeOnly: 그 메뉴만(Outline·group 셀) */
	const [dataMenu, setDataMenu] = useState<{ x: number; y: number; index: number; grid?: { hasFooter: boolean; at: number; onColumn: boolean }; merge?: boolean; mergeOnly?: boolean }>();
	const [popups, setPopups] = useState<Popup[]>([]);
	const [gridBind, setGridBind] = useState<{ grid: number; list: number }>();
	const linkTabs = useLinkTabs(activeTab, LOADING);
	// 보고 있던 연결 탭이 지워지면 Design으로
	const shownTab = FIXED_TABS.includes(activeTab) || linkTabs.labels.includes(activeTab) ? activeTab : 'Design';
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
			if (msg.type === 'popupAck') {
				const { popup, ok, error } = msg;
				setPopups(curr => ok ? curr.filter(p => p.key !== popup)
					: curr.map(p => p.key === popup ? { ...p, busy: false, error: error ?? '적용하지 못했어.' } : p));
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
			updatePopup(key, { error: '원래 Submission을 찾지 못했어. 다시 열어 줘.' });
		}
	};
	useEffect(() => {
		const path = body && pathTo(body, selected);
		if (path) {
			outline.reveal(path.slice(0, -1));
		}
	}, [selected, body]); // outline 객체는 매 렌더 새로 만들어지므로 선택이 바뀔 때만 실행

	const refOf = (n: XmlNode) => {
		if (n.attrs.id && /:dataList$/.test(n.tag)) { return `data:${n.attrs.id}`; }
		if (!root || !n.attrs.id || !/:(key|column)$/.test(n.tag)) { return undefined; }
		const owner = pathTo(root, n.index)?.at(-3);
		return owner?.attrs.id && isDataNode(owner) ? `data:${owner.attrs.id}.${n.attrs.id}` : undefined;
	};
	const bindRefTo = (index: number, value: string) => {
		if (!doc || !root) { return; }
		const target = nodeAt(root, index);
		const isGrid = !!target?.tag.endsWith(':gridView');
		const isList = !value.includes('.');
		if (isGrid !== isList) {
			post({ type: 'warn', message: isGrid ? 'gridView에는 dataList를 끌어다 놓아 줘.' : 'dataList는 gridView에만 바인딩할 수 있어.' });
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
	const openEditor = (index: number) => {
		const n = body && nodeAt(body, index);
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
		if (!(cell && keepsSelection(cell.index))) { setSelected(grid ? grid.index : cell!.index); }
		setDataMenu({ x, y, index: (grid ?? cell)!.index, merge: cell ? canMerge() : undefined, mergeOnly: !grid,
			...grid && { grid: { hasFooter: grid.children.some(c => c.tag.endsWith(':footer')), at: index, onColumn: !!path?.at(-1)?.tag.endsWith(':column') } } });
	};
	const outlineContext = (e: MouseEvent<HTMLDivElement>, n: XmlNode) => {
		if (!isMergeCell(n)) { return; }
		e.preventDefault();
		if (!keepsSelection(n.index)) { setSelected(n.index); }
		setDataMenu({ x: e.clientX, y: e.clientY, index: n.index, merge: canMerge(), mergeOnly: true });
	};
	const dataReorder = useDataReorder(doc?.version, model, dataCollection);
	const rename = useTreeRename(root, selected, (id, index) => editAttr('id', id, index));
	// 화면 점검(겹치는 id·없는 데이터·컬럼 바인딩·Script에 없는 이벤트 함수): Outline·Data 줄에 경고 표시
	const scriptText = doc?.script.text;
	const problems = useMemo((): Problems | undefined => {
		if (!root) { return undefined; }
		const of = screenProblems(root, scriptText);
		return { of, inside: problemAncestors(root, of) };
	}, [root, scriptText]);
	const tree = (tops: XmlNode[], fold: Fold, interactive?: boolean) => tops.length
		? <div role="tree">{tops.map(top => <TreeItem key={top.index} node={top} depth={0} selected={selected} extra={extra} onSelect={setSelected} onContextMenu={interactive ? outlineContext : dataContext} onDoubleClick={interactive ? (n => openEditor(n.index)) : openDataEditor} fold={fold} defs={defs?.defs} interactive={interactive} bindRef={interactive ? undefined : refOf} reorder={interactive ? undefined : dataReorder} rename={rename} problems={problems} />)}</div>
		: <p className="empty">없음</p>;
	const foldButtons = (fold: Fold) => <>
		<button className="icon codicon codicon-expand-all" title="모두 펼치기" onClick={() => fold.setAll(true)} />
		<button className="icon codicon codicon-collapse-all" title="모두 접기" onClick={() => fold.setAll(false)} />
	</>;

	const openEventHandler = useEventHandler({ doc, defs: defs?.defs, events, scriptRef, editAttr, showScript: () => setActiveTab('Script') });

	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
	const handleDragEnd = (e: DragEndEvent) => {
		const dragged = e.active.data.current as DragData | undefined;
		const over = e.over?.data.current as DragData | undefined;
		if (dragged && over && over.index !== dragged.index) {
			move(dragged.index, over.index, dropZone(e.active.rect.current.translated, e.over!.rect, over.container, over.depth));
		}
	};

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
						title={`탭을 ${otherSide === 'top' ? '위' : '아래'}로`} aria-label={`탭을 ${otherSide === 'top' ? '위' : '아래'}로`} onClick={() => setTabPosition(otherSide)} /></>} keepMounted={['Script', 'Source', ...linkTabs.labels]} order={tabOrder} onReorder={setTabOrder} active={shownTab} onActive={setActiveTab} hints={linkTabs.hints} keys={linkTabs.keys} onTabMenu={linkTabs.onTabMenu} onAdd={() => post({ type: 'addTab' })} items={{
						Design: doc?.error ? <p className="error">{doc.error}</p>
							: body && defs ? <Group orientation="horizontal" className="design-layout">
								{paletteOpen && <Panel key="palette" id="palette" defaultSize={220} minSize={150} maxSize={360}><PalettePane /></Panel>}
								{paletteOpen && <Separator key="palette-resizer" className="resizer" />}
								<Panel key="design-canvas" id="design-canvas" minSize={100}><div className="design-canvas">
									{styles?.error && <p className="warning" title={styles.error}>{styles.error}</p>}
									<Canvas body={body} defs={defs.defs} sheets={styles?.css} selected={selected} extra={extra} onSelect={setSelected} onEditText={editText}
										onMove={move} onEditAttr={editAttr} onOpenFrame={openFrame} onOpenEditor={openEditor} onBindRef={bindRefTo} onContextMenu={canvasContext}
										onInsertComponent={(drag, index, position) => post({ type: 'insertComponent', ...drag, index, position })}
										idChoices={i => { const at = root && pathTo(root, i); return at && boundColumnIds(root, at); }} />
								</div></Panel>
							</Group>
								: LOADING,
						Script: doc ? <CodeEditor ref={scriptRef} target="script" lang={scriptLanguage} complete={jsTools.complete} hover={jsTools.hover} lint="js" text={doc.script.text} version={doc.version}
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
						<div className="pane">
							<Tabs order={tabOrder} onReorder={setTabOrder} items={{
								Outline: <DndContext sensors={sensors} onDragEnd={handleDragEnd}>{tree(body ? [body] : [], outline, true)}</DndContext>,
								Data: tree(dataRoots, data),
							}}
								actions={{ Outline: foldButtons(outline), Data: foldButtons(data) }} />
						</div>
					</Panel>
				</Group>
				</div>
			</Panel>
		</Group>
		{dataMenu && <Menu key={`${dataMenu.x},${dataMenu.y}`} x={dataMenu.x} y={dataMenu.y} onClose={() => setDataMenu(undefined)}>
				{dataMenu.mergeOnly ? null : dataMenu.grid ? (Object.keys(GRID_MENU) as (keyof typeof GRID_MENU)[]).filter(part => part !== 'columnLeft' || dataMenu.grid!.onColumn).map(part => <button key={part} role="menuitem" disabled={part === 'footer' && dataMenu.grid!.hasFooter}
					onClick={() => { if (doc) { post({ type: 'addGridPart', version: doc.version, index: dataMenu.index, part, at: dataMenu.grid!.at }); } setDataMenu(undefined); }}>
					{part === 'column' && dataMenu.grid!.onColumn ? '오른쪽에 Column 추가' : GRID_MENU[part]}</button>)
				: dataMenu.index === -1
					? <button role="menuitem" onClick={() => { setDataMenu(undefined); openSubmissionEditor(); }}>Submission 추가</button>
					: DATA_KINDS.map(kind => <button key={kind} role="menuitem" onClick={() => addData(kind)}>{kind[0].toUpperCase() + kind.slice(1)} 추가</button>)}
				{dataMenu.merge !== undefined && <>
					{!dataMenu.mergeOnly && <div className="menu-separator" role="separator" />}
					<button role="menuitem" disabled={!dataMenu.merge} onClick={() => { setDataMenu(undefined); useEditorStore.getState().merge(); }}>병합<kbd>Ctrl+M</kbd></button>
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
