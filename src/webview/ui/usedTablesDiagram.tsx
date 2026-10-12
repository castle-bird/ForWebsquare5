// ERD 사용 테이블의 그림(React Flow): 테이블(머리 + 컬럼 줄)·메모·그룹 틀을 그림 안에서 바로 만들고 고친다(ERD Cloud·Excalidraw처럼).
// 내용·자리·선은 data(저장 대상)가 기준이고, 선택·잰 크기·끄는 중 자리 같은 그림 상태만 React Flow 것을 둔다
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { applyEdgeChanges, applyNodeChanges, Background, BackgroundVariant, BaseEdge, ConnectionLineType, ConnectionMode, ControlButton, Controls, EdgeLabelRenderer, getSmoothStepPath, MarkerType, MiniMap, Panel, Position, ReactFlow, ReactFlowProvider, ViewportPortal, getNodesBounds, useInternalNode, useReactFlow, useStore, type Connection, type Edge, type EdgeChange, type EdgeProps, type InternalNode, type NodeChange, type XYPosition } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { clsx } from 'clsx';
import { ARROWS, GROUP_SIZE, MEMO_SIZE, NOTE_COLORS, SHAPE_SIZE, SHAPES, type Arrow, type NoteColor, type ShapeKind, type TableColor, type TableLink, type UsedShape, type UsedTables } from '../../core/tables';
import { toPng } from 'html-to-image';
import { isModKey } from '../keys';
import { post } from '../store';
import { DiagramContext, Field, NODE_TYPES, editItem, editTable, fieldKey, insertColumn, mixedKeys, shapeIcon, useDiagram,
	type FlowNode, type GroupNode, type MemoNode, type MenuItem, type ShapeNode, type TableNode } from './usedTablesNodes';
import { Menu } from './menu';
import type { Edit } from './usedTablesPane';

type LinkEdge = Edge<{ link: TableLink }, 'link'>;
/** 박스 끌기는 격자에 맞춘다(배경 점 간격과 같게) */
const GRID = 16;
const snap = (n: number) => Math.round(n / GRID) * GRID;
const ARROW_LABELS: Record<Arrow, string> = { none: '화살표 없음', end: '→ 끝에', start: '← 시작에', both: '↔ 양쪽' };
const MARKER = { type: MarkerType.ArrowClosed, width: 18, height: 18 };
/** 붙여넣기 때 원래 자리에서 비키는 거리 */
const PASTE_OFFSET = GRID * 2;

const linkId = (l: TableLink) => `${l.from}>${l.to}`;
const editLink = (edit: Edit, id: string, patch: Partial<TableLink>) => edit(d => ({ ...d, links: d.links.map(l => linkId(l) === id ? { ...l, ...patch } : l) }));
const newId = () => crypto.randomUUID();
const sizeOf = (n: FlowNode) => ({ w: n.measured?.width ?? n.width ?? 0, h: n.measured?.height ?? n.height ?? 0 });
const centerOf = (n: FlowNode) => { const { w, h } = sizeOf(n); return { x: n.position.x + w / 2, y: n.position.y + h / 2 }; };
/** 선이 붙을 점: 두 박스가 마주 보는 면(가로로 더 떨어져 있으면 좌우, 아니면 위아래). 박스를 옮기면 따라 바뀐다 */
function facingSides(a: FlowNode, b: FlowNode): [string, string] {
	const p = centerOf(a), q = centerOf(b), dx = q.x - p.x, dy = q.y - p.y;
	return Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? ['r', 'l'] : ['l', 'r'] : dy >= 0 ? ['b', 't'] : ['t', 'b'];
}
/** 그룹 틀 안에 든 것: 테이블·메모는 가운데가, 다른 틀은 통째로 안에 있으면 */
function inside(frame: FlowNode, n: FlowNode) {
	const { w, h } = sizeOf(frame), x0 = frame.position.x, y0 = frame.position.y;
	const within = (p: XYPosition) => p.x >= x0 && p.x <= x0 + w && p.y >= y0 && p.y <= y0 + h;
	if (n.type !== 'group-frame') { return within(centerOf(n)); }
	const s = sizeOf(n);
	return within(n.position) && within({ x: n.position.x + s.w, y: n.position.y + s.h });
}

const FIT = { maxZoom: 1, padding: 0.2 };


/** 곧은 선이 지날 자리: 마주 보는 두 박스가 선과 수직인 방향으로 겹치면(위아래로 이을 때 가로 범위 등) 겹친 범위의 가운데. 덜 겹치면 없음 */
function straightAt(a: InternalNode | undefined, b: InternalNode | undefined, vertical: boolean) {
	if (!a || !b) { return undefined; }
	const span = (n: InternalNode) => { const p = n.internals.positionAbsolute, s = vertical ? n.measured.width ?? 0 : n.measured.height ?? 0, at = vertical ? p.x : p.y; return [at, at + s]; };
	const [a0, a1] = span(a), [b0, b1] = span(b), lo = Math.max(a0, b0), hi = Math.min(a1, b1);
	return hi - lo >= 16 ? Math.round((lo + hi) / 2) : undefined;
}

/** 선: 두 박스가 겹쳐 마주 보면 곧은 선, 아니면 둥글게 꺾인 직각선 + 화살표(선택) + 가운데 글자(더블클릭으로 편집) */
function LinkLine({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerStart, markerEnd, data, style }: EdgeProps<LinkEdge>) {
	const { editing, edit } = useDiagram();
	const vertical = sourcePosition === Position.Top || sourcePosition === Position.Bottom;
	// 도형은 연결점(둘레 위 점)에서 바로 나가게: 곧은 선은 박스 범위로 자리를 정해 도형 밖에서 시작할 수 있다
	const a = useInternalNode(source), b = useInternalNode(target);
	const at = a?.type === 'shape' || b?.type === 'shape' ? undefined : straightAt(a, b, vertical);
	const [path, x, y] = at === undefined ? getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12 })
		: vertical ? [`M ${at},${sourceY} L ${at},${targetY}`, at, (sourceY + targetY) / 2] : [`M ${sourceX},${at} L ${targetX},${at}`, (sourceX + targetX) / 2, at];
	const link = data!.link, k = fieldKey(id, 'label');
	return <>
		<BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} style={style} interactionWidth={16} />
		{(link.label || editing === k) && <EdgeLabelRenderer>
			<div className="link-label nopan" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>
				<Field k={k} value={link.label} placeholder="관계" onCommit={label => editLink(edit, id, { label })} label="선 글자" />
			</div>
		</EdgeLabelRenderer>}
	</>;
}
const EDGE_TYPES = { link: LinkLine };

/** 도구 줄 도구(숫자 키 1~8 순서). 고른 뒤 그림을 클릭하면 그 자리에 놓는다(Excalidraw처럼) */
type Tool = 'table' | 'memo' | 'group' | ShapeKind;
const TOOLS: { tool: Tool; label: string; icon: string | ReactNode; size: { w: number; h: number } }[] = [
	{ tool: 'table', label: '테이블', icon: 'table', size: { w: 200, h: 80 } },
	{ tool: 'memo', label: '메모', icon: 'note', size: MEMO_SIZE },
	{ tool: 'group', label: '그룹', icon: 'layers', size: GROUP_SIZE },
	...SHAPES.map(([kind, label]) => ({ tool: kind, label, icon: shapeIcon(kind), size: SHAPE_SIZE })),
];

/** 끌 때 다른 박스와 맞출 거리(화면 px) */
const ALIGN = 6;
/**
 * 정렬 맞춤: 끄는 박스의 왼쪽·가운데·오른쪽(위·가운데·아래)이 다른 박스의 것과 가까우면 거기에 붙인다(가로·세로 따로, 가장 가까운 것).
 * 돌려주는 at은 맞춘 선의 그림 좌표(안내선)
 */
function alignTo(node: FlowNode, pos: XYPosition, nodes: FlowNode[], zoom: number) {
	const { w, h } = sizeOf(node), tol = ALIGN / zoom;
	const best = (mine: number[], theirs: number[], cur?: { d: number; at: number }) => {
		for (const a of mine) { for (const b of theirs) { if (Math.abs(b - a) <= tol && (!cur || Math.abs(b - a) < Math.abs(cur.d))) { cur = { d: b - a, at: b }; } } }
		return cur;
	};
	let x: { d: number; at: number } | undefined, y: { d: number; at: number } | undefined;
	for (const o of nodes) {
		const s = sizeOf(o);
		if (o.id === node.id || !s.w) { continue; }
		x = best([pos.x, pos.x + w / 2, pos.x + w], [o.position.x, o.position.x + s.w / 2, o.position.x + s.w], x);
		y = best([pos.y, pos.y + h / 2, pos.y + h], [o.position.y, o.position.y + s.h / 2, o.position.y + s.h], y);
	}
	return { position: { x: pos.x + (x?.d ?? 0), y: pos.y + (y?.d ?? 0) }, guides: { x: x?.at, y: y?.at } };
}
/** 정렬 안내선(그림 좌표에 그려 확대·이동을 따라감, 굵기는 화면 1px) */
function Guides({ x, y }: { x?: number; y?: number }) {
	const zoom = useStore(s => s.transform[2]), far = 100000;
	return <ViewportPortal>
		{x !== undefined && <div className="align-guide" style={{ left: x, top: -far, width: 0, height: far * 2, borderLeftWidth: 1 / zoom }} />}
		{y !== undefined && <div className="align-guide" style={{ left: -far, top: y, width: far * 2, height: 0, borderTopWidth: 1 / zoom }} />}
	</ViewportPortal>;
}

/** 왼쪽 아래 확대·축소 버튼 밑 지금 배율(%). 누르면 100%로. 배율만 구독해 이것만 다시 그린다 */
function ZoomLevel() {
	const zoom = useStore(s => s.transform[2]), flow = useReactFlow();
	const percent = Math.round(zoom * 100);
	return <ControlButton className="zoom-level" title="100%로" aria-label={`배율 ${percent}%, 누르면 100%로`} onClick={() => void flow.zoomTo(1, { duration: 200 })}>{percent}%</ControlButton>;
}

/** 클립보드(이 웹뷰 안): 고른 테이블·메모·그룹과 그 사이 선, 묶음 전체 범위(붙일 때 마우스 자리를 가운데로) */
let clipboard: Pick<UsedTables, 'tables' | 'memos' | 'groups' | 'shapes' | 'links'> & { box: { x: number; y: number; w: number; h: number } } | undefined;
let pasteCount = 0;

function toNodes(d: UsedTables, current: FlowNode[], select?: Set<string>): FlowNode[] {
	const old = new Map(current.map(n => [n.id, n]));
	const keep = <T extends FlowNode>(fresh: T): T => {
		const o = old.get(fresh.id);
		return { ...o, ...fresh, position: o?.dragging ? o.position : fresh.position, selected: select ? select.has(fresh.id) : o?.selected ?? false } as T;
	};
	// 큰 틀이 먼저(아래), 안에 든 작은 틀이 위로
	const groups = [...d.groups].sort((a, b) => b.w * b.h - a.w * a.h).map(group => keep<GroupNode>({
		id: group.id, type: 'group-frame', position: { x: group.x, y: group.y }, width: group.w, height: group.h, data: { group },
		dragHandle: '.group-handle', zIndex: -1, style: { pointerEvents: 'none' },
	}));
	// 도형은 그림이라 테이블·메모 아래
	return [...groups,
		...d.shapes.map(shape => keep<ShapeNode>({ id: shape.id, type: 'shape', position: { x: shape.x, y: shape.y }, width: shape.w, height: shape.h, data: { shape } })),
		...d.tables.map(table => keep<TableNode>({ id: table.id, type: 'table', position: { x: table.x, y: table.y }, data: { table } })),
		...d.memos.map(memo => keep<MemoNode>({ id: memo.id, type: 'memo', position: { x: memo.x, y: memo.y }, width: memo.w, height: memo.h, data: { memo } }))];
}
function toEdges(d: UsedTables, current: LinkEdge[], select?: Set<string>): LinkEdge[] {
	const old = new Map(current.map(e => [e.id, e]));
	return d.links.map(link => {
		const id = linkId(link), o = old.get(id);
		return { ...o, id, type: 'link', source: link.from, target: link.to, data: { link }, selected: select ? select.has(id) : o?.selected ?? false,
			markerEnd: link.arrow === 'end' || link.arrow === 'both' ? MARKER : undefined, markerStart: link.arrow === 'start' || link.arrow === 'both' ? MARKER : undefined };
	});
}

export function UsedTablesDiagram(props: { data: UsedTables; onChange: Edit; onUndo(): void; onRedo(): void; canUndo: boolean; canRedo: boolean }) {
	return <ReactFlowProvider><Diagram {...props} /></ReactFlowProvider>;
}

function Diagram({ data, onChange, onUndo, onRedo, canUndo, canRedo }: { data: UsedTables; onChange: Edit; onUndo(): void; onRedo(): void; canUndo: boolean; canRedo: boolean }) {
	const flow = useReactFlow<FlowNode, LinkEdge>();
	// 처음 그릴 때부터 노드가 있어야 fitView가 그 노드에 맞춘다(그 뒤로는 추가해도 확대 비율 그대로)
	const [nodes, setNodes] = useState<FlowNode[]>(() => toNodes(data, []));
	const [edges, setEdges] = useState<LinkEdge[]>(() => toEdges(data, []));
	const [editing, setEditing] = useState<string>();
	const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] }>();
	const [help, setHelp] = useState(false);
	// 그림만 웹뷰 전체로(Esc나 같은 버튼으로 돌아옴)
	const [full, setFull] = useState(false);
	/** 고른 도구(그림을 클릭하면 그 자리에 놓고 풀림) */
	const [placing, setPlacing] = useState<Tool>();
	const [guides, setGuides] = useState<{ x?: number; y?: number }>();
	/** 정렬 맞춤으로 옮긴 자리(끌기를 마칠 때 이 자리로 저장) */
	const aligned = useRef<{ id: string; position: XYPosition }>(undefined);
	const wrapper = useRef<HTMLDivElement>(null);
	/** 다음 data 반영 때 고를 것(추가·붙여넣기·복제한 것) */
	const selectNext = useRef<Set<string>>(undefined);
	/** 그룹 틀을 끄는 동안 같이 옮길 것: 시작 자리 */
	const carry = useRef<{ anchor: XYPosition; start: Map<string, XYPosition> }>(undefined);
	/** 그림 위 마우스 자리(화면 좌표). 밖으로 나가면 없음: Ctrl+V는 여기에 붙인다 */
	const pointer = useRef<XYPosition>(undefined);
	const latest = useRef({ nodes, edges });
	latest.current = { nodes, edges };

	useEffect(() => {
		const select = selectNext.current;
		selectNext.current = undefined;
		setNodes(current => toNodes(data, current, select));
		setEdges(current => toEdges(data, current, select));
	}, [data]);

	const selectedIds = () => new Set([...latest.current.nodes.filter(n => n.selected).map(n => n.id), ...latest.current.edges.filter(e => e.selected).map(e => e.id)]);
	/** 그림 가운데(화면 좌표 → 그림 좌표) */
	const viewCenter = () => {
		const r = wrapper.current!.getBoundingClientRect();
		return flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
	};
	/** 놓을 자리: at, 없으면 w×h 박스가 그림 가운데 오게. 같은 자리에 이미 있으면 비켜서(대각선으로) */
	const freeSpot = (at: XYPosition | undefined, w: number, h: number) => {
		const p = at ?? (c => ({ x: c.x - w / 2, y: c.y - h / 2 }))(viewCenter());
		let x = snap(p.x), y = snap(p.y);
		while (latest.current.nodes.some(n => n.type !== 'group-frame' && Math.abs(n.position.x - x) < GRID && Math.abs(n.position.y - y) < GRID)) { x += GRID * 2; y += GRID * 2; }
		return { x, y };
	};
	/** 새 것 추가: 고르고 바로 field 칸 입력 */
	const addItem = (id: string, field: string, add: (d: UsedTables) => UsedTables) => {
		selectNext.current = new Set([id]);
		onChange(add);
		setEditing(fieldKey(id, field));
	};
	const addTable = (at?: XYPosition) => {
		const id = newId(), p = freeSpot(at, 200, 80);
		addItem(id, 'name', d => ({ ...d, tables: [...d.tables, { id, name: '', desc: '', crud: [], columns: [], keysOnly: false, color: '', ...p }] }));
	};
	const addMemo = (at?: XYPosition) => {
		const id = newId(), p = freeSpot(at, MEMO_SIZE.w, MEMO_SIZE.h);
		addItem(id, 'text', d => ({ ...d, memos: [...d.memos, { id, text: '', color: 'yellow', ...p, ...MEMO_SIZE }] }));
	};
	const addShape = (kind: ShapeKind, at?: XYPosition) => {
		const id = newId(), p = freeSpot(at, SHAPE_SIZE.w, SHAPE_SIZE.h);
		selectNext.current = new Set([id]);
		onChange(d => ({ ...d, shapes: [...d.shapes, { id, kind, text: '', color: 'blue', ...p, ...SHAPE_SIZE }] }));
	};
	/** 그룹: 고른 것이 있으면 그것을 감싸는 크기로, 없으면 기본 크기 */
	const addGroup = (at?: XYPosition, around: FlowNode[] = []) => {
		const id = newId();
		let box = { ...GROUP_SIZE, ...freeSpot(at, GROUP_SIZE.w, GROUP_SIZE.h) };
		if (around.length) {
			const x0 = Math.min(...around.map(n => n.position.x)), y0 = Math.min(...around.map(n => n.position.y));
			const x1 = Math.max(...around.map(n => n.position.x + sizeOf(n).w)), y1 = Math.max(...around.map(n => n.position.y + sizeOf(n).h));
			box = { x: snap(x0 - GRID * 2), y: snap(y0 - GRID * 4), w: snap(x1 - x0 + GRID * 4), h: snap(y1 - y0 + GRID * 6) };
		}
		addItem(id, 'title', d => ({ ...d, groups: [...d.groups, { id, title: '', color: 'blue', ...box }] }));
	};
	/** 도구를 고른 뒤 그림을 클릭해 놓는다. 같은 도구를 다시 고르면 풀림 */
	const pick = (tool: Tool) => setPlacing(cur => cur === tool ? undefined : tool);
	/** 고른 도구를 at(그림 좌표)이 가운데 오게 놓는다 */
	const place = (tool: Tool, at: XYPosition) => {
		const { size } = TOOLS.find(t => t.tool === tool)!, p = { x: at.x - size.w / 2, y: at.y - size.h / 2 };
		if (tool === 'table') { addTable(p); } else if (tool === 'memo') { addMemo(p); } else if (tool === 'group') { addGroup(p); } else { addShape(tool, p); }
	};
	/** 방향키: 고른 것을 한 칸씩(그룹 틀이면 안에 든 것도 같이) */
	const nudge = (dx: number, dy: number) => {
		const picked = latest.current.nodes.filter(n => n.selected);
		if (!picked.length) { return false; }
		const ids = new Set(picked.map(n => n.id));
		for (const f of picked.filter(n => n.type === 'group-frame')) {
			for (const n of latest.current.nodes) { if (inside(f, n)) { ids.add(n.id); } }
		}
		const move = <T extends { id: string; x: number; y: number }>(o: T): T => ids.has(o.id) ? { ...o, x: o.x + dx, y: o.y + dy } : o;
		onChange(d => ({ ...d, tables: d.tables.map(move), memos: d.memos.map(move), groups: d.groups.map(move), shapes: d.shapes.map(move) }));
	};
	/** 그림 전체를 PNG로(고른 표시·연결점·손잡이 없이, 박스 둘레 여백). 저장 위치는 확장이 묻는다 */
	const exportImage = async () => {
		const view = wrapper.current?.querySelector<HTMLElement>('.react-flow__viewport');
		if (!view || !latest.current.nodes.length) { return; }
		setNodes(ns => ns.map(n => n.selected ? { ...n, selected: false } : n));
		setEdges(es => es.map(e => e.selected ? { ...e, selected: false } : e));
		setPlacing(undefined);
		// 고른 표시가 풀린 화면을 찍게 두 프레임 기다림
		await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
		const pad = 32, b = getNodesBounds(latest.current.nodes), width = Math.ceil(b.width + pad * 2), height = Math.ceil(b.height + pad * 2);
		const background = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background').trim() || getComputedStyle(document.body).backgroundColor;
		try {
			// 웹뷰 보안 정책(CSP)이 글꼴 파일 가져오기를 막으므로 글꼴은 넣지 않는다(설치된 글꼴로 그림)
			const dataUrl = await toPng(view, { backgroundColor: background, width, height, pixelRatio: 2, skipFonts: true,
				style: { width: `${width}px`, height: `${height}px`, transform: `translate(${pad - b.x}px, ${pad - b.y}px) scale(1)` },
				// 연결점·크기 손잡이, 빈 칸 안내 글자, 아이콘(글꼴을 안 넣어 빈 네모가 됨)은 뺀다
				filter: el => !(el instanceof Element && el.matches('.react-flow__handle, .react-flow__resize-control, .placeholder, .codicon')) });
			post({ type: 'saveTablesImage', dataUrl });
		} catch (e) {
			post({ type: 'warn', message: `이미지 만들기 실패: ${e instanceof Error ? e.message : String(e)}` });
		}
	};
	const remove = (ids: Set<string>) => {
		if (!ids.size) { return; }
		onChange(d => ({
			tables: d.tables.filter(t => !ids.has(t.id)), memos: d.memos.filter(m => !ids.has(m.id)), groups: d.groups.filter(g => !ids.has(g.id)), shapes: d.shapes.filter(x => !ids.has(x.id)),
			links: d.links.filter(l => !ids.has(linkId(l)) && !ids.has(l.from) && !ids.has(l.to)),
		}));
	};
	const copy = (ids = selectedIds()) => {
		const d = data;
		const tables = d.tables.filter(t => ids.has(t.id)), memos = d.memos.filter(m => ids.has(m.id)), groups = d.groups.filter(g => ids.has(g.id)), shapes = d.shapes.filter(x => ids.has(x.id));
		if (!tables.length && !memos.length && !groups.length && !shapes.length) { return false; }
		const ends = new Set([...tables, ...memos, ...shapes].map(n => n.id));
		// 테이블 크기는 그려진 것에서(데이터에 없음)
		const sized = new Map(latest.current.nodes.map(n => [n.id, sizeOf(n)]));
		const boxes = [...tables.map(t => ({ x: t.x, y: t.y, ...sized.get(t.id) ?? { w: 0, h: 0 } })), ...memos, ...groups, ...shapes];
		const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
		const box = { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y };
		clipboard = structuredClone({ tables, memos, groups, shapes, links: d.links.filter(l => ends.has(l.from) && ends.has(l.to)), box });
		pasteCount = 0;
		return true;
	};
	/** 붙여넣기: 새 id로, at(그림 좌표)이 있으면 묶음 가운데를 거기에(Excalidraw처럼), 없으면 원래 자리에서 조금씩 비켜서 */
	const paste = (at?: XYPosition) => {
		if (!clipboard) { return; }
		const c = clipboard, ids = new Map<string, string>(), fresh = (id: string) => { const n = newId(); ids.set(id, n); return n; };
		pasteCount++;
		const dx = at ? snap(at.x - c.box.w / 2 - c.box.x) : PASTE_OFFSET * pasteCount, dy = at ? snap(at.y - c.box.h / 2 - c.box.y) : PASTE_OFFSET * pasteCount;
		const tables = c.tables.map(t => ({ ...t, id: fresh(t.id), x: t.x + dx, y: t.y + dy, columns: t.columns.map(col => ({ ...col, id: newId() })) }));
		const memos = c.memos.map(m => ({ ...m, id: fresh(m.id), x: m.x + dx, y: m.y + dy }));
		const groups = c.groups.map(g => ({ ...g, id: fresh(g.id), x: g.x + dx, y: g.y + dy }));
		const shapes = c.shapes.map(x => ({ ...x, id: fresh(x.id), x: x.x + dx, y: x.y + dy }));
		const links = c.links.map(l => ({ ...l, from: ids.get(l.from)!, to: ids.get(l.to)! }));
		selectNext.current = new Set([...ids.values(), ...links.map(linkId)]);
		onChange(d => ({ tables: [...d.tables, ...tables], memos: [...d.memos, ...memos], groups: [...d.groups, ...groups], shapes: [...d.shapes, ...shapes], links: [...d.links, ...links] }));
	};
	/** 복제: 붙여넣기와 같되 클립보드는 그대로 */
	const duplicate = (ids = selectedIds()) => {
		const saved = [clipboard, pasteCount] as const;
		if (copy(ids)) { paste(); }
		if (saved[0]) { [clipboard, pasteCount] = saved; }
	};
	const selectAll = () => {
		setNodes(ns => ns.map(n => ({ ...n, selected: true })));
		setEdges(es => es.map(e => ({ ...e, selected: true })));
	};
	/** F2·Enter: 고른 것 하나의 이름(메모는 내용) 편집 */
	const editSelected = () => {
		const [n, ...rest] = latest.current.nodes.filter(x => x.selected);
		if (!n || rest.length) { return false; }
		setEditing(fieldKey(n.id, n.type === 'memo' || n.type === 'shape' ? 'text' : n.type === 'group-frame' ? 'title' : 'name'));
		return true;
	};
	const setLink = (id: string, patch: Partial<TableLink>) => editLink(onChange, id, patch);

	// 단축키: 입력칸 밖에서(그림이 포커스를 가졌거나 아무것도 안 가졌을 때). VS Code(화면 XML Undo)·Design 단축키로 넘기지 않는다
	const keys = useRef<(e: KeyboardEvent) => void>(undefined);
	keys.current = e => {
		const el = e.target as HTMLElement;
		// ERD 탭은 다른 탭으로 가도 숨겨 둔 채 남는다(확대·되돌리기 기록 유지) → 숨어 있으면 단축키 안 받음
		if (!wrapper.current?.getClientRects().length) { return; }
		if (menu || el.closest?.('input, textarea, select, [contenteditable], dialog') || (el !== document.body && !wrapper.current?.contains(el))) { return; }
		// 도구 줄 버튼의 Enter·Space는 버튼 것
		if ((e.key === 'Enter' || e.key === ' ') && el.closest?.('button')) { return; }
		const mod = (key: string) => isModKey(e, key);
		// false를 돌려주면 처리 안 함(이벤트를 그대로 둔다)
		const run: (() => unknown) | undefined = mod('z') ? (e.shiftKey ? onRedo : onUndo) : mod('y') ? onRedo
			: mod('c') ? () => copy() : mod('x') ? () => { if (copy()) { remove(selectedIds()); } } : mod('v') ? () => paste(pointer.current && flow.screenToFlowPosition(pointer.current)) : mod('d') ? () => duplicate() : mod('a') ? selectAll
				: e.key === 'Delete' || e.key === 'Backspace' ? () => remove(selectedIds())
					: e.key === 'F2' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) ? editSelected
						: e.key === 'Escape' && placing ? () => setPlacing(undefined)
							: e.key === 'Escape' && full ? () => setFull(false)
								: e.key.startsWith('Arrow') && !e.ctrlKey && !e.metaKey && !e.altKey ? () => {
									const step = GRID * (e.shiftKey ? 4 : 1);
									return nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
								}
									: /^[1-9]$/.test(e.key) && TOOLS[Number(e.key) - 1] && !e.ctrlKey && !e.metaKey && !e.altKey ? () => pick(TOOLS[Number(e.key) - 1].tool) : undefined;
		if (!run || run() === false) { return; }
		e.preventDefault();
		e.stopPropagation();
	};
	useEffect(() => {
		const on = (e: KeyboardEvent) => keys.current?.(e);
		window.addEventListener('keydown', on, true);
		return () => window.removeEventListener('keydown', on, true);
	}, []);

	// 안 바뀌게(노드들이 받는 context가 끄는 프레임마다 바뀌어 모든 노드를 다시 그리지 않게)
	const openMenu = useCallback((e: ReactMouseEvent | MouseEvent, items: MenuItem[]) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items }); }, []);
	const context = useMemo(() => ({ editing, setEditing, edit: onChange, openMenu }), [editing, onChange, openMenu]);
	const at = (e: ReactMouseEvent | MouseEvent) => flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
	const colorItems = <C extends TableColor>(current: C, apply: (color: NoteColor) => void): MenuItem[] =>
		NOTE_COLORS.map(([color, label]) => ({ label, swatch: color, checked: current === color, run: () => apply(color) }));
	/** 고른 것 모두 같은 색. '기본'은 테이블만(메모·그룹·도형은 기본 색이 없어 그대로) */
	const paint = (ids: Set<string>, color: TableColor) => onChange(d => {
		const note = <T extends { id: string; color: NoteColor }>(x: T): T => color && ids.has(x.id) && x.color !== color ? { ...x, color } : x;
		return { ...d, tables: d.tables.map(t => ids.has(t.id) && t.color !== color ? { ...t, color } : t), memos: d.memos.map(note), groups: d.groups.map(note), shapes: d.shapes.map(note) };
	});
	/** 우클릭한 것이 안 골라져 있으면 그것만 고른다 */
	const focusOn = (id: string) => {
		if (latest.current.nodes.find(n => n.id === id)?.selected || latest.current.edges.find(e => e.id === id)?.selected) { return; }
		setNodes(ns => ns.map(n => ({ ...n, selected: n.id === id })));
		setEdges(es => es.map(e => ({ ...e, selected: e.id === id })));
	};
	const onPaneMenu = (e: ReactMouseEvent | MouseEvent) => {
		const p = at(e);
		openMenu(e, [
			{ label: '테이블 추가', run: () => addTable(p) },
			{ label: '메모 추가', run: () => addMemo(p) },
			{ label: '그룹 추가', run: () => addGroup(p) },
			...SHAPES.map(([kind, label]) => ({ label: `${label} 추가`, run: () => addShape(kind, p) })),
			'separator',
			{ label: '붙여넣기', kbd: 'Ctrl+V', run: () => paste(p), disabled: !clipboard },
			{ label: '모두 선택', kbd: 'Ctrl+A', run: selectAll, disabled: !nodes.length },
			{ label: '전체 보기', run: () => void flow.fitView({ ...FIT, duration: 200 }), disabled: !nodes.length },
			{ label: '이미지로 저장 (PNG)…', run: () => void exportImage(), disabled: !nodes.length },
		]);
	};
	const clipItems = (ids: Set<string>): MenuItem[] => [
		{ label: '복사', kbd: 'Ctrl+C', run: () => copy(ids) },
		{ label: '복제', kbd: 'Ctrl+D', run: () => duplicate(ids) },
		{ label: '삭제', kbd: 'Delete', run: () => remove(ids) },
	];
	const onNodeMenu = (e: ReactMouseEvent, node: FlowNode) => {
		focusOn(node.id);
		const many = latest.current.nodes.filter(n => n.selected && n.id !== node.id).length > 0 && node.selected;
		if (many) { onSelectionMenu(e, latest.current.nodes.filter(n => n.selected)); return; }
		const ids = new Set([node.id]), common: MenuItem[] = ['separator', ...clipItems(ids)];
		if (node.type === 'table') {
			const t = node.data.table;
			openMenu(e, [
				{ label: '컬럼 추가', run: () => setEditing(insertColumn(onChange, t.id)) },
				{ label: '이름 편집', kbd: 'F2', run: () => setEditing(fieldKey(t.id, 'name')) },
				{ label: '설명 편집', run: () => { focusOn(t.id); setEditing(fieldKey(t.id, 'desc')); } },
				...mixedKeys(t) ? [{ label: t.keysOnly ? '모든 컬럼 보기' : 'PK만 보기', run: () => editTable(onChange, t.id, x => ({ ...x, keysOnly: !x.keysOnly })) }] : [],
				'separator',
				{ label: '이 테이블을 감싸는 그룹', run: () => addGroup(undefined, [node]) },
				'separator',
				{ label: '기본 색', checked: !t.color, run: () => paint(ids, '') },
				...colorItems(t.color, color => paint(ids, color)),
				...common]);
		} else if (node.type === 'shape') {
			const x = node.data.shape, setShape = (patch: Partial<UsedShape>) => editItem(onChange, 'shapes', x.id, o => ({ ...o, ...patch }));
			openMenu(e, [{ label: x.text ? '글자 편집' : '글자 넣기', kbd: 'F2', run: () => setEditing(fieldKey(x.id, 'text')) }, 'separator',
				...SHAPES.map(([kind, label]) => ({ label, checked: x.kind === kind, run: () => setShape({ kind }) })),
				'separator',
				...colorItems(x.color, color => setShape({ color })), ...common]);
		} else if (node.type === 'memo') {
			const m = node.data.memo;
			openMenu(e, [{ label: '내용 편집', kbd: 'F2', run: () => setEditing(fieldKey(m.id, 'text')) }, 'separator',
				...colorItems(m.color, color => editItem(onChange, 'memos', m.id, x => ({ ...x, color }))), ...common]);
		} else {
			const g = node.data.group, members = latest.current.nodes.filter(n => n.id !== g.id && inside(node, n));
			openMenu(e, [{ label: '이름 편집', kbd: 'F2', run: () => setEditing(fieldKey(g.id, 'title')) },
				{ label: `안에 든 것까지 선택 (${members.length})`, disabled: !members.length, run: () => {
					const pick = new Set([g.id, ...members.map(n => n.id)]);
					setNodes(ns => ns.map(n => ({ ...n, selected: pick.has(n.id) })));
				} }, 'separator',
				...colorItems(g.color, color => editItem(onChange, 'groups', g.id, x => ({ ...x, color }))),
				'separator',
				{ label: '그룹만 삭제 (안의 것은 그대로)', kbd: 'Delete', run: () => remove(ids) },
				{ label: '그룹과 안의 것 모두 삭제', run: () => remove(new Set([g.id, ...members.map(n => n.id)])) }]);
		}
	};
	const onSelectionMenu = (e: ReactMouseEvent, picked: FlowNode[]) => {
		const ids = new Set(picked.map(n => n.id));
		openMenu(e, [
			{ label: `그룹으로 묶기 (${picked.length})`, run: () => addGroup(undefined, picked) },
			'separator',
			...colorItems('', color => paint(ids, color)),
			...picked.some(n => n.type === 'table') ? [{ label: '테이블 기본 색', run: () => paint(ids, '') }] : [],
			'separator',
			...clipItems(ids),
		]);
	};
	const onEdgeMenu = (e: ReactMouseEvent, edge: LinkEdge) => {
		focusOn(edge.id);
		const l = edge.data!.link;
		openMenu(e, [
			...ARROWS.map(arrow => ({ label: ARROW_LABELS[arrow], checked: l.arrow === arrow, run: () => setLink(edge.id, { arrow }) })),
			{ label: '방향 바꾸기', disabled: l.arrow === 'none' || l.arrow === 'both', run: () => setLink(edge.id, { from: l.to, to: l.from, arrow: l.arrow }) },
			'separator',
			{ label: l.label ? '글자 편집' : '글자 넣기', run: () => setEditing(fieldKey(edge.id, 'label')) },
			{ label: '선 삭제', kbd: 'Delete', run: () => remove(new Set([edge.id])) },
		]);
	};

	const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
		// 지우기는 단축키·메뉴가 data로(선까지 같이)
		const kept = changes.filter(c => c.type !== 'remove');
		// 박스 하나(그룹 틀 말고)를 끄는 중이면 다른 박스와 줄 맞춤 + 안내선. 놓을 때 온 자리도 맞춘 자리로
		const moves = kept.filter(c => c.type === 'position');
		const one = moves.length === 1 ? moves[0] : undefined;
		if (one?.type === 'position' && one.position) {
			const node = latest.current.nodes.find(n => n.id === one.id);
			if (one.dragging && node && node.type !== 'group-frame') {
				const { position, guides: lines } = alignTo(node, one.position, latest.current.nodes, flow.getZoom());
				one.position = position;
				aligned.current = { id: one.id, position };
				setGuides(lines.x === undefined && lines.y === undefined ? undefined : lines);
			} else if (!one.dragging && aligned.current?.id === one.id) {
				one.position = aligned.current.position;
			}
		}
		if (moves.some(c => c.type === 'position' && !c.dragging)) { setGuides(undefined); }
		setNodes(ns => applyNodeChanges(kept, ns));
	};
	const onEdgesChange = (changes: EdgeChange<LinkEdge>[]) => setEdges(es => applyEdgeChanges(changes.filter(c => c.type !== 'remove'), es));
	const onConnect = ({ source, target }: Connection) => {
		// 같은 두 끝은 한 번만(방향을 바꾸려면 선 우클릭)
		if (source === target || data.links.some(l => (l.from === source && l.to === target) || (l.from === target && l.to === source))) { return; }
		onChange(d => ({ ...d, links: [...d.links, { from: source, to: target, arrow: 'end', label: '' }] }));
	};
	const onDragStart = (_: unknown, node: FlowNode, dragged: FlowNode[]) => {
		const moving = new Set(dragged.map(n => n.id)), frames = dragged.filter(n => n.type === 'group-frame');
		const start = new Map<string, XYPosition>();
		for (const n of latest.current.nodes) {
			if (!moving.has(n.id) && frames.some(f => inside(f, n))) { start.set(n.id, n.position); }
		}
		carry.current = start.size ? { anchor: node.position, start } : undefined;
	};
	const onDrag = (_: unknown, node: FlowNode) => {
		const c = carry.current;
		if (!c) { return; }
		const dx = node.position.x - c.anchor.x, dy = node.position.y - c.anchor.y;
		setNodes(ns => ns.map(n => { const s = c.start.get(n.id); return s ? { ...n, position: { x: s.x + dx, y: s.y + dy } } : n; }));
	};
	/** 끌기를 마치면 옮긴 것(같이 옮긴 그룹 안 것까지) 자리 저장 */
	const onDragStop = (_: unknown, node: FlowNode, dragged: FlowNode[]) => {
		const c = carry.current;
		carry.current = undefined;
		const fit = aligned.current;
		aligned.current = undefined;
		setGuides(undefined);
		const moved = new Map(dragged.map(n => [n.id, fit?.id === n.id ? fit.position : n.position]));
		if (c) {
			const dx = node.position.x - c.anchor.x, dy = node.position.y - c.anchor.y;
			c.start.forEach((s, id) => moved.set(id, { x: s.x + dx, y: s.y + dy }));
		}
		const place = <T extends { id: string; x: number; y: number }>(o: T): T => { const p = moved.get(o.id); return p && (p.x !== o.x || p.y !== o.y) ? { ...o, x: Math.round(p.x), y: Math.round(p.y) } : o; };
		onChange(d => {
			const next = { ...d, tables: d.tables.map(place), memos: d.memos.map(place), groups: d.groups.map(place), shapes: d.shapes.map(place) };
			return next.tables.every((t, i) => t === d.tables[i]) && next.memos.every((m, i) => m === d.memos[i]) && next.groups.every((g, i) => g === d.groups[i])
				&& next.shapes.every((x, i) => x === d.shapes[i]) ? d : next;
		});
	};

	// 테이블 하나만 고르면 그것과 이어진 것만 또렷하게(나머지는 흐리게). 선은 마주 보는 면에
	const picked = nodes.filter(n => n.selected);
	const focus = picked.length === 1 && picked[0].type === 'table' ? picked[0].id : undefined;
	const near = new Set(focus ? [focus, ...edges.filter(e => e.source === focus || e.target === focus).flatMap(e => [e.source, e.target])] : []);
	// 고른 도형은 위로(테이블에 가려 크기 손잡이·연결점을 못 잡지 않게, 그림 도구처럼)
	const shownNodes = nodes.map(n => {
		const raised = n.type === 'shape' && n.selected ? { ...n, zIndex: 1 } : n;
		return focus && n.type !== 'group-frame' && !near.has(n.id) ? { ...raised, data: { ...raised.data, dim: true } } as FlowNode : raised;
	});
	const byId = new Map(nodes.map(n => [n.id, n]));
	const shownEdges = edges.map(e => {
		const a = byId.get(e.source), b = byId.get(e.target);
		const [sourceHandle, targetHandle] = a && b ? facingSides(a, b) : [undefined, undefined];
		return { ...e, sourceHandle, targetHandle, className: !focus ? undefined : e.source === focus || e.target === focus ? 'hot' : 'dim' };
	});
	const light = document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast-light');
	const tool = (icon: string | ReactNode, label: string, run: () => void, extra?: { disabled?: boolean; title?: string; pressed?: boolean; text?: boolean; badge?: number }): ReactNode =>
		<button type="button" className={clsx('flow-tool', { 'with-text': extra?.text })} title={extra?.title ?? label} aria-label={label} disabled={extra?.disabled} aria-pressed={extra?.pressed} onClick={run}>
			{typeof icon === 'string' ? <span className={`codicon codicon-${icon}`} /> : icon}{extra?.text && <span>{label}</span>}{extra?.badge && <span className="tool-key">{extra.badge}</span>}</button>;

	return <DiagramContext.Provider value={context}>
		<div ref={wrapper} className={clsx('used-tables-flow', { full, placing })}
			onPointerMove={e => { pointer.current = { x: e.clientX, y: e.clientY }; }} onPointerLeave={() => { pointer.current = undefined; }}>
			<ReactFlow nodes={shownNodes} edges={shownEdges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
				onNodeDragStart={onDragStart} onNodeDrag={onDrag} onNodeDragStop={onDragStop}
				onPaneContextMenu={onPaneMenu} onNodeContextMenu={onNodeMenu} onSelectionContextMenu={onSelectionMenu} onEdgeContextMenu={onEdgeMenu}
				onEdgeDoubleClick={(_, edge) => setEditing(fieldKey(edge.id, 'label'))}
				onPaneClick={e => { if (placing) { place(placing, at(e)); setPlacing(undefined); } }}
				onDoubleClick={e => { if ((e.target as HTMLElement).classList.contains('react-flow__pane')) { addTable(at(e)); } }}
				connectionMode={ConnectionMode.Loose} connectionLineType={ConnectionLineType.SmoothStep} defaultMarkerColor="var(--vscode-descriptionForeground)"
				snapToGrid snapGrid={[GRID, GRID]} panOnScroll selectionOnDrag panOnDrag={[1]} deleteKeyCode={null} zoomOnDoubleClick={false} elevateNodesOnSelect={false}
				colorMode={light ? 'light' : 'dark'} fitView fitViewOptions={FIT} proOptions={{ hideAttribution: true }} minZoom={0.2} maxZoom={2}>
				<Background variant={BackgroundVariant.Dots} gap={GRID} size={1.2} />
				<MiniMap pannable zoomable nodeBorderRadius={6} nodeStrokeWidth={2} nodeClassName={n => n.type ?? ''} />
				<Controls showInteractive={false} fitViewOptions={{ ...FIT, duration: 200 }}><ZoomLevel /></Controls>
				<Panel position="top-left" className="flow-toolbar">
					{TOOLS.map(({ tool: t, label, icon }, i) => <Fragment key={t}>
						{i === 3 && <span className="flow-sep" />}
						{tool(icon, label, () => pick(t), { text: i < 3, pressed: placing === t, badge: i + 1,
							title: `${label} (${i + 1}) — 그림을 클릭한 자리에` })}
					</Fragment>)}
					<span className="flow-sep" />
					{tool('discard', '되돌리기', onUndo, { disabled: !canUndo, title: '되돌리기 (Ctrl+Z)' })}
					{tool('redo', '다시 실행', onRedo, { disabled: !canRedo, title: '다시 실행 (Ctrl+Y)' })}
					<span className="flow-sep" />
					{tool('question', '도움말', () => setHelp(h => !h), { pressed: help })}
				</Panel>
				<Panel position="top-right" className="flow-corner">
					<button type="button" className="flow-export codicon codicon-file-media" title="이미지로 저장 (PNG)" aria-label="이미지로 저장" disabled={!nodes.length} onClick={() => void exportImage()} />
					<button type="button" className={`flow-full codicon codicon-${full ? 'screen-normal' : 'screen-full'}`} title={full ? '원래 크기로 (Esc)' : '전체 화면'}
						aria-label={full ? '원래 크기로' : '전체 화면'} aria-pressed={full} onClick={() => setFull(f => !f)} />
				</Panel>
				{help && <Panel position="top-left" className="flow-help">
					<ul>
						<li><b>도구(숫자 키 1~8) → 그림 클릭</b> 그 자리에 추가 · <b>Esc</b> 도구 풀기 · <b>빈 곳 더블클릭</b> 테이블</li>
						<li><b>우클릭</b> 메뉴(추가·색·화살표·삭제·이미지로 저장)</li>
						<li><b>방향키</b> 고른 것 한 칸씩(Shift: 네 칸) · 끌면 다른 박스와 줄 맞춤</li>
						<li><b>글자 더블클릭</b> 편집 · <b>Enter</b> 반영 · <b>Tab</b> 다음 칸 · <b>Esc</b> 취소</li>
						<li><b>PK</b> 칸 클릭으로 PK 켜고 끄기 · 마지막 칸에서 Tab: 컬럼 하나 더</li>
						<li><b>박스·도형 옆 점 → 다른 박스·도형</b> 선 잇기 · 선 우클릭: 화살표 · 선 더블클릭: 글자</li>
						<li><b>도형</b> 더블클릭: 글자 · 끝 손잡이: 크기 · 우클릭: 모양·색</li>
						<li><b>빈 곳 끌기</b> 여러 개 고르기 → 우클릭 그룹으로 묶기</li>
						<li><b>그룹 이름 줄 끌기</b> 안에 든 것과 같이 옮기기</li>
						<li><b>휠</b> 화면 이동(가운데 버튼·Space+끌기도) · <b>Ctrl+휠</b> 확대·축소</li>
						<li><b>Delete</b> 지우기 · <b>Ctrl+C/X/V/D</b> 복사·잘라내기·붙여넣기(마우스 자리에)·복제 · <b>Ctrl+Z/Y</b> 되돌리기·다시</li>
					</ul>
				</Panel>}
				{guides && <Guides x={guides.x} y={guides.y} />}
				{!nodes.length && <Panel position="top-center" className="flow-empty">
					<p>빈 곳을 더블클릭하거나 우클릭해 테이블·메모·그룹을 추가하세요.</p>
					<button type="button" className="btn btn-primary" onClick={() => addTable()}>테이블 추가</button>
				</Panel>}
			</ReactFlow>
		{menu && <Menu key={`${menu.x},${menu.y}`} x={menu.x} y={menu.y} onClose={() => setMenu(undefined)}>
			{menu.items.map((item, i) => item === 'separator' ? <div key={i} className="menu-separator" role="separator" />
				: <button key={i} role={item.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={item.checked} disabled={item.disabled}
					onClick={() => { setMenu(undefined); item.run(); }}>
					<span className="menu-label">{item.swatch && <span className={`swatch note-${item.swatch}`} />}{item.checked !== undefined && <span className={`codicon codicon-${item.checked ? 'check' : 'blank'}`} />}{item.label}</span>
					{item.kbd && <kbd>{item.kbd}</kbd>}</button>)}
		</Menu>}
		</div>
	</DiagramContext.Provider>;
}
