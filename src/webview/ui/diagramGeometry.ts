import type { InternalNode, XYPosition } from '@xyflow/react';
import type { FlowNode } from './usedTablesNodes';

export const sizeOf = (n: FlowNode) => ({ w: n.measured?.width ?? n.width ?? 0, h: n.measured?.height ?? n.height ?? 0 });

const centerOf = (n: FlowNode) => { const { w, h } = sizeOf(n); return { x: n.position.x + w / 2, y: n.position.y + h / 2 }; };

/** 선이 붙을 점: 두 박스가 마주 보는 면(가로로 더 떨어져 있으면 좌우, 아니면 위아래). 박스를 옮기면 따라 바뀐다 */
export function facingSides(a: FlowNode, b: FlowNode): [string, string] {
	const p = centerOf(a), q = centerOf(b), dx = q.x - p.x, dy = q.y - p.y;
	return Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? ['r', 'l'] : ['l', 'r'] : dy >= 0 ? ['b', 't'] : ['t', 'b'];
}

/** 그룹 틀 안에 든 것: 테이블·메모는 가운데가, 다른 틀은 통째로 안에 있으면 */
export function inside(frame: FlowNode, n: FlowNode) {
	const { w, h } = sizeOf(frame), x0 = frame.position.x, y0 = frame.position.y;
	const within = (p: XYPosition) => p.x >= x0 && p.x <= x0 + w && p.y >= y0 && p.y <= y0 + h;
	if (n.type !== 'group-frame') { return within(centerOf(n)); }
	const s = sizeOf(n);
	return within(n.position) && within({ x: n.position.x + s.w, y: n.position.y + s.h });
}
/** 곧은 선이 지날 자리: 마주 보는 두 박스가 선과 수직인 방향으로 겹치면(위아래로 이을 때 가로 범위 등) 겹친 범위의 가운데. 덜 겹치면 없음 */
export function straightAt(a: InternalNode | undefined, b: InternalNode | undefined, vertical: boolean) {
	if (!a || !b) { return undefined; }
	const span = (n: InternalNode) => { const p = n.internals.positionAbsolute, s = vertical ? n.measured.width ?? 0 : n.measured.height ?? 0, at = vertical ? p.x : p.y; return [at, at + s]; };
	const [a0, a1] = span(a), [b0, b1] = span(b), lo = Math.max(a0, b0), hi = Math.min(a1, b1);
	return hi - lo >= 16 ? Math.round((lo + hi) / 2) : undefined;
}
/** 끌 때 다른 박스와 맞출 거리(화면 px) */
const ALIGN = 6;

/**
 * 정렬 맞춤: 끄는 박스의 왼쪽·가운데·오른쪽(위·가운데·아래)이 다른 박스의 것과 가까우면 거기에 붙인다(가로·세로 따로, 가장 가까운 것).
 * 돌려주는 at은 맞춘 선의 그림 좌표(안내선)
 */
export function alignTo(node: FlowNode, pos: XYPosition, nodes: FlowNode[], zoom: number) {
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
