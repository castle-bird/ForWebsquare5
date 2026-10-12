export interface Bounds { left: number; top: number; right: number; bottom: number }
interface Line { x1: number; y1: number; x2: number; y2: number }
export interface DistanceLine extends Line { horizontal: boolean; guide?: Line }

/** 분리된 축은 가까운 경계 사이, 겹치는 사각형은 대응하는 네 경계 사이를 잰다. */
export function distanceLines(a: Bounds, b: Bounds): DistanceLine[] {
	const xGap = a.right <= b.left ? [a.right, b.left] : b.right <= a.left ? [b.right, a.left] : undefined;
	const yGap = a.bottom <= b.top ? [a.bottom, b.top] : b.bottom <= a.top ? [b.bottom, a.top] : undefined;
	const x = xGap ? (a.left + a.right) / 2 : (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;
	const y = yGap ? (a.top + a.bottom) / 2 : (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
	const out: DistanceLine[] = [];
	if (xGap) {
		const edge = b.right <= a.left ? b.right : b.left;
		out.push({ horizontal: true, x1: xGap[0], y1: y, x2: xGap[1], y2: y,
			...yGap && { guide: { x1: edge, y1: y, x2: edge, y2: Math.max(b.top, Math.min(y, b.bottom)) } } });
	}
	if (yGap) {
		const edge = b.bottom <= a.top ? b.bottom : b.top;
		out.push({ horizontal: false, x1: x, y1: yGap[0], x2: x, y2: yGap[1],
			...xGap && { guide: { x1: x, y1: edge, x2: Math.max(b.left, Math.min(x, b.right)), y2: edge } } });
	}
	if (!xGap && !yGap) {
		out.push({ horizontal: true, x1: a.left, y1: y, x2: b.left, y2: y }, { horizontal: true, x1: a.right, y1: y, x2: b.right, y2: y },
			{ horizontal: false, x1: x, y1: a.top, x2: x, y2: b.top }, { horizontal: false, x1: x, y1: a.bottom, x2: x, y2: b.bottom });
	}
	return out;
}
