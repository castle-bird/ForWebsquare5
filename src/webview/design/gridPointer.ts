// 캔버스 그리드의 포인터 조작: 칸 범위 고르기, 열 너비 끌기
import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { localName, nodeAt, pathTo, type XmlNode } from '../../core/xmlModel';
import { edgeSpeed } from '../ui/edgeScroll';
import { capturePointer } from '../ui/pointerCapture';
import { pick, wseIndex } from './canvasDom';

/**
 * 그리드 칸을 누른 채 끌면 누른 칸부터 지금 칸까지 직사각형 안의 칸을 모두 고른다(엑셀처럼, 같은 header·gBody 등 안에서만).
 * 그리드 옮기기는 이동 손잡이(GridHandle)로만. 끌어서 고른 뒤 따라오는 click은 선택을 덮지 않게 무시
 */
export function useCellRange(body: XmlNode, page: RefObject<HTMLDivElement | null>, onSelectCells?: (primary: number, cells: number[]) => void) {
	/** scroller: 그리드 스크롤 칸(가장자리 밖으로 끌면 그쪽으로 굴린다), x·y: 마지막 포인터 자리 */
	const drag = useRef<{ anchor: number; owner: number; last: number; scroller?: HTMLElement; x: number; y: number; frame?: number }>(undefined);
	const swallowClick = useRef(false);
	const cellAt = (t: EventTarget) => {
		const el = pick(t as Element), path = el ? pathTo(body, wseIndex(el)) : undefined, grid = path?.find(n => localName(n.tag) === 'gridView');
		return path && grid && localName(path.at(-1)!.tag) === 'column' && path.length > 3 ? { path, grid } : undefined;
	};
	/** 두 칸(anchor·index, 같은 owner=header·gBody 등 안)을 모서리로 하는 직사각형 안의 칸 번호들. 못 재면 undefined */
	const between = (anchor: number, index: number, ownerIndex: number) => {
		const rect = (i: number) => page.current?.querySelector(`[data-wse="${i}"]`)?.getBoundingClientRect();
		const a = rect(anchor), b = rect(index), owner = nodeAt(body, ownerIndex);
		if (!a || !b || !owner) { return undefined; }
		const box = { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) };
		// 칸 가운데가 상자 안이면 고름(병합 칸처럼 여러 줄·칸을 차지해도). 스크롤에 가려진 칸도 좌표는 있다
		return owner.children.flatMap(row => row.children).filter(c => localName(c.tag) === 'column').flatMap(c => {
			const r = rect(c.index), cx = r && (r.left + r.right) / 2, cy = r && (r.top + r.bottom) / 2;
			return r && cx! >= box.left && cx! <= box.right && cy! >= box.top && cy! <= box.bottom ? [c.index] : [];
		});
	};
	/** 포인터 자리(그리드 밖이면 그리드 안 가장자리로 당겨서)의 칸까지 고른다. 새로 골랐으면 true */
	const select = (d: NonNullable<typeof drag.current>) => {
		let { x, y } = d;
		if (d.scroller) {
			const r = d.scroller.getBoundingClientRect(), left = r.left + d.scroller.clientLeft, top = r.top + d.scroller.clientTop;
			x = Math.min(Math.max(x, left + 1), left + d.scroller.clientWidth - 2);
			y = Math.min(Math.max(y, top + 1), top + d.scroller.clientHeight - 2);
		}
		// 포인터를 잡은 뒤에는 target이 캔버스라 커서 아래 칸은 좌표로 찾는다
		const under = (page.current?.getRootNode() as ShadowRoot | undefined)?.elementFromPoint(x, y);
		const cell = under ? cellAt(under) : undefined;
		const index = cell?.path.at(-1)!.index;
		if (!cell || index === undefined || cell.path.at(-3)!.index !== d.owner || index === d.last) { return false; }
		d.last = index;
		const cells = between(d.anchor, index, d.owner);
		if (!cells) { return false; }
		onSelectCells!(d.anchor, cells);
		return true;
	};
	/** 포인터가 그리드 가장자리(EDGE px 안)나 밖이면 멀수록 빠르게 굴리고 새로 보인 칸까지 고른다. 안쪽으로 오면 멈춤 */
	const EDGE = 24;
	const autoScroll = () => {
		const d = drag.current, s = d?.scroller;
		if (!d || !s) { return; }
		const r = s.getBoundingClientRect();
		const dx = edgeSpeed(r.left + EDGE - d.x, d.x - (r.left + s.clientLeft + s.clientWidth - EDGE));
		const dy = edgeSpeed(r.top + EDGE - d.y, d.y - (r.top + s.clientTop + s.clientHeight - EDGE));
		const { scrollLeft, scrollTop } = s;
		s.scrollBy(dx, dy);
		if (s.scrollLeft === scrollLeft && s.scrollTop === scrollTop) { d.frame = undefined; return; }
		select(d);
		d.frame = requestAnimationFrame(autoScroll);
	};
	const stop = () => {
		if (drag.current?.frame !== undefined) { cancelAnimationFrame(drag.current.frame); }
		drag.current = undefined;
	};
	useEffect(() => stop, []);
	return {
		/** 끌어서 고르는 중(그리드 옮기기 native drag를 막는다) */
		active: () => !!drag.current,
		/** 방금 끌어서 골랐으면 이번 click은 건너뛴다 */
		takeClick: () => { const swallow = swallowClick.current; swallowClick.current = false; return swallow; },
		/** Shift+클릭: 지금 고른 칸(anchor)부터 누른 칸까지 직사각형으로 고른다. 같은 header·gBody 안의 칸일 때만 하고 했으면 true */
		rangeTo: (target: EventTarget, anchor: number | undefined) => {
			const cell = onSelectCells && anchor !== undefined ? cellAt(target) : undefined, from = anchor !== undefined ? pathTo(body, anchor) : undefined;
			const index = cell?.path.at(-1)!.index, owner = cell?.path.at(-3)!.index;
			if (!cell || index === undefined || !from || localName(from.at(-1)!.tag) !== 'column' || from.at(-3)?.index !== owner) { return false; }
			const cells = between(anchor!, index, owner!);
			if (!cells) { return false; }
			onSelectCells!(anchor!, cells);
			return true;
		},
		onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
			swallowClick.current = false;
			// Shift+클릭은 글자 선택이 번지지 않게(범위 고르기는 click에서)
			if (e.shiftKey && !e.defaultPrevented && e.button === 0 && onSelectCells && cellAt(e.target)) { e.preventDefault(); }
			const cell = !e.defaultPrevented && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && onSelectCells ? cellAt(e.target) : undefined;
			if (!cell) { return; }
			// 글자 선택·그리드 끌기가 시작되지 않게(click·dblclick은 그대로 온다)
			e.preventDefault();
			const index = cell.path.at(-1)!.index;
			const scroller = page.current?.querySelector<HTMLElement>(`[data-wse="${cell.grid.index}"]`) ?? undefined;
			drag.current = { anchor: index, owner: cell.path.at(-3)!.index, last: index, scroller, x: e.clientX, y: e.clientY };
		},
		onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
			const d = drag.current;
			if (!d) { return; }
			d.x = e.clientX;
			d.y = e.clientY;
			// 다른 칸으로 넘어가면(끌기 시작) 캔버스 밖에서 놓아도 끝나게 포인터를 잡는다. 누르자마자 잡으면 click이 칸 대신 캔버스로 가 선택이 안 됨
			if (select(d) && !swallowClick.current) {
				capturePointer(e);
				swallowClick.current = true;
			}
			if (swallowClick.current && d.frame === undefined) { autoScroll(); }
		},
		onPointerUp: stop,
	};
}

/**
 * 그리드 열 너비: 머리 칸 오른쪽 끝 5px을 끌면 그 <col>을 바로 넓히고, 놓으면 width 속성으로 반영(onResized).
 * 기준은 화면 폭이 아니라 <col>의 width(=XML 값). autoFit(100%)이면 화면 폭이 비율로 늘어나 있어서
 * 화면 폭을 넣으면 그 열만 몇 배로 커진다 → 마우스 이동량도 같은 비율(scale)로 나눠 XML 단위로 바꾼다
 */
export function useColumnResize(onResized: (index: number, width: number) => void) {
	const drag = useRef<{ index: number; col?: HTMLElement; table?: HTMLElement; tableWidth?: number; startX: number; width: number; scale: number }>(undefined);
	const widthAt = (d: NonNullable<typeof drag.current>, x: number) => Math.max(20, Math.round(d.width + (x - d.startX) / d.scale));
	return {
		onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
			const c = (e.target as Element).closest?.<HTMLTableCellElement>('[data-wse-resize]');
			if (!c || e.button !== 0 || e.clientX < c.getBoundingClientRect().right - 5) { return; }
			e.preventDefault();
			e.stopPropagation();
			const table = c.closest('table') ?? undefined;
			// 칸 순서(cellIndex)는 병합·번호 칸 때문에 열 순서와 다를 수 있어 렌더러가 적어 둔 <col> 순서를 쓴다
			const col = table?.querySelector('colgroup')?.children[Number(c.getAttribute('data-wse-resize'))] as HTMLElement | undefined;
			const rendered = c.getBoundingClientRect().width;
			const width = parseFloat(col?.style.width ?? '') || rendered;
			const tableWidth = table?.style.width.endsWith('px') ? parseFloat(table.style.width) : undefined;
			drag.current = { index: wseIndex(c), col, table, tableWidth, startX: e.clientX, width, scale: rendered / width || 1 };
			capturePointer(e);
		},
		onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
			const d = drag.current;
			if (d?.col) {
				const w = widthAt(d, e.clientX);
				d.col.style.width = `${w}px`;
				if (d.table && d.tableWidth !== undefined) { d.table.style.width = `${d.tableWidth + w - d.width}px`; }
			}
		},
		onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => {
			const d = drag.current;
			drag.current = undefined;
			const width = d && widthAt(d, e.clientX);
			if (d && width !== undefined && width !== Math.round(d.width)) { onResized(d.index, width); }
		},
		onPointerCancel: () => { drag.current = undefined; },
	};
}
