import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { RELAYOUT } from './canvasDom';

const MIN_ZOOM = 0.25, MAX_ZOOM = 4;
export const ZOOM_STEP = 1.25;

/**
 * Design 확대·축소(피그마·포토샵처럼): Ctrl+휠은 마우스 자리를 기준으로 화면을 키우고 줄인다. 확대 중에는 가운데 버튼이나 Space+끌기로 이동한다.
 * 화면 배치는 100% 때 크기(view)로 그대로 두고 transform으로만 키우므로 다시 배치되지 않는다. 100%를 지나갈 때는 100%에 멈춘다.
 */
export function useCanvasZoom(host: RefObject<HTMLDivElement | null>) {
	const scroller = useRef<HTMLDivElement>(null);
	const [zoom, setZoom] = useState(1);
	const [view, setView] = useState({ width: 0, height: 0 });
	const current = useRef(1);
	// 확대 뒤 마우스 아래에 있어야 할 화면 위치(배율 1 기준 px)와 마우스 자리. 다시 그린 뒤 스크롤에 반영한다
	const anchor = useRef<{ x: number; y: number; cx: number; cy: number }>(undefined);
	useLayoutEffect(() => {
		const sc = scroller.current, a = anchor.current;
		anchor.current = undefined;
		if (sc && a) {
			sc.scrollLeft = a.x * zoom - a.cx;
			sc.scrollTop = a.y * zoom - a.cy;
		}
		// 겹침 층(선택 테두리·hover·배지)이 다음 프레임이 아니라 이 확대와 같은 프레임에 새 자리로 가게 바로 다시 재도록 알린다
		sc?.querySelector('.wse-page')?.dispatchEvent(new Event(RELAYOUT));
	}, [zoom]);
	/** at: 고정할 자리(스크롤 칸 기준 px), 없으면 보이는 영역 가운데 */
	const zoomTo = useCallback((target: number, at?: { cx: number; cy: number }) => {
		const sc = scroller.current, el = host.current;
		if (!sc || !el) { return; }
		const old = current.current;
		let next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, target));
		if ((old - 1) * (next - 1) < 0) { next = 1; }
		if (next === old) { return; }
		const cx = at?.cx ?? sc.clientWidth / 2, cy = at?.cy ?? sc.clientHeight / 2;
		anchor.current = { x: anchor.current?.x ?? (sc.scrollLeft + cx) / old, y: anchor.current?.y ?? (sc.scrollTop + cy) / old, cx, cy };
		if (old === 1) { setView({ width: el.clientWidth, height: el.clientHeight }); }
		current.current = next;
		setZoom(next);
	}, [host]);
	useEffect(() => {
		const el = host.current!;
		const wheel = (e: WheelEvent) => {
			const sc = scroller.current;
			if (!e.ctrlKey || !e.deltaY || !sc) { return; }
			e.preventDefault();
			const r = sc.getBoundingClientRect();
			zoomTo(current.current * Math.exp(-e.deltaY * 0.002), { cx: e.clientX - r.left, cy: e.clientY - r.top });
		};
		// Space를 누르고 있는 동안(마우스가 캔버스 위)은 100%에서도 끌기가 선택·컴포넌트 이동 대신 화면 이동(손 도구). 가운데 버튼 끌기도 이동
		let hovered = false, space = false, panning = false;
		const setSpace = (on: boolean) => {
			space = on;
			if (on) { scroller.current?.setAttribute('data-pan', ''); } else { scroller.current?.removeAttribute('data-pan'); }
		};
		// 글자 입력칸과 배율 단추는 Space를 제 용도로 쓴다. 탭 단추처럼 캔버스 밖 단추에 포커스가 남아 있는 것(탭을 누른 직후)은 상관없다
		const typing = (e: Event) => !!(e.composedPath()[0] as HTMLElement | undefined)?.closest?.('input, textarea, select, dialog, [contenteditable], .design-zoom-controls');
		const key = (e: KeyboardEvent) => {
			if (e.code !== 'Space') { return; }
			if (e.type === 'keyup') { setSpace(false); return; }
			if (hovered && !typing(e)) { e.preventDefault(); setSpace(true); }
		};
		const pan = (e: PointerEvent) => {
			const sc = scroller.current;
			if (!sc || !(e.button === 1 || (e.button === 0 && space))) { return; }
			e.preventDefault();
			e.stopPropagation();
			panning = true;
			sc.setAttribute('data-pan', 'active');
			let x = e.clientX, y = e.clientY;
			const move = (ev: PointerEvent) => { sc.scrollLeft -= ev.clientX - x; sc.scrollTop -= ev.clientY - y; x = ev.clientX; y = ev.clientY; };
			const up = () => {
				window.removeEventListener('pointermove', move);
				window.removeEventListener('pointerup', up);
				panning = false;
				if (space) { sc.setAttribute('data-pan', ''); } else { sc.removeAttribute('data-pan'); }
			};
			window.addEventListener('pointermove', move);
			window.addEventListener('pointerup', up);
		};
		// 이동 끝에 따라오는 mouseup 뒤 click이 화면 선택으로 번지지 않게 Space 중에는 click도 막는다
		const swallow = (e: Event) => { if (space) { e.stopPropagation(); e.preventDefault(); } };
		// 컴포넌트 끌어 옮기기(HTML 끌기)는 이동 중이나 Space를 누른 동안에는 시작하지 않는다: 화면을 옮기다 컴포넌트가 따라 옮겨지지 않게
		const noDrag = (e: Event) => { if (space || panning) { e.stopPropagation(); e.preventDefault(); } };
		const enter = () => { hovered = true; };
		const leave = () => { hovered = false; setSpace(false); };
		const off = () => setSpace(false);
		el.addEventListener('wheel', wheel, { passive: false });
		el.addEventListener('pointerdown', pan, true);
		el.addEventListener('click', swallow, true);
		el.addEventListener('dragstart', noDrag, true);
		el.addEventListener('mouseenter', enter);
		el.addEventListener('mouseleave', leave);
		window.addEventListener('keydown', key);
		window.addEventListener('keyup', key);
		window.addEventListener('blur', off);
		return () => {
			el.removeEventListener('wheel', wheel);
			el.removeEventListener('pointerdown', pan, true);
			el.removeEventListener('click', swallow, true);
			el.removeEventListener('dragstart', noDrag, true);
			el.removeEventListener('mouseenter', enter);
			el.removeEventListener('mouseleave', leave);
			window.removeEventListener('keydown', key);
			window.removeEventListener('keyup', key);
			window.removeEventListener('blur', off);
		};
	}, [host, zoomTo]);
	// 확대 중에 창 크기가 바뀌면 100% 때 크기(view)를 따라간다
	const zoomed = zoom !== 1;
	useEffect(() => {
		const el = host.current;
		if (!zoomed || !el) { return; }
		const observer = new ResizeObserver(() => setView(v => v.width === el.clientWidth && v.height === el.clientHeight ? v : { width: el.clientWidth, height: el.clientHeight }));
		observer.observe(el);
		return () => observer.disconnect();
	}, [host, zoomed]);
	return { zoom, view, scroller, zoomBy: (factor: number) => zoomTo(current.current * factor), reset: () => zoomTo(1) };
}
