import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import type { ToExtension, ToWebview } from '../core/protocol';
import { defOf, findNode, findTag, nodeAt, pathTo, type XmlNode } from '../core/xmlModel';
import { DATA_KINDS, type DataField, type DataKind } from '../core/data';
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
import { Menu } from './ui/menu';
import { useLinkTabs } from './ui/linkedFile';
import { FIXED_TABS } from '../core/links';
import { dropZone, TreeItem, useFold, type DragData, type Fold } from './ui/tree';
import { post, useEditorStore } from './store';
import '@vscode/codicons/dist/codicon.css';
import './style.css';

const XML = xmlSupport();

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
			const done = e.type === 'copy' ? copy() : e.type === 'cut' ? cut() : paste();
			if (done) {
				e.preventDefault();
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Delete' && !inEditable(e) && useEditorStore.getState().del()) {
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
	const events = api?.events;
	const [activeTab, setActiveTab] = useState('Design');
	const [dataMenu, setDataMenu] = useState<{ x: number; y: number; index: number; grid?: { hasFooter: boolean; at: number; onColumn: boolean } }>();
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

	const docVersion = useEditorStore(s => s.doc?.version);
	useEffect(() => {
		if (docVersion !== undefined) {
			post({ type: 'selection', version: docVersion, index: selected });
		}
	}, [selected, docVersion]);

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
	const canvasContext = (index: number, x: number, y: number) => {
		const grid = body && pathTo(body, index)?.filter(n => n.tag.endsWith(':gridView')).at(-1);
		if (!grid) { return; }
		setSelected(grid.index);
		setDataMenu({ x, y, index: grid.index,
			grid: { hasFooter: grid.children.some(c => c.tag.endsWith(':footer')), at: index, onColumn: !!nodeAt(body, index)?.tag.endsWith(':column') } });
	};
	const tree = (tops: XmlNode[], fold: Fold, interactive?: boolean) => tops.length
		? <div role="tree">{tops.map(top => <TreeItem key={top.index} node={top} depth={0} selected={selected} extra={extra} onSelect={setSelected} onContextMenu={interactive ? undefined : dataContext} onDoubleClick={interactive ? (n => openEditor(n.index)) : openDataEditor} fold={fold} defs={defs?.defs} interactive={interactive} bindRef={interactive ? undefined : refOf} />)}</div>
		: <p className="empty">없음</p>;
	const foldButtons = (fold: Fold) => <>
		<button className="icon codicon codicon-expand-all" title="모두 펼치기" onClick={() => fold.setAll(true)} />
		<button className="icon codicon codicon-collapse-all" title="모두 접기" onClick={() => fold.setAll(false)} />
	</>;

	// editAttr(ev:*)로 만든 문서 버전이 이 Script 편집기에 반영된 뒤에야 그 위에 안전하게 이어서 넣을 수 있다.
	// 바로 이어서 넣으면 이 편집기가 들고 있는 옛 버전으로 보내 "원본이 다른 곳에서 바뀜" 충돌이 난다.
	const pendingScaffold = useRef<{ text: string; cursorOffset: number } | null>(null);
	useEffect(() => {
		const p = pendingScaffold.current;
		if (p) {
			pendingScaffold.current = null;
			requestAnimationFrame(() => scriptRef.current?.appendAndFocus(p.text, p.cursorOffset));
		}
	}, [doc?.version]);

	const openEventHandler = (target: XmlNode, eventName: string, current = target.attrs[`ev:${eventName}`]): string | undefined => {
		const handler = current?.trim() || (target.attrs.id && `scwin.${target.attrs.id}_${eventName}`);
		if (!handler) {
			post({ type: 'warn', message: 'ID부터 입력해주세요. (Script 함수 이름이 scwin.{ID}_{이벤트})' });
			return undefined;
		}
		if (!doc || doc.script.note) {
			return undefined;
		}
		setActiveTab('Script');
		const attr = `ev:${eventName}`, attrChanges = target.attrs[attr] !== handler;
		const text = doc.script.text;
		const defined = text.search(new RegExp(`(?<![\\w$.])${handler.replace(/[.$]/g, '\\$&')}\\s*=(?!=)`));
		if (defined >= 0 || !/^[\w$]+(\.[\w$]+)*$/.test(handler)) {
			const at = defined >= 0 ? defined : text.indexOf(handler);
			if (at >= 0) {
				requestAnimationFrame(() => scriptRef.current?.focusRange(at, at + handler.length));
			}
			if (attrChanges) { editAttr(attr, handler, target.index); }
			return handler;
		}
		const def = defOf(target, defs?.defs);
		const fromDoc = def && events?.[`WebSquare.uiplugin.${def.realType}`]?.find(e => e.name === eventName)?.params?.map(p => p.name);
		const fromDef = def?.events.find(e => e.name === eventName)?.signature.match(/\(([^)]*)\)/)?.[1];
		const params = fromDoc ?? fromDef?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
		const head = `${handler} = function(${params.join(', ')}) {\n\t`;
		const lead = text.length ? '\n' : '';
		const scaffold = { text: `${lead}${head}\n};\n`, cursorOffset: lead.length + head.length };
		if (attrChanges) {
			pendingScaffold.current = scaffold;
			editAttr(attr, handler, target.index);
		} else {
			requestAnimationFrame(() => scriptRef.current?.appendAndFocus(scaffold.text, scaffold.cursorOffset));
		}
		return handler;
	};

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
					<Tabs position="bottom" keepMounted={['Script', 'Source', ...linkTabs.labels]} order={tabOrder} onReorder={setTabOrder} active={shownTab} onActive={setActiveTab} hints={linkTabs.hints} keys={linkTabs.keys} onTabMenu={linkTabs.onTabMenu} onAdd={() => post({ type: 'addTab' })} items={{
						Design: doc?.error ? <p className="error">{doc.error}</p>
							: body && defs ? <>
								{styles?.error && <p className="warning" title={styles.error}>{styles.error}</p>}
								<Canvas body={body} defs={defs.defs} sheets={styles?.css} selected={selected} extra={extra} onSelect={setSelected} onEditText={editText}
									onEditAttr={editAttr} onOpenFrame={openFrame} onOpenEditor={openEditor} onBindRef={bindRefTo} onContextMenu={canvasContext} />
							</>
								: LOADING,
						Script: doc ? <CodeEditor ref={scriptRef} target="script" lang={scriptLanguage} complete={jsTools.complete} hover={jsTools.hover} lint="js" text={doc.script.text} version={doc.version}
							readOnly={!!doc.script.note} notes={[api?.error, modules?.error, doc.script.note]} post={post} /> : LOADING,
						Source: doc ? <CodeEditor target="source" lang={XML} complete={xmlComplete} hover={xmlHoverSource} lint="xml" text={doc.text} version={doc.version} post={post} /> : LOADING,
						...linkTabs.items,
					}} />
				</div>
			</Panel>
			<Separator className="resizer" />
			<Panel defaultSize={320} minSize={220}>
				<Group orientation="vertical">
					<Panel defaultSize="55%" minSize={120}>
						<PropertyPane node={node} def={node && defOf(node, defs?.defs)} choices={cellIds ? { id: cellIds } : undefined} warning={defs?.error} onEdit={editSelected} onScript={eventName => node && openEventHandler(node, eventName)} />
					</Panel>
					<Separator className="resizer" />
					<Panel defaultSize="45%" minSize={120}>
						<div className="pane">
							<Tabs items={{
								Outline: <DndContext sensors={sensors} onDragEnd={handleDragEnd}>{tree(body ? [body] : [], outline, true)}</DndContext>,
								Data: tree(dataRoots, data),
							}}
								actions={{ Outline: foldButtons(outline), Data: foldButtons(data) }} />
						</div>
					</Panel>
				</Group>
			</Panel>
		</Group>
		{dataMenu && <Menu key={`${dataMenu.x},${dataMenu.y}`} x={dataMenu.x} y={dataMenu.y} onClose={() => setDataMenu(undefined)}>
				{dataMenu.grid ? (Object.keys(GRID_MENU) as (keyof typeof GRID_MENU)[]).filter(part => part !== 'columnLeft' || dataMenu.grid!.onColumn).map(part => <button key={part} role="menuitem" disabled={part === 'footer' && dataMenu.grid!.hasFooter}
					onClick={() => { if (doc) { post({ type: 'addGridPart', version: doc.version, index: dataMenu.index, part, at: dataMenu.grid!.at }); } setDataMenu(undefined); }}>
					{part === 'column' && dataMenu.grid!.onColumn ? '오른쪽에 Column 추가' : GRID_MENU[part]}</button>)
				: dataMenu.index === -1
					? <button role="menuitem" onClick={() => { setDataMenu(undefined); openSubmissionEditor(); }}>Submission 추가</button>
					: DATA_KINDS.map(kind => <button key={kind} role="menuitem" onClick={() => addData(kind)}>{kind[0].toUpperCase() + kind.slice(1)} 추가</button>)}
			</Menu>}
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
