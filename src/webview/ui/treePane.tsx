// 오른쪽 아래 Outline·Data 트리 창: 트리, 펼치기·접기, 화면 점검 경고 이동, Outline 끌어 옮기기
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, type DragMoveEvent, type DragStartEvent } from '@dnd-kit/core';
import { isWs, pathTo, type XmlNode } from '../../core/xmlModel';
import type { ComponentDef } from '../../core/protocol';
import { isDataNode } from '../../core/data';
import { problemAncestors, screenProblemDetails } from '../../core/check';
import { useEditorStore } from '../store';
import { Tabs } from './tabs';
import { INDENT, projectDrop, type FlatRow, type OutlineDrop } from '../../core/outlineDrop';
import { TreeItem, flattenTree, nodeLabels, useDataReorder, useTreeRename, type DragData, type Fold, type Problems, type Rename, type Reorder, type VisibleRow } from './tree';
import { filterTree, type TreeFilter } from '../../core/treeFilter';
import { outlineChildren } from '../design/renderers';
import { EmptyState } from './emptyState';

const ROW_HEIGHT = 24;
const VIRTUAL_THRESHOLD = 120;
const OVERSCAN = 20;

/**
 * 트리 검색칸: id·태그·class(공백으로 여러 낱말은 모두 맞아야 함). Esc로 비우고, Enter·↓로 첫 결과를 골라 트리로 넘어간다(그다음은 방향키).
 * 같은 칸에서 트리 단축키(F2·방향키)는 입력칸 것이라 트리 쪽이 무시한다
 */
function TreeSearch({ value, onChange, onPick }: { value: string; onChange(v: string): void; onPick(tree: HTMLElement): void }) {
	return (
		<div className="palette-search tree-search">
			<input type="search" value={value} placeholder="id·태그·class 검색" aria-label="트리 검색"
				onChange={e => onChange(e.target.value)}
				onKeyDown={e => {
					if (e.key === 'Escape' && value) {
						e.preventDefault();
						e.stopPropagation();
						onChange('');
					} else if ((e.key === 'Enter' || e.key === 'ArrowDown') && !e.nativeEvent.isComposing) {
						const tree = e.currentTarget.parentElement?.parentElement?.querySelector<HTMLElement>('[role="tree"]');
						if (tree) { e.preventDefault(); onPick(tree); }
					}
				}} />
		</div>
	);
}

/**
 * outline·data: 펼침 상태(바깥에서도 펼친다: 데이터·Submission 추가 뒤). dataRoots: Data 트리 맨 위 줄(Submission 묶음 포함).
 * 우클릭 메뉴·더블클릭 팝업은 캔버스와 같이 쓰므로 바깥에서 받는다
 */
/**
 * Outline 끌어 옮기기: 놓을 자리는 dnd-kit 충돌 판정이 아니라 포인터와 보이는 줄로 직접 계산(projectDrop). 끄는 동안 자리를 보여 주고(선·부모 강조, 트리를 가리지 않게 따라다니는 안내는 없음), 놓으면 move.
 * 마우스 끌기만 지원한다(키보드는 Enter·Space가 펼치기·접기라 끌기 센서를 두지 않는다)
 */
function useOutlineDrag(move: (dragged: number, target: number, position: OutlineDrop['position']) => void) {
	const treeRef = useRef<HTMLDivElement>(null);
	const [drop, setDrop] = useState<OutlineDrop>();
	const dragged = useRef<DragData>(undefined);
	const rows = (): FlatRow[] => {
		const tree = treeRef.current, d = dragged.current;
		if (!tree || !d) { return []; }
		const base = tree.getBoundingClientRect().top, all: FlatRow[] = [];
		let skip = -1;
		for (const el of tree.querySelectorAll<HTMLElement>('.tree-row[data-index]')) {
			const index = Number(el.dataset.index), depth = Number(el.dataset.depth);
			// 끄는 줄과 그 자손(바로 뒤에 이어지는 더 깊은 줄)은 놓을 자리가 아니다
			if (index === d.index) { skip = depth; continue; }
			if (skip >= 0 && depth > skip) { continue; }
			skip = -1;
			const r = el.getBoundingClientRect();
			all.push({ index, depth, container: el.dataset.container !== undefined, open: el.dataset.open !== undefined, top: r.top - base, bottom: r.bottom - base });
		}
		return all;
	};
	const clear = () => { dragged.current = undefined; setDrop(undefined); };
	return {
		treeRef, drop,
		/** 끄는 중 */
		active: () => !!dragged.current,
		start: (e: DragStartEvent) => { dragged.current = e.active.data.current as DragData | undefined; },
		moveTo: (e: DragMoveEvent) => {
			const d = dragged.current, tree = treeRef.current;
			if (!d || !tree) { return; }
			const y = (e.activatorEvent as PointerEvent).clientY + e.delta.y;
			setDrop(projectDrop(rows(), y - tree.getBoundingClientRect().top, e.delta.x, d.depth));
		},
		end: () => {
			const d = dragged.current;
			if (d && drop) { move(d.index, drop.target, drop.position); }
			clear();
		},
		cancel: clear,
	};
}

/** 트리에서 경고가 있는 노드(문서 순서)와 그 조상(묶음 줄 포함) */
function problemRows(tops: XmlNode[], problems?: Problems) {
	if (!problems?.of.size) { return []; }
	const rows: { node: XmlNode; path: XmlNode[] }[] = [];
	const walk = (n: XmlNode, path: XmlNode[]) => {
		if (problems.of.has(n.index)) { rows.push({ node: n, path }); }
		n.children.forEach(c => walk(c, [...path, n]));
	};
	tops.forEach(t => walk(t, []));
	return rows;
}

function TreeList({ rows, treeRef, selected, extraSet, onSelect, onRange, onContextMenu, onDoubleClick, fold, defs, interactive, bindRef, reorder, rename, problems, filter, dropParent, dropLine, onKeyDown }: {
	rows: VisibleRow[];
	treeRef?: RefObject<HTMLDivElement | null>;
	selected?: number;
	extraSet: ReadonlySet<number>;
	onSelect(i: number, additive?: boolean): void;
	onRange(i: number, row: HTMLElement): void;
	onContextMenu(e: MouseEvent<HTMLDivElement>, n: XmlNode): void;
	onDoubleClick(n: XmlNode): void;
	fold: Fold;
	defs?: ComponentDef[];
	interactive?: boolean;
	bindRef?(node: XmlNode): string | undefined;
	reorder?: Reorder;
	rename: Rename;
	problems?: Problems;
	filter?: TreeFilter;
	dropParent?: { index: number; inside: boolean };
	dropLine?: { y: number; depth: number };
	onKeyDown(e: KeyboardEvent<HTMLDivElement>): void;
}) {
	const localRef = useRef<HTMLDivElement>(null);
	const setRef = useCallback((el: HTMLDivElement | null) => {
		localRef.current = el;
		if (treeRef) { treeRef.current = el; }
	}, [treeRef]);
	const virtual = rows.length > VIRTUAL_THRESHOLD;
	const [viewport, setViewport] = useState({ top: 0, height: 600 });
	useEffect(() => {
		const scroller = virtual ? localRef.current?.closest<HTMLElement>('.tab-body') : undefined;
		if (!scroller) { return; }
		let frame = 0;
		const sync = () => {
			frame = 0;
			const top = scroller.scrollTop, height = scroller.clientHeight || 600;
			setViewport(v => Math.abs(v.top - top) < ROW_HEIGHT * 4 && v.height === height ? v : { top, height });
		};
		const onScroll = () => { frame ||= requestAnimationFrame(sync); };
		sync();
		scroller.addEventListener('scroll', onScroll, { passive: true });
		const observer = new ResizeObserver(onScroll);
		observer.observe(scroller);
		return () => {
			cancelAnimationFrame(frame);
			scroller.removeEventListener('scroll', onScroll);
			observer.disconnect();
		};
	}, [virtual]);
	useEffect(() => {
		if (!virtual || selected === undefined) { return; }
		const idx = rows.findIndex(r => r.node.index === selected);
		const scroller = idx >= 0 ? localRef.current?.closest<HTMLElement>('.tab-body') : undefined;
		if (!scroller) { return; }
		const rowTop = idx * ROW_HEIGHT, rowBottom = rowTop + ROW_HEIGHT;
		const viewTop = scroller.scrollTop, viewHeight = scroller.clientHeight || 600;
		if (rowTop < viewTop) {
			scroller.scrollTop = rowTop;
			setViewport({ top: rowTop, height: viewHeight });
		} else if (rowBottom > viewTop + viewHeight) {
			const nextTop = rowBottom - viewHeight;
			scroller.scrollTop = nextTop;
			setViewport({ top: nextTop, height: viewHeight });
		}
	}, [virtual, selected, rows]);
	const start = virtual ? Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN) : 0;
	const end = virtual ? Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN) : rows.length;
	const visible = virtual ? rows.slice(start, end) : rows;
	return (
		<div role="tree" tabIndex={-1} onKeyDown={onKeyDown} ref={setRef}
			style={virtual ? { paddingTop: start * ROW_HEIGHT, paddingBottom: (rows.length - end) * ROW_HEIGHT } : undefined}>
			{visible.map(r => {
				const i = r.node.index, isPrimary = i === selected;
				return <TreeItem key={i} row={r} isPrimary={isPrimary} isSelected={isPrimary || extraSet.has(i)}
					onSelect={onSelect} onRange={onRange} onContextMenu={onContextMenu} onDoubleClick={onDoubleClick}
					fold={fold} defs={defs} interactive={interactive} bindRef={bindRef} reorder={reorder}
					rename={rename.index === i ? rename : undefined} problems={problems} filter={filter}
					dropMode={dropParent?.index === i ? (dropParent.inside ? 'inside' : 'parent') : undefined} />;
			})}
			{dropLine && <div className="tree-drop-line" style={{ top: dropLine.y - 1, left: 4 + dropLine.depth * INDENT + 16 }} />}
		</div>
	);
}

export function TreePane({ body, dataRoots, model, dataCollection, outline, data, onOutlineContext, onDataContext, onOpenEditor, onOpenDataEditor }: {
	body?: XmlNode; dataRoots: XmlNode[]; model?: XmlNode; dataCollection?: XmlNode; outline: Fold; data: Fold;
	onOutlineContext(e: MouseEvent<HTMLDivElement>, n: XmlNode): void; onDataContext(e: MouseEvent<HTMLDivElement>, n: XmlNode): void;
	onOpenEditor(index: number): void; onOpenDataEditor(n: XmlNode): void;
}) {
	const doc = useEditorStore(s => s.doc);
	const defs = useEditorStore(s => s.defs);
	const selected = useEditorStore(s => s.selected);
	const extra = useEditorStore(s => s.extra);
	const extraSet = useMemo(() => new Set(extra), [extra]);
	const setSelected = useEditorStore(s => s.setSelected);
	const editAttr = useEditorStore(s => s.editAttr);
	const move = useEditorStore(s => s.move);
	const tabOrder = useEditorStore(s => s.tabOrder);
	const setTabOrder = useEditorStore(s => s.setTabOrder);
	const root = doc?.root;
	const panelReveal = useEditorStore(s => s.panelReveal);
	const [activeTab, setActiveTab] = useState<string>();
	// 패널 보이기 요청(데이터 흐름 팝업 등): Data 탭으로 바꾸고 고른 노드까지 펼친다(줄이 새로 그려질 때 보이는 자리로 스크롤)
	useEffect(() => {
		if (!panelReveal) { return; }
		const path = selected === undefined ? undefined : dataRoots.map(t => pathTo(t, selected)).find(Boolean);
		if (path) {
			setActiveTab('Data');
			data.reveal(path.slice(0, -1));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- 요청이 올 때만 실행
	}, [panelReveal]);

	useEffect(() => {
		const path = body && pathTo(body, selected);
		if (path) {
			outline.reveal(path.slice(0, -1));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- 선택이 바뀔 때만 실행
	}, [selected, body]);

	/** Data 트리에서 끌어 캔버스에 바인딩할 값: dataList는 data:id, 컬럼·키는 data:id.컬럼 */
	const refOf = useCallback((n: XmlNode) => {
		if (n.attrs.id && isWs(n, 'dataList')) { return `data:${n.attrs.id}`; }
		if (!root || !n.attrs.id || !(isWs(n, 'key') || isWs(n, 'column'))) { return undefined; }
		const owner = pathTo(root, n.index)?.at(-3);
		return owner?.attrs.id && isDataNode(owner) ? `data:${owner.attrs.id}.${n.attrs.id}` : undefined;
	}, [root]);
	const dataReorder = useDataReorder(doc?.version, model, dataCollection);
	const rename = useTreeRename(root, selected, (id, index) => editAttr('id', id, index));
	// 화면 점검(겹치는 id·없는 컬럼 바인딩·Script에 없는 이벤트 함수): 줄에 경고 표시
	const scriptText = doc?.script.text;
	const problems = useMemo(() => {
		if (!root) { return undefined; }
		const details = screenProblemDetails(root, scriptText);
		const of = new Map([...details].map(([index, entries]) => [index, entries.map(e => e.message)]));
		return { of, inside: problemAncestors(root, of), details };
	}, [root, scriptText]);
	const outlineDrag = useOutlineDrag(move);
	// 트리 검색: 탭마다 따로. 검색 중에는 맞는 노드와 조상만 보인다(core/treeFilter)
	const [queries, setQueries] = useState({ outline: '', data: '' });
	const outlineTops = useMemo(() => body ? [body] : [], [body]);
	const outlineFilter = useMemo(() => filterTree(outlineTops, n => defs ? outlineChildren(n, defs.defs) : n.children, n => nodeLabels(n, defs?.defs, true), queries.outline), [outlineTops, defs, queries.outline]);
	const dataFilter = useMemo(() => filterTree(dataRoots, n => n.children, n => nodeLabels(n, undefined, false), queries.data), [dataRoots, queries.data]);
	const outlineRows = useMemo(() => flattenTree(outlineTops, outline, defs?.defs, true, outlineFilter), [outlineTops, outline, defs, outlineFilter]);
	const dataRows = useMemo(() => flattenTree(dataRoots, data, defs?.defs, false, dataFilter), [dataRoots, data, defs, dataFilter]);
	const outlineProblems = useMemo(() => problemRows(outlineTops, problems), [outlineTops, problems]);
	const dataProblems = useMemo(() => problemRows(dataRoots, problems), [dataRoots, problems]);
	/** 검색을 지우면 고른 노드가 접힌 곳에 숨지 않게 그 자리까지 펼친다 */
	const search = (kind: 'outline' | 'data', fold: Fold, tops: XmlNode[]) => (value: string) => {
		setQueries(q => ({ ...q, [kind]: value }));
		const path = !value && selected !== undefined ? tops.map(t => pathTo(t, selected)).find(Boolean) : undefined;
		if (path) { fold.reveal(path.slice(0, -1)); }
	};
	/** Enter·↓: 첫 결과를 고르고 트리로 포커스를 넘긴다(결과가 없으면 그대로) */
	const pickFirst = (rows: VisibleRow[], filter?: TreeFilter) => (tree: HTMLElement) => {
		const first = filter && rows.find(r => filter.match.has(r.node));
		if (!first) { return; }
		setSelected(first.node.index);
		tree.focus({ preventScroll: true });
	};
	/** Shift+클릭: 지금 고른 줄(기준, 그대로 주 선택)부터 누른 줄까지 보이는 줄을 모두 고른다. 기준이 안 보이면(접힘) 그 줄만 */
	const selectRange = (index: number, row: HTMLElement) => {
		const shown = (row.closest('[role="tree"]') === outlineDrag.treeRef.current ? outlineRows : dataRows).map(r => r.node.index);
		const from = selected === undefined ? -2 : shown.indexOf(selected), to = shown.indexOf(index);
		if (from < 0 || to < 0) { setSelected(index); return; }
		useEditorStore.setState({ pendingSelect: undefined, extra: shown.slice(Math.min(from, to), Math.max(from, to) + 1).filter(i => i !== selected && i !== -1) });
	};
	const handlers = useRef({ onOutlineContext, onDataContext, onOpenEditor, onOpenDataEditor, selectRange });
	handlers.current = { onOutlineContext, onDataContext, onOpenEditor, onOpenDataEditor, selectRange };
	const outlineContext = useCallback((e: MouseEvent<HTMLDivElement>, n: XmlNode) => handlers.current.onOutlineContext(e, n), []);
	const dataContext = useCallback((e: MouseEvent<HTMLDivElement>, n: XmlNode) => handlers.current.onDataContext(e, n), []);
	const openOutline = useCallback((n: XmlNode) => handlers.current.onOpenEditor(n.index), []);
	const openData = useCallback((n: XmlNode) => handlers.current.onOpenDataEditor(n), []);
	const onRange = useCallback((index: number, row: HTMLElement) => handlers.current.selectRange(index, row), []);
	/** VS Code 트리처럼: ↑↓ 보이는 줄 이동, Home·End 처음·끝, → 펼치기(이미 펼쳤으면 첫 자식), ← 접기(이미 접었으면 부모), Enter·Space 펼치기·접기 */
	const navigate = (e: KeyboardEvent<HTMLDivElement>, fold: Fold, rows: VisibleRow[], filter?: TreeFilter) => {
		if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || outlineDrag.active() || (e.target as HTMLElement).closest('input, textarea, [contenteditable]')
			|| !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(e.key)) { return; }
		const at = rows.findIndex(r => r.node.index === selected), cur = rows[at];
		const treeEl = e.currentTarget;
		const go = (to?: VisibleRow) => {
			if (!to) { return; }
			setSelected(to.node.index);
			const el = treeEl.querySelector<HTMLElement>(`.tree-row[data-index="${to.node.index}"]`);
			// 끌기용 속성이 없는 줄(맨 위)은 포커스를 못 받으니 트리가 받는다
			(el && el.tabIndex >= 0 ? el : treeEl).focus({ preventScroll: true });
		};
		const expandable = !!cur && cur.children.length > 0 && !filter;
		e.preventDefault();
		if (e.key === 'Enter' || e.key === ' ') {
			if (expandable) { fold.toggle(cur.node, !cur.open); }
		} else if (e.key === 'Home' || e.key === 'End') {
			go(e.key === 'Home' ? rows[0] : rows.at(-1));
		} else if (!cur) {
			go(e.key === 'ArrowUp' ? rows.at(-1) : rows[0]);
		} else if (e.key === 'ArrowDown') {
			go(rows[at + 1]);
		} else if (e.key === 'ArrowUp') {
			go(rows[at - 1]);
		} else if (e.key === 'ArrowRight') {
			if (expandable && !cur.open) { fold.toggle(cur.node, true); } else if (expandable && cur.open) { go(rows[at + 1]); }
		} else if (expandable && cur.open) {
			fold.toggle(cur.node, false);
		} else {
			go(rows.slice(0, at).reverse().find(r => r.depth < cur.depth));
		}
	};
	const tree = (tops: XmlNode[], rows: VisibleRow[], fold: Fold, interactive?: boolean, filter?: TreeFilter) => filter && !filter.keep.size
		? <EmptyState kind="search" hint="Esc로 검색을 지울 수 있습니다">검색 결과 없음</EmptyState>
		: tops.length
		? <TreeList rows={rows} treeRef={interactive ? outlineDrag.treeRef : undefined} selected={selected} extraSet={extraSet}
			onSelect={setSelected} onRange={onRange} onContextMenu={interactive ? outlineContext : dataContext} onDoubleClick={interactive ? openOutline : openData}
			fold={fold} defs={defs?.defs} interactive={interactive} bindRef={interactive ? undefined : refOf} reorder={interactive || filter ? undefined : dataReorder}
			rename={rename} problems={problems} filter={filter}
			dropParent={interactive && outlineDrag.drop ? { index: outlineDrag.drop.parent, inside: !outlineDrag.drop.line } : undefined}
			dropLine={interactive ? outlineDrag.drop?.line : undefined}
			onKeyDown={e => navigate(e, fold, rows, filter)} />
		: <EmptyState>항목이 없습니다</EmptyState>;
	const nextProblem = (fold: Fold, rows: ReturnType<typeof problemRows>) => {
		const i = (rows.findIndex(r => r.node.index === selected) + 1) % rows.length, { node, path } = rows[i];
		fold.reveal(path);
		setSelected(node.index);
		useEditorStore.setState({ problemReveal: { index: node.index, attr: problems!.details.get(node.index)![0].attr }, toast: { message: `경고 ${i + 1}/${rows.length}\n${problems!.of.get(node.index)!.join('\n')}`, key: Date.now() } });
	};
	const foldButtons = (fold: Fold, rows: ReturnType<typeof problemRows>) => (
		<>
			{rows.length > 0 && <button className="icon tree-problems" title="다음 점검 경고로 이동" aria-label={`점검 경고 ${rows.length}개, 다음으로 이동`} onClick={() => nextProblem(fold, rows)}>
				<span className="codicon codicon-warning" />{rows.length}
			</button>}
			<button className="icon codicon codicon-expand-all" title="모두 펼치기" onClick={() => fold.setAll(true)} />
			<button className="icon codicon codicon-collapse-all" title="모두 접기" onClick={() => fold.setAll(false)} />
		</>
	);

	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

	return (
		<div className="pane">
			<Tabs order={tabOrder} onReorder={setTabOrder} active={activeTab} onActive={setActiveTab} items={{
				Outline: <>
					<TreeSearch value={queries.outline} onChange={search('outline', outline, outlineTops)} onPick={pickFirst(outlineRows, outlineFilter)} />
					<DndContext sensors={sensors} onDragStart={outlineDrag.start} onDragMove={outlineDrag.moveTo} onDragEnd={outlineDrag.end} onDragCancel={outlineDrag.cancel}>
						{tree(outlineTops, outlineRows, outline, true, outlineFilter)}
					</DndContext>
				</>,
				Data: <>
					<TreeSearch value={queries.data} onChange={search('data', data, dataRoots)} onPick={pickFirst(dataRows, dataFilter)} />
					{tree(dataRoots, dataRows, data, false, dataFilter)}
				</>,
			}}
				actions={{ Outline: foldButtons(outline, outlineProblems), Data: foldButtons(data, dataProblems) }} />
		</div>
	);
}
