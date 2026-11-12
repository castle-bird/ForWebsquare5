// 캔버스(Shadow DOM)에 그려진 요소 읽기: data-wse 요소 찾기, 보이는 자리 재기, 배치 변화 감시
import { autoUpdate, getOverflowAncestors } from '@floating-ui/dom';

/** 화면 배치가 바뀐 것을 겹침 층에 바로 알리는 이벤트(watchLayout이 기다리지 않고 즉시 다시 잰다) */
export const RELAYOUT = 'wse-relayout';

/** 화면이 .wse-page 레이아웃 크기 대비 몇 배로 그려지는지(Design 확대·축소, 1 = 100%) */
export const scaleOf = (el: Element) => (el as HTMLElement).offsetWidth ? el.getBoundingClientRect().width / (el as HTMLElement).offsetWidth : 1;

export const wseIndex = (el: Element) => Number(el.getAttribute('data-wse'));

export const node = (index?: number) => `[data-wse="${index}"]:not([data-wse-frame] *)`;

export function pick(t: Element) {
	let hit = t.closest('[data-wse]');
	for (let f = t.closest('[data-wse-frame]'); f; f = f.parentElement?.closest('[data-wse-frame]') ?? null) {
		hit = f;
	}
	return hit;
}

export function relRect(el: Element, page: HTMLElement) {
	const a = el.getBoundingClientRect(), b = page.getBoundingClientRect(), scale = scaleOf(page);
	return { left: (a.left - b.left) / scale + page.scrollLeft, top: (a.top - b.top) / scale + page.scrollTop, width: a.width / scale, height: a.height / scale };
}

export interface Rect { left: number; top: number; width: number; height: number }
export interface ClipBox { left: number; top: number; right: number; bottom: number; originLeft: number; originTop: number }

function clipBoxOf(el: Element, page: HTMLElement, cache?: Map<Element, ClipBox | null>): ClipBox | null {
	const hit = cache?.get(el);
	if (hit !== undefined) { return hit; }
	let box: ClipBox | null;
	if (el === page) {
		const b = page.getBoundingClientRect();
		const left = b.left + page.clientLeft, top = b.top + page.clientTop, zoom = scaleOf(page);
		box = { left, top, right: left + page.clientWidth * zoom, bottom: top + page.clientHeight * zoom, originLeft: b.left, originTop: b.top };
	} else {
		const parent = el.parentElement ? clipBoxOf(el.parentElement, page, cache) : null;
		if (!parent) {
			box = null;
		} else if (getComputedStyle(el).overflow !== 'visible') {
			const r = el.getBoundingClientRect();
			const left = Math.max(parent.left, r.left), top = Math.max(parent.top, r.top);
			const right = Math.min(parent.right, r.right), bottom = Math.min(parent.bottom, r.bottom);
			box = right > left && bottom > top ? { left, top, right, bottom, originLeft: parent.originLeft, originTop: parent.originTop } : null;
		} else {
			box = parent;
		}
	}
	cache?.set(el, box);
	return box;
}

export function visibleRect(el: Element, page: HTMLElement, cache?: Map<Element, ClipBox | null>): Rect | undefined {
	if (!el.getClientRects().length) {
		return undefined;
	}
	const clip = clipBoxOf(el.parentElement && page.contains(el.parentElement) ? el.parentElement : page, page, cache);
	if (!clip) {
		return undefined;
	}
	const a = el.getBoundingClientRect();
	const left = Math.max(a.left, clip.left), top = Math.max(a.top, clip.top);
	const right = Math.min(Math.max(a.right, a.left + 6), clip.right), bottom = Math.min(Math.max(a.bottom, a.top + 6), clip.bottom);
	if (right <= left || bottom <= top) {
		return undefined;
	}
	return { left: left - clip.originLeft, top: top - clip.originTop, width: right - left, height: bottom - top };
}

export function watchLayout<T>(elements: Element[], page: HTMLElement, measure: () => T, onChange: (value: T) => void): () => void {
	// JSON.stringify는 ''를 돌려주지 않아 첫 측정은 항상 반영된다
	let pending = 0, last: string | undefined = '';
	const update = () => {
		if (!page.getClientRects().length) { return; }
		const next = measure();
		const key = JSON.stringify(next);
		if (key !== last) {
			last = key;
			onChange(next);
		}
	};
	const schedule = () => { pending ||= requestAnimationFrame(() => { pending = 0; update(); }); };
	page.addEventListener(RELAYOUT, update);
	// 같은 page와 스크롤 조상에 요소 수만큼 observer/listener를 붙이지 않는다.
	// 스크롤 조상은 부모부터 찾으므로 부모가 같은 형제는 한 번만 찾는다(배지는 문서가 바뀔 때마다 요소 수백~수천 개를 다시 감시한다)
	const byParent = new Map<Node | null, Element>();
	[...elements, page].forEach(el => { if (!byParent.has(el.parentNode)) { byParent.set(el.parentNode, el); } });
	const ancestors = new Set([...byParent.values()].flatMap(el => getOverflowAncestors(el)));
	ancestors.forEach(el => { el.addEventListener('scroll', schedule, { passive: true }); el.addEventListener('resize', schedule); });
	const observer = new ResizeObserver(schedule);
	new Set([...elements, page]).forEach(el => observer.observe(el));
	// 요소별 위치 이동 감시는 유지한다(크기가 그대로인 레이아웃 이동 포함).
	const stops = elements.map(el => autoUpdate(el, page, schedule, { ancestorScroll: false, ancestorResize: false, elementResize: false }));
	update();
	return () => {
		stops.forEach(stop => stop());
		observer.disconnect();
		ancestors.forEach(el => { el.removeEventListener('scroll', schedule); el.removeEventListener('resize', schedule); });
		cancelAnimationFrame(pending);
		page.removeEventListener(RELAYOUT, update);
	};
}
