// Outline(웹뷰 오른쪽 아래 트리) 끌어 놓을 자리 계산: 화면 없이 단위 테스트할 수 있게 웹뷰 밖에 둔다
import type { DropPosition } from './paste';

/** 트리 한 단계 들여쓰기(px). style의 paddingLeft와 같아야 한다 */
export const INDENT = 14;

/** Outline 끌어 놓기 계산용 줄(보이는 순서, 끄는 것과 그 자손 제외). top·bottom: 트리 기준 y, open: 펼쳐져 자식 줄이 보임 */
export interface FlatRow { index: number; depth: number; container: boolean; open: boolean; top: number; bottom: number }
/** 놓을 자리: move(target, position). parent: 놓인 뒤의 부모 줄(강조), line: 줄 사이에 놓으면 표시선의 y·깊이 */
export interface OutlineDrop { target: number; position: DropPosition; parent: number; line?: { y: number; depth: number } }

/**
 * Outline 끌어 놓기 자리(VS Code·Figma 레이어처럼, 포인터 기준).
 * 그릇 줄의 가운데 → 그 안 맨 뒤. 줄 사이 틈 → 끌며 가로로 움직인 만큼(INDENT = 한 단계) 깊이를 고른다:
 * 마지막 자식 아래 틈에서 왼쪽으로 끌면 바깥 그릇 뒤로, 펼친 그릇 바로 아래 틈은 그 안 맨 앞. 트리 아래 빈 곳은 가장 바깥 단계.
 * y: 포인터(트리 기준), dx: 끈 가로 거리, from: 끄는 줄의 깊이
 */
export function projectDrop(rows: FlatRow[], y: number, dx: number, from: number): OutlineDrop | undefined {
	const at = rows.findIndex(r => y < r.bottom);
	let gap = at < 0 ? rows.length : at;
	if (at >= 0 && y >= rows[at].top) {
		const r = rows[at], ratio = (y - r.top) / (r.bottom - r.top);
		if (r.depth === 0 || r.container && ratio >= 0.25 && ratio <= 0.75) {
			return { target: r.index, position: 'inside', parent: r.index };
		}
		gap = ratio < 0.5 ? at : at + 1;
	}
	const prev = rows[gap - 1], next = rows[gap];
	if (!prev) { return undefined; }
	const max = prev.depth + (prev.container && prev.open ? 1 : 0);
	const min = Math.min(max, Math.max(1, next?.depth ?? 1));
	// 트리 아래 빈 곳(마지막 줄 반 줄 아래부터)은 가장 바깥 단계
	const below = !next && y > prev.bottom + (prev.bottom - prev.top) / 2;
	const depth = below ? min : Math.max(min, Math.min(max, from + Math.round(dx / INDENT)));
	const before = (i: number, d: number) => { for (let k = i; k >= 0; k--) { if (rows[k].depth === d) { return rows[k]; } } return undefined; };
	const parent = before(gap - 1, depth - 1);
	if (!parent) { return undefined; }
	const line = { y: prev.bottom, depth };
	if (depth > prev.depth) {
		return next && next.depth === depth
			? { target: next.index, position: 'before', parent: parent.index, line }
			: { target: prev.index, position: 'inside', parent: parent.index, line };
	}
	return { target: before(gap - 1, depth)!.index, position: 'after', parent: parent.index, line };
}
