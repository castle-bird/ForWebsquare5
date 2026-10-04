// 오른쪽 아래 Outline·Data 트리 창: 트리, 펼치기·접기, 화면 점검 경고 이동, Outline 끌어 옮기기
import { useEffect, useMemo, type MouseEvent } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { pathTo, type XmlNode } from '../../core/xmlModel';
import { isDataNode } from '../../core/data';
import { problemAncestors, screenProblems } from '../../core/check';
import { useEditorStore } from '../store';
import { Tabs } from './tabs';
import { dropZone, TreeItem, useDataReorder, useTreeRename, type DragData, type Fold, type Problems } from './tree';

/**
 * outline·data: 펼침 상태(바깥에서도 펼친다: 데이터·Submission 추가 뒤). dataRoots: Data 트리 맨 위 줄(Submission 묶음 포함).
 * 우클릭 메뉴·더블클릭 팝업은 캔버스와 같이 쓰므로 바깥에서 받는다
 */
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
	const tree = (tops: XmlNode[], fold: Fold, interactive?: boolean) => tops.length
		? <div role="tree">{tops.map(top => <TreeItem key={top.index} node={top} depth={0} selected={selected} extra={extra} onSelect={setSelected} onContextMenu={interactive ? onOutlineContext : onDataContext} onDoubleClick={interactive ? (n => onOpenEditor(n.index)) : onOpenDataEditor} fold={fold} defs={defs?.defs} interactive={interactive} bindRef={interactive ? undefined : refOf} reorder={interactive ? undefined : dataReorder} rename={rename} problems={problems} />)}</div>
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
	const handleDragEnd = (e: DragEndEvent) => {
		const dragged = e.active.data.current as DragData | undefined;
		const over = e.over?.data.current as DragData | undefined;
		if (dragged && over && over.index !== dragged.index) {
			move(dragged.index, over.index, dropZone(e.active.rect.current.translated, e.over!.rect, over.container, over.depth));
		}
	};

	const outlineTops = body ? [body] : [];
	return (
		<div className="pane">
			<Tabs order={tabOrder} onReorder={setTabOrder} items={{
				Outline: <DndContext sensors={sensors} onDragEnd={handleDragEnd}>{tree(outlineTops, outline, true)}</DndContext>,
				Data: tree(dataRoots, data),
			}}
				actions={{ Outline: foldButtons(outline, outlineTops), Data: foldButtons(data, dataRoots) }} />
		</div>
	);
}
