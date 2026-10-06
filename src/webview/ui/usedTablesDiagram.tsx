// Beta 사용 테이블의 그림(React Flow): 테이블 박스(머리 + 컬럼 줄)를 끌어 놓고 테이블끼리 선으로 잇는다.
// 내용·자리·선은 data(저장 대상)가 기준이고, 선택·잰 크기 같은 그림 상태만 React Flow 것을 둔다
import { useEffect, useRef, useState } from 'react';
import { applyEdgeChanges, applyNodeChanges, Background, BackgroundVariant, ConnectionLineType, ConnectionMode, Controls, Handle, MiniMap, Panel, Position, ReactFlow,
	type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { clsx } from 'clsx';
import { CRUD, type TableLink, type UsedTable, type UsedTables } from '../../core/tables';

type TableNode = Node<{ table: UsedTable; toggleKeys(): void }, 'table'>;
/** 박스 끌기는 격자에 맞춘다(배경 점 간격과 같게) */
const GRID = 16;
/** 선: 둥글게 꺾인 직각선(관계라 방향 화살표 없음) */
const EDGE_OPTIONS = { type: 'smoothstep', pathOptions: { borderRadius: 12 } } as const;
/** 박스 네 면의 연결점 */
const SIDES = [['t', Position.Top], ['r', Position.Right], ['b', Position.Bottom], ['l', Position.Left]] as const;

const linkId = (l: TableLink) => `${l.from}>${l.to}`;
/** 그림 박스에 보이는 컬럼: PK 먼저. PK만 보기면 PK만(PK가 없으면 다) */
const shownColumns = (t: UsedTable) => [...t.columns.filter(c => c.pk), ...t.keysOnly && t.columns.some(c => c.pk) ? [] : t.columns.filter(c => !c.pk)];
const centerOf = (n: TableNode) => ({ x: n.position.x + (n.measured?.width ?? 0) / 2, y: n.position.y + (n.measured?.height ?? 0) / 2 });
/** 선이 붙을 점: 두 박스가 마주 보는 면(가로로 더 떨어져 있으면 좌우, 아니면 위아래). 박스를 옮기면 따라 바뀐다 */
function facingSides(a: TableNode, b: TableNode): [string, string] {
	const p = centerOf(a), q = centerOf(b), dx = q.x - p.x, dy = q.y - p.y;
	return Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? ['r', 'l'] : ['l', 'r'] : dy >= 0 ? ['b', 't'] : ['t', 'b'];
}

function TableBox({ data, selected }: NodeProps<TableNode>) {
	const t = data.table, columns = shownColumns(t), hidden = t.columns.length - columns.length;
	return <div className={clsx('used-table-node', { selected })}>
		{SIDES.map(([side, position]) => <Handle key={side} type="source" position={position} id={side} />)}
		<div className="head">
			<div className="name">{t.name || '(이름 없음)'}</div>
			{t.desc && <div className="desc">{t.desc}</div>}
			{t.crud.length > 0 && <div className="crud">{CRUD.filter(([k]) => t.crud.includes(k)).map(([k, label]) => <span key={k} className={`crud-${k}`}>{label}</span>)}</div>}
		</div>
		{columns.length > 0 && <ul className="columns">
			{columns.map((c, i) => <li key={c.id} className={clsx({ pk: c.pk, last: c.pk && columns[i + 1] && !columns[i + 1].pk })}>
				<span className="key">{c.pk ? 'PK' : ''}</span>
				<span className="col-name">{c.name || '(이름 없음)'}</span>
				<span className="col-type">{c.type}</span>
			</li>)}
		</ul>}
		{/* PK와 일반 컬럼이 다 있을 때만: PK만 보기 ↔ 전체 */}
		{t.columns.some(c => c.pk) && t.columns.some(c => !c.pk) && <button type="button" className="nodrag columns-toggle" onClick={data.toggleKeys}>
			{t.keysOnly ? `컬럼 ${hidden}개 더 보기` : 'PK만 보기'}</button>}
	</div>;
}
const NODE_TYPES = { table: TableBox };

/** selected: 고른 테이블 id(표와 같이 쓴다). onOpen: 박스 더블클릭(표의 그 행으로) */
export function UsedTablesDiagram({ data, selected, onSelect, onChange, onOpen }: {
	data: UsedTables; selected?: string; onSelect(id: string | undefined): void; onChange(next: UsedTables): void; onOpen(id: string): void;
}) {
	const [nodes, setNodes] = useState<TableNode[]>([]);
	const [edges, setEdges] = useState<Edge[]>([]);
	// 그림만 웹뷰 전체로(Esc나 같은 버튼으로 돌아옴)
	const [full, setFull] = useState(false);
	// 박스 안 "PK만 보기" 버튼은 누를 때의 최신 data로 바꾼다(박스 data는 그릴 때 것)
	const latest = useRef(data);
	latest.current = data;

	useEffect(() => {
		const toggleKeys = (id: string) => () => {
			const d = latest.current;
			onChange({ ...d, tables: d.tables.map(t => t.id === id ? { ...t, keysOnly: !t.keysOnly } : t) });
		};
		setNodes(current => data.tables.map(table => {
			const old = current.find(n => n.id === table.id);
			return { ...old, id: table.id, type: 'table', position: old?.dragging ? old.position : { x: table.x, y: table.y },
				data: { table, toggleKeys: toggleKeys(table.id) }, selected: table.id === selected, deletable: false };
		}));
		setEdges(current => data.links.map(link => ({ ...current.find(e => e.id === linkId(link)), id: linkId(link), source: link.from, target: link.to })));
	}, [data, selected, onChange]);

	useEffect(() => {
		if (!full) { return; }
		const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setFull(false); } };
		window.addEventListener('keydown', esc, true);
		return () => window.removeEventListener('keydown', esc, true);
	}, [full]);

	const onNodesChange = (changes: NodeChange<TableNode>[]) => {
		const next = applyNodeChanges(changes, nodes);
		setNodes(next);
		if (changes.some(c => c.type === 'select')) { onSelect(next.find(n => n.selected)?.id); }
		// 끌기를 마치면 자리 저장
		if (changes.some(c => c.type === 'position' && !c.dragging)) {
			onChange({ ...data, tables: data.tables.map(t => { const n = next.find(n => n.id === t.id); return n ? { ...t, x: Math.round(n.position.x), y: Math.round(n.position.y) } : t; }) });
		}
	};
	const onEdgesChange = (changes: EdgeChange[]) => {
		const next = applyEdgeChanges(changes, edges);
		setEdges(next);
		if (changes.some(c => c.type === 'remove')) { onChange({ ...data, links: data.links.filter(l => next.some(e => e.id === linkId(l))) }); }
	};
	const onConnect = ({ source, target }: Connection) => {
		// 방향 없는 관계: 같은 두 테이블은 한 번만
		if (source === target || data.links.some(l => (l.from === source && l.to === target) || (l.from === target && l.to === source))) { return; }
		onChange({ ...data, links: [...data.links, { from: source, to: target }] });
	};

	// 고른 박스가 있으면 그 박스와 이어진 것만 또렷하게(나머지는 흐리게). 선은 마주 보는 면에
	const near = new Set(selected ? [selected, ...edges.filter(e => e.source === selected || e.target === selected).flatMap(e => [e.source, e.target])] : []);
	const shownNodes = selected ? nodes.map(n => near.has(n.id) ? n : { ...n, className: 'dim' }) : nodes;
	const byId = new Map(nodes.map(n => [n.id, n]));
	const shownEdges = edges.map(e => {
		const a = byId.get(e.source), b = byId.get(e.target);
		const [sourceHandle, targetHandle] = a && b ? facingSides(a, b) : [undefined, undefined];
		return { ...e, sourceHandle, targetHandle, className: !selected ? undefined : e.source === selected || e.target === selected ? 'hot' : 'dim' };
	});
	const light = document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast-light');

	return <div className={clsx('used-tables-flow', { full })}>
		{/* 박스를 다 맞춘 뒤에 그린다: 처음 화면 맞추기(fitView)가 박스 있는 상태에서 돌게 */}
		{nodes.length === data.tables.length && <ReactFlow nodes={shownNodes} edges={shownEdges} nodeTypes={NODE_TYPES} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
			connectionMode={ConnectionMode.Loose} connectionLineType={ConnectionLineType.SmoothStep} defaultEdgeOptions={EDGE_OPTIONS}
			snapToGrid snapGrid={[GRID, GRID]} panOnScroll deleteKeyCode={['Delete', 'Backspace']} colorMode={light ? 'light' : 'dark'}
			onNodeDoubleClick={(_, n) => onOpen(n.id)}
			fitView fitViewOptions={{ maxZoom: 1, padding: 0.2 }} proOptions={{ hideAttribution: true }} minZoom={0.3} maxZoom={2}>
			<Background variant={BackgroundVariant.Dots} gap={GRID} size={1.2} />
			<MiniMap pannable zoomable nodeBorderRadius={6} nodeStrokeWidth={2} />
			<Controls showInteractive={false} />
			<Panel position="top-right">
				<button type="button" className={`flow-full codicon codicon-${full ? 'screen-normal' : 'screen-full'}`} title={full ? '원래 크기로 (Esc)' : '전체 화면'}
					aria-label={full ? '원래 크기로' : '전체 화면'} aria-pressed={full} onClick={() => setFull(f => !f)} />
			</Panel>
		</ReactFlow>}
	</div>;
}
