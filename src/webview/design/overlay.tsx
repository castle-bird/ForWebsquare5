// 캔버스 위 겹침 층: 바인딩·이벤트 배지, 선택·hover 테두리와 크기 손잡이, 여백·간격 표시, 그리드 이동 손잡이
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { clsx } from 'clsx';
import { EV, type XmlNode } from '../../core/xmlModel';
import { distanceLines, type DistanceLine } from './distance';
import { node, scaleOf, visibleRect, watchLayout, wseIndex, type ClipBox, type Rect } from './canvasDom';
import moveIcon from '@vscode/codicons/src/icons/move.svg';

export function Badges({ page, body, tree }: { page: RefObject<HTMLDivElement | null>; body: XmlNode; tree: ReactNode }) {
	const marked = useMemo(() => {
		const out: { index: number; bind: boolean; event: boolean }[] = [];
		const walk = (n: XmlNode) => {
			const bind = !!n.attrs.ref, event = Object.keys(n.attrs).some(k => k.startsWith(EV));
			if (bind || event) { out.push({ index: n.index, bind, event }); }
			n.children.forEach(walk);
		};
		walk(body);
		return out;
	}, [body]);
	const markedRef = useRef(marked);
	markedRef.current = marked;
	const [rects, setRects] = useState<{ index: number; bind: boolean; event: boolean; left: number; top: number }[]>([]);
	const syncRef = useRef<() => void>(undefined);
	// useLayoutEffect면 자식인 이 컴포넌트가 부모 page ref가 붙기 전에 돌아 루프가 안 시작된다(문서가 바뀌어야 나타나던 원인) → 커밋 후 useEffect
	useEffect(() => {
		const p = page.current;
		if (!p) { return; }
		let stop: (() => void) | undefined;
		let current: { index: number; bind: boolean; event: boolean; el: HTMLElement }[] = [];
		const sync = () => {
			const list = markedRef.current;
			if (!list.length) {
				stop?.();
				stop = undefined;
				current = [];
				setRects(r => r.length ? [] : r);
				return;
			}
			const elements = new Map([...p.querySelectorAll<HTMLElement>('[data-wse]:not([data-wse-frame] *)')].map(el => [wseIndex(el), el]));
			const targets = list.flatMap(m => {
				const el = elements.get(m.index);
				return el ? [{ ...m, el }] : [];
			});
			if (stop && targets.length === current.length && targets.every((t, i) => {
				const c = current[i];
				return t.index === c.index && t.bind === c.bind && t.event === c.event && t.el === c.el;
			})) {
				return;
			}
			stop?.();
			current = targets;
			const measure = () => {
				const clipCache = new Map<Element, ClipBox | null>();
				return targets.flatMap(({ el, ...m }) => {
					const r = visibleRect(el, p, clipCache);
					return r ? [{ ...m, left: r.left, top: r.top }] : [];
				});
			};
			stop = watchLayout(targets.map(t => t.el), p, measure, setRects);
		};
		syncRef.current = sync;
		// 탭 content처럼 DOM만 바뀔 때도 새 요소를 찾아 감시한다.
		const observer = new MutationObserver(sync);
		observer.observe(p, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-wse'] });
		return () => { syncRef.current = undefined; observer.disconnect(); stop?.(); };
	}, [page]);
	useEffect(() => { syncRef.current?.(); }, [marked, tree]);
	return <>{rects.map(r => (
		<div key={r.index} className="wse-badges" style={{ left: r.left, top: r.top }}>
			{r.bind && <span className="bind" title="ref 바인딩 있음" />}
			{r.event && <span className="event" title="이벤트 핸들러 있음" />}
		</div>
	))}</>;
}

/** 캔버스 요소 하나(index)의 보이는 자리: 크기·스크롤·문서(tree)가 바뀌면 다시 잰다 */
function useNodeRect(page: RefObject<HTMLDivElement | null>, index: number | undefined, tree: ReactNode) {
	const [rect, setRect] = useState<Rect>();
	const [target, setTarget] = useState<HTMLElement>();
	useLayoutEffect(() => {
		const p = page.current;
		const el = index === undefined || Number.isNaN(index) ? undefined : p?.querySelector<HTMLElement>(node(index)) ?? undefined;
		setTarget(el);
		if (!p || !el) {
			setRect(undefined);
			return;
		}
		return watchLayout([el], p, () => visibleRect(el, p), setRect);
	}, [page, index, tree]);
	return { rect, target };
}

export function HoverSpacing({ page, index, tree, sheets }: {
	page: RefObject<HTMLDivElement | null>; index?: number; tree: ReactNode; sheets?: string[];
}) {
	const [spacing, setSpacing] = useState<{ clip: Rect; padding: string; margin: string }>();
	useLayoutEffect(() => {
		const p = page.current, el = index === undefined ? undefined : p?.querySelector<HTMLElement>(node(index));
		if (!p || !el) { setSpacing(undefined); return; }
		return watchLayout([el], p, () => {
			if (!el.getClientRects().length) { return undefined; }
			const a = el.getBoundingClientRect(), b = p.getBoundingClientRect(), style = getComputedStyle(el);
			const scaleX = a.width / (el.offsetWidth || a.width || 1), scaleY = a.height / (el.offsetHeight || a.height || 1);
			// shortcut: 음수 margin·회전 변형은 정확한 영역을 표시하지 않는다, 해당 배치 지원이 필요하면 사각형 계산을 확장한다.
			const sides = (prefix: string) => ['top', 'right', 'bottom', 'left'].map((side, i) =>
				Math.max(0, parseFloat(style.getPropertyValue(prefix + '-' + side + (prefix === 'border' ? '-width' : ''))) || 0) * (i % 2 ? scaleX : scaleY));
			const [pt, pr, pb, pl] = sides('padding'), [mt, mr, mb, ml] = sides('margin'), [bt, br, bb, bl] = sides('border');
			if (!(pt || pr || pb || pl || mt || mr || mb || ml)) { return undefined; }
			const zoom = scaleOf(p);
				let left = b.left + p.clientLeft, top = b.top + p.clientTop, right = left + p.clientWidth * zoom, bottom = top + p.clientHeight * zoom;
			for (let parent = el.parentElement; parent && parent !== p; parent = parent.parentElement) {
				const css = getComputedStyle(parent), r = parent.getBoundingClientRect();
				if (css.overflowX !== 'visible') { left = Math.max(left, r.left + parent.clientLeft); right = Math.min(right, r.left + parent.clientLeft + parent.clientWidth); }
				if (css.overflowY !== 'visible') { top = Math.max(top, r.top + parent.clientTop); bottom = Math.min(bottom, r.top + parent.clientTop + parent.clientHeight); }
			}
			if (right <= left || bottom <= top) { return undefined; }
			const x = a.left - left, y = a.top - top;
			const box = (x: number, y: number, w: number, h: number) => `M${x},${y}h${Math.max(0, w)}v${Math.max(0, h)}h${-Math.max(0, w)}Z`;
			const width = a.width - bl - br, height = a.height - bt - bb;
			return {
				clip: { left: left - b.left, top: top - b.top, width: right - left, height: bottom - top },
				padding: pt || pr || pb || pl ? box(x + bl, y + bt, width, height) + box(x + bl + pl, y + bt + pt, width - pl - pr, height - pt - pb) : '',
				margin: mt || mr || mb || ml ? box(x - ml, y - mt, a.width + ml + mr, a.height + mt + mb) + box(x, y, a.width, a.height) : '',
			};
		}, setSpacing);
	}, [page, index, tree, sheets]);
	return spacing && <svg className="wse-spacing" style={spacing.clip} aria-hidden="true">
		{spacing.margin && <path className="margin" d={spacing.margin} fillRule="evenodd" />}
		{spacing.padding && <path className="padding" d={spacing.padding} fillRule="evenodd" />}
	</svg>;
}

/** 보이는 요소만 대상으로 하되 잘리기 전의 경계로 실제 간격을 잰다. */
export function Distances({ page, from, extra, to, tree, sheets }: {
	page: RefObject<HTMLDivElement | null>; from?: number; extra: number[]; to?: number; tree: ReactNode; sheets?: string[];
}) {
	const [measurement, setMeasurement] = useState<{ lines: DistanceLine[]; width: number; height: number; scale: number }>();
	useLayoutEffect(() => {
		const p = page.current, b = to === undefined ? undefined : p?.querySelector(node(to));
		const selected = from === undefined ? [] : [from, ...extra].flatMap(i => p?.querySelector(node(i)) ?? []);
		if (!p || !selected.length || !b) { setMeasurement(undefined); return; }
		return watchLayout([...selected, b], p, () => {
			if (!selected.some(el => visibleRect(el, p)) || !visibleRect(b, p)) { return undefined; }
			const origin = p.getBoundingClientRect();
			// shortcut: 회전 요소도 화면의 축에 평행한 경계 상자로 잰다, 회전된 변 사이 측정이 필요하면 다각형 계산으로 확장한다.
			const bounds = (el: Element) => {
				const r = el.getBoundingClientRect();
				return { left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top };
			};
			const group = selected.filter(el => el.getClientRects().length).map(bounds).reduce((a, r) => ({ left: Math.min(a.left, r.left), top: Math.min(a.top, r.top), right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom) }));
			return { lines: distanceLines(group, bounds(b)), width: p.clientWidth * scaleOf(p), height: p.clientHeight * scaleOf(p), scale: scaleOf(p) };
		}, setMeasurement);
	}, [page, from, extra, to, tree, sheets]);
	return measurement && <svg className="wse-measure" aria-hidden="true">{measurement.lines.map((line, i) => {
		const { x1, y1, x2, y2, horizontal, guide } = line;
		const text = `${Math.round(Math.abs(horizontal ? x2 - x1 : y2 - y1) / measurement.scale * 10) / 10}px`, width = text.length * 7 + 8;
		const x = Math.max(width / 2, Math.min(measurement.width - width / 2, horizontal ? (x1 + x2) / 2 : x1 + width / 2 + 5));
		const y = Math.max(9, Math.min(measurement.height - 9, horizontal ? y1 - 12 : (y1 + y2) / 2));
		return <g key={i}>
			{guide && <line className="guide" {...guide} />}
			<line className="distance" x1={x1} y1={y1} x2={x2} y2={y2} />
			<path d={horizontal ? `M${x1},${y1 - 3}v6M${x2},${y2 - 3}v6` : `M${x1 - 3},${y1}h6M${x2 - 3},${y2}h6`} />
			<rect x={x - width / 2} y={y - 9} width={width} height={18} rx={3} />
			<text x={x} y={y} dominantBaseline="central" textAnchor="middle">{text}</text>
		</g>;
	})}</svg>;
}

export function Frame({ page, index, kind, tree, onResize, label }: {
	page: RefObject<HTMLDivElement | null>; index?: number; kind: string; tree: ReactNode; onResize?(props: Record<string, string>): void; label?: string;
}) {
	const { rect, target } = useNodeRect(page, index, tree);
	if (!rect) {
		return null;
	}
	const dirs = onResize && target && resizable(target) ? ['e', 'se', 's'] : [];
	return <>
		<div className={clsx('wse-frame', kind)} style={rect}>
			{dirs.map(d => <div key={d} className={`wse-handle ${d}`} onPointerDown={e => resize(e, target!, d, onResize!)} />)}
		</div>
		{label && <Chip page={page} rect={rect} text={label} />}
	</>;
}

/**
 * 그리드 이동 손잡이(Word 표처럼): 그리드 왼쪽 위 바깥(자리가 없으면 안쪽 모서리). 끌면 그리드 이동, 누르면 그리드 선택.
 * 칸을 끄는 것은 칸 범위 고르기라서 그리드는 이걸로만 옮긴다. 캔버스는 Shadow DOM이라 codicon 글꼴 class 대신 Codicon SVG를 mask로(글자색 = 손잡이 글자색)
 */
export function GridHandle({ page, index, tree, onDragStart, onSelect, onEnter }: {
	page: RefObject<HTMLDivElement | null>; index: number; tree: ReactNode; onDragStart(e: ReactDragEvent): void; onSelect(): void; onEnter(): void;
}) {
	const { rect } = useNodeRect(page, index, tree);
	if (!rect) {
		return null;
	}
	const size = 18, left = rect.left >= size ? rect.left - size : rect.left, top = rect.top >= size ? rect.top - size : rect.top;
	return <div className="wse-grid-handle" style={{ left, top, width: size, height: size }} draggable role="button" title="그리드 이동(끌기) · 선택(클릭)" aria-label="그리드 이동"
		onDragStart={onDragStart} onClick={onSelect} onMouseEnter={onEnter}>
		{/* SVG data URL에 따옴표가 그대로 있어 url("…")로 감싸면 CSS가 깨져 아이콘이 사라진다. 따옴표를 이스케이프해서 넣는다 */}
		<span className="wse-grid-move" style={{ maskImage: `url(${JSON.stringify(moveIcon)})` }} aria-hidden="true" />
	</div>;
}

function Chip({ page, rect, text }: { page: RefObject<HTMLDivElement | null>; rect: Rect; text: string }) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ left: number; top: number }>();
	const [faded, setFaded] = useState(false);
	useLayoutEffect(() => {
		const el = ref.current, p = page.current;
		if (!el || !p) { return; }
		const h = el.offsetHeight, gap = 3, zoom = scaleOf(p);
		const above = rect.top - gap - h, below = rect.top + rect.height + gap;
		const top = above >= 0 ? above : below + h <= p.clientHeight * zoom ? below : rect.top;
		setPos({ left: Math.max(0, Math.min(rect.left, p.clientWidth * zoom - el.offsetWidth)), top });
	}, [page, rect, text]);
	useEffect(() => {
		const move = (e: PointerEvent) => {
			const r = ref.current?.getBoundingClientRect();
			setFaded(!!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
		};
		window.addEventListener('pointermove', move);
		return () => window.removeEventListener('pointermove', move);
	}, []);
	return <div ref={ref} className={clsx('wse-chip', { faded })} style={pos ?? { visibility: 'hidden' }}>{text}</div>;
}

const resizable = (el: Element) => !getComputedStyle(el).display.startsWith('table-') && !el.matches('.wse-page > *');

function resize(e: ReactPointerEvent, el: HTMLElement, dir: string, commit: (props: Record<string, string>) => void) {
	e.stopPropagation();
	const cs = getComputedStyle(el), scale = scaleOf(el.closest('.wse-page') ?? el);
	const s = { x: e.clientX, y: e.clientY, width: parseFloat(cs.width), height: parseFloat(cs.height) };
	let next: Record<string, number> | undefined;
	const move = (ev: PointerEvent) => {
		const dx = (ev.clientX - s.x) / scale, dy = (ev.clientY - s.y) / scale;
		if (!next && Math.hypot(dx, dy) < 3) {
			return;
		}
		next = {};
		if (dir.includes('e')) {
			next.width = Math.max(1, s.width + dx);
		}
		if (dir.includes('s')) {
			next.height = Math.max(1, s.height + dy);
		}
		for (const [k, v] of Object.entries(next)) {
			el.style.setProperty(k, `${Math.round(v)}px`);
		}
		window.getSelection()?.removeAllRanges();
	};
	const up = () => {
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', up);
		window.removeEventListener('pointercancel', up);
		if (next) {
			commit(Object.fromEntries(Object.entries(next).map(([k, v]) => [k, `${Math.round(v)}px`])));
		}
	};
	window.addEventListener('pointermove', move);
	window.addEventListener('pointerup', up);
	window.addEventListener('pointercancel', up);
}
