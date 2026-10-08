// 오른쪽 아래 Outline·Data 트리 창: 트리, 펼치기·접기, 화면 점검 경고 이동, Outline 끌어 옮기기
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragMoveEvent, type DragStartEvent } from '@dnd-kit/core';
import { pathTo, type XmlNode } from '../../core/xmlModel';
import { isDataNode } from '../../core/data';
import { problemAncestors, screenProblems } from '../../core/check';
import { useEditorStore } from '../store';
import { Tabs } from './tabs';
import { INDENT, projectDrop, type FlatRow, type OutlineDrop } from '../../core/outlineDrop';
import { TreeItem, useDataReorder, useTreeRename, type DragData, type Fold, type Problems } from './tree';

/**
 * outline·data: 펼침 상태(바깥에서도 펼친다: 데이터·Submission 추가 뒤). dataRoots: Data 트리 맨 위 줄(Submission 묶음 포함).
 * 우클릭 메뉴·더블클릭 팝업은 캔버스와 같이 쓰므로 바깥에서 받는다
 */
/**
 * Outline 끌어 옮기기: 놓을 자리는 dnd-kit 충돌 판정이 아니라 포인터와 보이는 줄로 직접 계산(projectDrop). 끄는 동안 자리를 보여 주고(선·부모 강조, 트리를 가리지 않게 따라다니는 안내는 없음), 놓으면 move.
 * 키보드 끌기(dnd-kit KeyboardSensor)는 포인터가 없어 끄는 줄의 가운데로 잰다
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
		start: (e: DragStartEvent) => { dragged.current = e.active.data.current as DragData | undefined; },
		moveTo: (e: DragMoveEvent) => {
			const d = dragged.current, tree = treeRef.current;
			if (!d || !tree) { return; }
			const start = e.activatorEvent as PointerEvent, rect = e.active.rect.current.translated;
			const y = 'clientY' in start ? start.clientY + e.delta.y : rect ? rect.top + rect.height / 2 : undefined;
			setDrop(y === undefined ? undefined : projectDrop(rows(), y - tree.getBoundingClientRect().top, e.delta.x, d.depth));
		},
		end: () => {
			const d = dragged.current;
			if (d && drop) { move(d.index, drop.target, drop.position); }
			clear();
		},
		cancel: clear,
	};
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
	const setSelected = useEditorStore(s => s.setSelected);
	const editAttr = useEditorStore(s => s.editAttr);
	const move = useEditorStore(s => s.move);
	const tabOrder = useEditorStore(s => s.tabOrder);
	const setTabOrder = useEditorStore(s => s.setTabOrder);
	const root = doc?.root;

	useEffect(() => {
		const path = body && pathTo(body, selected);
		if (path) {
			outline.reveal(path.slice(0, -1));
		}
	}, [selected, body]); // outline 객체는 매 렌더 새로 만들어지므로 선택이 바뀔 때만 실행

	/** Data 트리에서 끌어 캔버스에 바인딩할 값: dataList는 data:id, 컬럼·키는 data:id.컬럼 */
	const refOf = (n: XmlNode) => {
		if (n.attrs.id && /:dataList$/.test(n.tag)) { return `data:${n.attrs.id}`; }
		if (!root || !n.attrs.id || !/:(key|column)$/.test(n.tag)) { return undefined; }
		const owner = pathTo(root, n.index)?.at(-3);
		return owner?.attrs.id && isDataNode(owner) ? `data:${owner.attrs.id}.${n.attrs.id}` : undefined;
	};
	const dataReorder = useDataReorder(doc?.version, model, dataCollection);
	const rename = useTreeRename(root, selected, (id, index) => editAttr('id', id, index));
	// 화면 점검(겹치는 id·없는 컬럼 바인딩·Script에 없는 이벤트 함수): 줄에 경고 표시
	const scriptText = doc?.script.text;
	const problems = useMemo((): Problems | undefined => {
		if (!root) { return undefined; }
		const of = screenProblems(root, scriptText);
		return { of, inside: problemAncestors(root, of) };
	}, [root, scriptText]);
	const outlineDrag = useOutlineDrag(move);
	const tree = (tops: XmlNode[], fold: Fold, interactive?: boolean) => tops.length
		? <div role="tree" ref={interactive ? outlineDrag.treeRef : undefined}>
			{tops.map(top => <TreeItem key={top.index} node={top} depth={0} selected={selected} extra={extra} onSelect={setSelected} onContextMenu={interactive ? onOutlineContext : onDataContext} onDoubleClick={interactive ? (n => onOpenEditor(n.index)) : onOpenDataEditor} fold={fold} defs={defs?.defs} interactive={interactive} bindRef={interactive ? undefined : refOf} reorder={interactive ? undefined : dataReorder} rename={rename} problems={problems}
				dropParent={interactive && outlineDrag.drop ? { index: outlineDrag.drop.parent, inside: !outlineDrag.drop.line } : undefined} />)}
			{interactive && outlineDrag.drop?.line && <div className="tree-drop-line" style={{ top: outlineDrag.drop.line.y - 1, left: 4 + outlineDrag.drop.line.depth * INDENT + 16 }} />}
		</div>
		: <p className="empty">없음</p>;
	/** 트리에서 경고가 있는 노드(문서 순서)와 그 조상(묶음 줄 포함). 누를 때마다 다음 경고로: 펼쳐 선택하고 이유는 알림으로 */
	const problemRows = (tops: XmlNode[]) => {
		const rows: { node: XmlNode; path: XmlNode[] }[] = [];
		const walk = (n: XmlNode, path: XmlNode[]) => {
			if (problems?.of.has(n.index)) { rows.push({ node: n, path }); }
			n.children.forEach(c => walk(c, [...path, n]));
		};
		tops.forEach(t => walk(t, []));
		return rows;
	};
	const nextProblem = (fold: Fold, rows: ReturnType<typeof problemRows>) => {
		const i = (rows.findIndex(r => r.node.index === selected) + 1) % rows.length, { node, path } = rows[i];
		fold.reveal(path);
		setSelected(node.index);
		useEditorStore.setState({ toast: { message: `경고 ${i + 1}/${rows.length}\n${problems!.of.get(node.index)!.join('\n')}`, key: Date.now() } });
	};
	const foldButtons = (fold: Fold, tops: XmlNode[]) => {
		const rows = problemRows(tops);
		return <>
			{rows.length > 0 && <button className="icon tree-problems" title="다음 점검 경고로 이동" aria-label={`점검 경고 ${rows.length}개, 다음으로 이동`} onClick={() => nextProblem(fold, rows)}>
				<span className="codicon codicon-warning" />{rows.length}
			</button>}
			<button className="icon codicon codicon-expand-all" title="모두 펼치기" onClick={() => fold.setAll(true)} />
			<button className="icon codicon codicon-collapse-all" title="모두 접기" onClick={() => fold.setAll(false)} />
		</>;
	};

	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));

	const outlineTops = body ? [body] : [];
	return (
		<div className="pane">
			<Tabs order={tabOrder} onReorder={setTabOrder} items={{
				Outline: <DndContext sensors={sensors} onDragStart={outlineDrag.start} onDragMove={outlineDrag.moveTo} onDragEnd={outlineDrag.end} onDragCancel={outlineDrag.cancel}>
					{tree(outlineTops, outline, true)}
				</DndContext>,
				Data: tree(dataRoots, data),
			}}
				actions={{ Outline: foldButtons(outline, outlineTops), Data: foldButtons(data, dataRoots) }} />
		</div>
	);
}
