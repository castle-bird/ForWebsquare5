// ERD(@xyflow/react) 박스 배치(@dagrejs/dagre): 데이터 흐름·매퍼 테이블 추출 시 겹치지 않게 배치한다
import { graphlib, layout } from '@dagrejs/dagre';
import type { TableLink, UsedTable, UsedTables } from './tables';

const GRID = 16;
export const snap = (n: number) => Math.round(n / GRID) * GRID;
export const snapUp = (n: number) => Math.ceil(n / GRID) * GRID;

interface BoxSize { w: number; h: number }
interface Box extends BoxSize { x: number; y: number }

/** 줄마다 글자 폭(영문 1칸, 한글 등 2칸)으로 박스 추정 너비를 구한다 */
function textCols(text: string): number {
	return Math.max(0, ...text.split('\n').map(line => [...line].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x7f ? 2 : 1), 0)));
}

/** 측정 크기가 없을 때 테이블 박스 추정 크기 */
export function estimateTableSize(t: UsedTable, measured?: BoxSize): BoxSize {
	if (measured && measured.w > 0 && measured.h > 0) { return measured; }
	const shown = t.keysOnly && t.columns.some(c => c.pk) ? t.columns.filter(c => c.pk) : t.columns;
	const cols = Math.max(18, textCols(t.name), ...shown.map(c => textCols(`${c.name} ${c.desc} ${c.type}`) + 6));
	const w = Math.min(440, Math.max(240, snapUp(cols * 8 + 48)));
	const h = snapUp(76 + Math.max(1, shown.length) * 24);
	return { w, h };
}

/** 기존 ERD 항목들이 차지하는 직사각형 목록(새 요소 비겹침 배치용) */
function occupiedBoxes(data: UsedTables, sizes?: ReadonlyMap<string, BoxSize>): Box[] {
	return [
		...data.tables.map(t => ({ x: t.x, y: t.y, ...estimateTableSize(t, sizes?.get(t.id)) })),
		...data.memos,
		...data.groups,
		...data.shapes,
	];
}

/** 평면 그래프 한 단계 배치(@dagrejs/dagre). 각 노드의 (0,0) 기준 좌상단 좌표와 전체 폭·높이를 돌려준다 */
export function layoutFlat(
	items: { id: string; w: number; h: number }[],
	edges: { from: string; to: string }[],
	options: { direction?: 'LR' | 'TB'; nodesep?: number; ranksep?: number; edgesep?: number } = {},
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
	const positions = new Map<string, { x: number; y: number }>();
	if (!items.length) { return { positions, width: 0, height: 0 }; }
	const g = new graphlib.Graph();
	g.setGraph({
		rankdir: options.direction ?? 'LR',
		nodesep: options.nodesep ?? 48,
		ranksep: options.ranksep ?? 80,
		edgesep: options.edgesep ?? 24,
		marginx: 0,
		marginy: 0,
	});
	g.setDefaultEdgeLabel(() => ({}));
	const sizes = new Map<string, BoxSize>();
	for (const item of items) {
		sizes.set(item.id, { w: item.w, h: item.h });
		g.setNode(item.id, { width: item.w, height: item.h });
	}
	const seen = new Set<string>();
	for (const e of edges) {
		if (e.from === e.to || !sizes.has(e.from) || !sizes.has(e.to)) { continue; }
		const key = `${e.from}\0${e.to}`;
		if (!seen.has(key)) { seen.add(key); g.setEdge(e.from, e.to); }
	}
	layout(g);
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	const raw = new Map<string, { x: number; y: number }>();
	for (const item of items) {
		const n = g.node(item.id);
		const x = snap(n.x - item.w / 2);
		const y = snap(n.y - item.h / 2);
		raw.set(item.id, { x, y });
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x + item.w);
		maxY = Math.max(maxY, y + item.h);
	}
	for (const [id, p] of raw) {
		positions.set(id, { x: p.x - minX, y: p.y - minY });
	}
	return { positions, width: snapUp(maxX - minX), height: snapUp(maxY - minY) };
}

/** 새로 추가할 테이블 묶음과 관계를 기존 ERD와 겹치지 않는 오른쪽 빈자리에 배치한다 */
export function placeNewTables(current: UsedTables, additions: UsedTable[], links: TableLink[], sizes?: ReadonlyMap<string, BoxSize>): UsedTable[] {
	if (!additions.length) { return []; }
	const occupied = occupiedBoxes(current, sizes);
	const startX = occupied.length ? snap(Math.max(...occupied.map(b => b.x + b.w)) + 96) : 80;
	const startY = occupied.length ? snap(Math.min(...occupied.map(b => b.y))) : 80;
	const items = additions.map(t => ({ id: t.id, ...estimateTableSize(t) }));
	const { positions } = layoutFlat(items, links, { direction: 'LR', nodesep: 48, ranksep: 80 });
	return additions.map(t => {
		const p = positions.get(t.id) ?? { x: 0, y: 0 };
		return { ...t, x: snap(startX + p.x), y: snap(startY + p.y) };
	});
}
