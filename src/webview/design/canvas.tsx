import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { autoUpdate } from '@floating-ui/dom';
import type { ComponentDef } from '../../core/protocol';
import { defOf, localName, nodeAt, type XmlNode } from '../../core/xmlModel';
import { setStyle } from '../../core/style';
import { EditBox } from '../ui/editBox';
import { render, textTarget, type TextTarget } from './renderers';
import { classLabel, REF_MIME } from '../ui/tree';
import canvasCss from './canvas.css';

let renders = 0;

export function Canvas({ body, defs, sheets, selected, extra = [], onSelect, onEditText, onEditAttr, onOpenFrame, onOpenEditor, onBindRef, onContextMenu }: {
	body: XmlNode; defs: ComponentDef[]; sheets?: string[]; selected?: number;
	extra?: number[];
	onSelect(i: number, additive?: boolean): void; onEditText(target: TextTarget, value: string): void;
	onEditAttr(name: string, value: string | undefined): void; onOpenFrame(index: number): void;
	onOpenEditor?(index: number): boolean;
	onBindRef?(index: number, value: string): void;
	onContextMenu?(index: number, x: number, y: number): void;
}) {
	const host = useRef<HTMLDivElement>(null);
	const page = useRef<HTMLDivElement>(null);
	const [shadow, setShadow] = useState<ShadowRoot>();
	const [hover, setHover] = useState<number>();
	const [editing, setEditing] = useState<{ target: TextTarget; rect: CSSProperties }>();
	const colDrag = useRef<{ index: number; col?: HTMLElement; table?: HTMLElement; tableWidth?: number; startX: number; width: number; scale: number }>(undefined);
	const dragWidth = (d: NonNullable<typeof colDrag.current>, x: number) => Math.max(20, Math.round(d.width + (x - d.startX) / d.scale));
	useEffect(() => setShadow(host.current!.shadowRoot ?? host.current!.attachShadow({ mode: 'open' })), []);
	// CSP상 <style> 태그는 막혀 있어서 생성한 스타일시트(adoptedStyleSheets)로 붙인다.
	useEffect(() => {
		if (shadow) {
			shadow.adoptedStyleSheets = [...sheets ?? [], canvasCss].map(text => {
				const sheet = new CSSStyleSheet();
				sheet.replaceSync(text);
				return sheet;
			});
		}
	}, [shadow, sheets]);
	const [tree, generation] = useMemo(() => [render(body, defs), ++renders], [body, defs]);
	useEffect(() => {
		page.current?.querySelector(node(selected))?.scrollIntoView({ block: 'nearest' });
	}, [selected, tree, shadow]);
	useEffect(() => {
		const frame = requestAnimationFrame(() => page.current?.querySelectorAll<HTMLTableSectionElement>('.w2grid thead').forEach(head => {
			const rows = [...head.rows];
			if (rows.length < 2) { return; }
			rows.forEach(r => r.style.height = '');
			const tallest = Math.max(...rows.map(r => r.getBoundingClientRect().height));
			rows.forEach(r => r.style.height = `${tallest}px`);
		}));
		return () => cancelAnimationFrame(frame);
	}, [tree, shadow, sheets]);
	const target = (e: { target: EventTarget }) => pick(e.target as Element);
	const selectedNode = nodeAt(body, selected);
	const commitStyle = (props: Record<string, string>) => onEditAttr('style', setStyle(selectedNode?.attrs.style, props));
	return (
		<div ref={host} style={{ height: '100%' }}>
			{shadow && createPortal(<div className="wse-view">
				<div ref={page} className="wse-page"
					onClick={e => {
						const el = target(e);
						if (el) {
							onSelect(wseIndex(el), e.ctrlKey || e.metaKey);
						}
					}}
					onPointerDown={e => {
						const c = (e.target as Element).closest?.<HTMLTableCellElement>('[data-wse-resize]');
						if (!c || e.button !== 0 || e.clientX < c.getBoundingClientRect().right - 5) { return; }
						e.preventDefault();
						e.stopPropagation();
						const table = c.closest('table') ?? undefined;
						// 칸 순서(cellIndex)는 병합·번호 칸 때문에 열 순서와 다를 수 있어 렌더러가 적어 둔 <col> 순서를 쓴다
						const col = table?.querySelector('colgroup')?.children[Number(c.getAttribute('data-wse-resize'))] as HTMLElement | undefined;
						// 기준은 화면 폭이 아니라 <col>의 width(=XML 값). autoFit(100%)이면 화면 폭이 비율로 늘어나 있어서
						// 화면 폭을 넣으면 그 열만 몇 배로 커진다 → 마우스 이동량도 같은 비율(scale)로 나눠 XML 단위로 바꾼다
						const rendered = c.getBoundingClientRect().width;
						const width = parseFloat(col?.style.width ?? '') || rendered;
						const tableWidth = table?.style.width.endsWith('px') ? parseFloat(table.style.width) : undefined;
						colDrag.current = { index: wseIndex(c), col, table, tableWidth, startX: e.clientX, width, scale: rendered / width || 1 };
						try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트(테스트) 등 활성 포인터가 없으면 캡처 없이 진행 */ }
					}}
					onPointerMove={e => {
						const d = colDrag.current;
						if (d?.col) {
							const w = dragWidth(d, e.clientX);
							d.col.style.width = `${w}px`;
							if (d.table && d.tableWidth !== undefined) { d.table.style.width = `${d.tableWidth + w - d.width}px`; }
						}
					}}
					onPointerUp={e => {
						const d = colDrag.current;
						colDrag.current = undefined;
						const width = d && dragWidth(d, e.clientX);
						if (d && width !== Math.round(d.width)) {
							onSelect(d.index);
							onEditAttr('width', String(width));
						}
					}}
					onContextMenu={e => {
						const el = target(e);
						if (el && onContextMenu) {
							e.preventDefault();
							onContextMenu(wseIndex(el), e.clientX, e.clientY);
						}
					}}
					onDoubleClick={e => {
						const el = target(e);
						if (el?.hasAttribute('data-wse-frame')) {
							onOpenFrame(wseIndex(el));
							return;
						}
						if (el && onOpenEditor?.(wseIndex(el))) {
							return;
						}
						const n = el && nodeAt(body, wseIndex(el));
						const t = n && textTarget(n, defOf(n, defs));
						const p = page.current;
						if (el && t && p) {
							const r = relRect(el, p);
							const width = Math.max(r.width, 160), height = Math.max(r.height, 18 * 3 + 8);
							const left = Math.max(p.scrollLeft, Math.min(r.left, p.scrollLeft + p.clientWidth - width));
							const top = Math.max(p.scrollTop, Math.min(r.top, p.scrollTop + p.clientHeight - height));
							setEditing({ target: t, rect: { left, top, width, height } });
						}
					}}
					onDragOver={e => {
						const el = e.dataTransfer.types.includes(REF_MIME) ? target(e) : null;
						if (el && !el.hasAttribute('data-wse-frame') && wseIndex(el) !== body.index) {
							e.preventDefault();
							e.dataTransfer.dropEffect = 'link';
							setHover(wseIndex(el));
						}
					}}
					onDrop={e => {
						const el = target(e);
						const value = e.dataTransfer.getData(REF_MIME);
						if (el && value) {
							e.preventDefault();
							onBindRef?.(wseIndex(el), value);
						}
					}}
					onMouseOver={e => { const el = target(e); setHover(el ? wseIndex(el) : undefined); }}
					onMouseLeave={() => setHover(undefined)}>
					<Boundary key={generation}>{tree}</Boundary>
					{editing && (
						<EditBox key={editing.target.index} style={editing.rect} value={editing.target.value ?? ''}
							onCommit={v => onEditText(editing.target, v)} onClose={() => setEditing(undefined)} />
					)}
				</div>
				<div className="wse-overlay">
					<Badges page={page} body={body} tree={tree} />
					<Frame page={page} index={hover !== selected ? hover : undefined} kind="hover" tree={tree} />
					{extra.map(i => <Frame key={i} page={page} index={i} kind="selected extra" tree={tree} />)}
					<Frame page={page} index={selected} kind="selected" tree={tree} onResize={commitStyle}
						label={selectedNode && label(selectedNode, defOf(selectedNode, defs))} />
				</div>
			</div>, shadow)}
		</div>
	);
}

function Badges({ page, body, tree }: { page: RefObject<HTMLDivElement | null>; body: XmlNode; tree: ReactNode }) {
	const marked = useMemo(() => {
		const out: { index: number; bind: boolean; event: boolean }[] = [];
		const walk = (n: XmlNode) => {
			const bind = !!n.attrs.ref, event = Object.keys(n.attrs).some(k => k.startsWith('ev:'));
			if (bind || event) { out.push({ index: n.index, bind, event }); }
			n.children.forEach(walk);
		};
		walk(body);
		return out;
	}, [body]);
	const [rects, setRects] = useState<{ index: number; bind: boolean; event: boolean; left: number; top: number }[]>([]);
	// useLayoutEffect면 자식인 이 컴포넌트가 부모 page ref가 붙기 전에 돌아 루프가 안 시작된다(문서가 바뀌어야 나타나던 원인) → 커밋 후 useEffect
	useEffect(() => {
		const p = page.current;
		if (!p || !marked.length) {
			setRects([]);
			return;
		}
		const measure = () => marked.flatMap(m => {
			const el = p.querySelector(node(m.index));
			const r = el && visibleRect(el, p);
			return r ? [{ ...m, left: r.left, top: r.top }] : [];
		});
		return watchLayout(marked.flatMap(m => p.querySelector(node(m.index)) ?? []), p, measure, setRects);
	}, [page, marked, tree]);
	return <>{rects.map(r => (
		<div key={r.index} className="wse-badges" style={{ left: r.left, top: r.top }}>
			{r.bind && <span className="bind" title="ref 바인딩 있음" />}
			{r.event && <span className="event" title="이벤트 핸들러 있음" />}
		</div>
	))}</>;
}

function watchLayout<T>(elements: Element[], page: HTMLElement, measure: () => T, onChange: (value: T) => void): () => void {
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
	const stops = elements.map(el => autoUpdate(el, page, schedule));
	update();
	return () => { stops.forEach(stop => stop()); cancelAnimationFrame(pending); };
}

function Frame({ page, index, kind, tree, onResize, label }: {
	page: RefObject<HTMLDivElement | null>; index?: number; kind: string; tree: ReactNode; onResize?(props: Record<string, string>): void; label?: string;
}) {
	const [rect, setRect] = useState<Rect>();
	const [target, setTarget] = useState<HTMLElement>();
	useLayoutEffect(() => {
		const p = page.current;
		const el = index === undefined || Number.isNaN(index) ? undefined : p?.querySelector(node(index));
		setTarget(el as HTMLElement | undefined);
		if (!p || !el) {
			setRect(undefined);
			return;
		}
		return watchLayout([el], p, () => visibleRect(el, p), setRect);
	}, [page, index, tree]);
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

const label = (n: XmlNode, def?: ComponentDef) => [def?.display || localName(n.tag), n.attrs.id && `#${n.attrs.id}`, classLabel(n)].filter(Boolean).join(' ');

function Chip({ page, rect, text }: { page: RefObject<HTMLDivElement | null>; rect: Rect; text: string }) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ left: number; top: number }>();
	const [faded, setFaded] = useState(false);
	useLayoutEffect(() => {
		const el = ref.current, p = page.current;
		if (!el || !p) { return; }
		const h = el.offsetHeight, gap = 3;
		const above = rect.top - gap - h, below = rect.top + rect.height + gap;
		const top = above >= 0 ? above : below + h <= p.clientHeight ? below : rect.top;
		setPos({ left: Math.max(0, Math.min(rect.left, p.clientWidth - el.offsetWidth)), top });
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
	const cs = getComputedStyle(el);
	const s = { x: e.clientX, y: e.clientY, width: parseFloat(cs.width), height: parseFloat(cs.height) };
	let next: Record<string, number> | undefined;
	const move = (ev: PointerEvent) => {
		const dx = ev.clientX - s.x, dy = ev.clientY - s.y;
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
		if (next) {
			commit(Object.fromEntries(Object.entries(next).map(([k, v]) => [k, `${Math.round(v)}px`])));
		}
	};
	window.addEventListener('pointermove', move);
	window.addEventListener('pointerup', up);
}

class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
	state: { error?: Error } = {};
	static getDerivedStateFromError(error: Error) {
		return { error };
	}
	render() {
		return this.state.error ? <p className="wse-error">디자인을 그리지 못함: {this.state.error.message}</p> : this.props.children;
	}
}

const wseIndex = (el: Element) => Number(el.getAttribute('data-wse'));

const node = (index?: number) => `[data-wse="${index}"]:not([data-wse-frame] *)`;

function pick(t: Element) {
	let hit = t.closest('[data-wse]');
	for (let f = t.closest('[data-wse-frame]'); f; f = f.parentElement?.closest('[data-wse-frame]') ?? null) {
		hit = f;
	}
	return hit;
}

function relRect(el: Element, page: HTMLElement) {
	const a = el.getBoundingClientRect(), b = page.getBoundingClientRect();
	return { left: a.left - b.left + page.scrollLeft, top: a.top - b.top + page.scrollTop, width: a.width, height: a.height };
}

interface Rect { left: number; top: number; width: number; height: number }

function visibleRect(el: Element, page: HTMLElement): Rect | undefined {
	if (!el.getClientRects().length) {
		return undefined;
	}
	const a = el.getBoundingClientRect();
	let left = a.left, top = a.top, right = Math.max(a.right, a.left + 6), bottom = Math.max(a.bottom, a.top + 6);
	const clip = (c: { left: number; top: number; right: number; bottom: number }) => {
		left = Math.max(left, c.left); top = Math.max(top, c.top);
		right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
	};
	for (let p = el.parentElement; p && p !== page; p = p.parentElement) {
		if (getComputedStyle(p).overflow !== 'visible') {
			clip(p.getBoundingClientRect());
		}
	}
	const b = page.getBoundingClientRect();
	const x = b.left + page.clientLeft, y = b.top + page.clientTop;
	clip({ left: x, top: y, right: x + page.clientWidth, bottom: y + page.clientHeight });
	if (right <= left || bottom <= top) {
		return undefined;
	}
	return { left: left - b.left, top: top - b.top, width: right - left, height: bottom - top };
}
