export interface Box { x: number; y: number; width: number; height: number }
export const resizeEdges = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] as const;
export type ResizeEdge = typeof resizeEdges[number];

export function resizeBox(start: Box, edge: ResizeEdge, dx: number, dy: number, viewportWidth: number, viewportHeight: number): Box {
	const minWidth = Math.min(400, viewportWidth - 16), minHeight = Math.min(260, viewportHeight - 16);
	let left = start.x, top = start.y, right = start.x + start.width, bottom = start.y + start.height;
	if (edge.includes('w')) { left = Math.max(0, Math.min(right - minWidth, start.x + dx)); }
	if (edge.includes('e')) { right = Math.min(viewportWidth, Math.max(left + minWidth, start.x + start.width + dx)); }
	if (edge.includes('n')) { top = Math.max(0, Math.min(bottom - minHeight, start.y + dy)); }
	if (edge.includes('s')) { bottom = Math.min(viewportHeight, Math.max(top + minHeight, start.y + start.height + dy)); }
	return { x: left, y: top, width: right - left, height: bottom - top };
}
