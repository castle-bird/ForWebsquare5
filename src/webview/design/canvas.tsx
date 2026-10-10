import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { autoUpdate, getOverflowAncestors } from '@floating-ui/dom';
import type { ComponentDef, CssRuleSource } from '../../core/protocol';
import { defOf, EV, localName, nodeAt, pathTo, type XmlNode } from '../../core/xmlModel';
import { setStyle } from '../../core/style';
import { EditBox } from '../ui/editBox';
import { cellForm, FORM_HEIGHT, FORM_WIDTH, formAttrs, FormFields, FormHeader, type Form } from './cellForm';
import { matchingCssRules } from './cssRules';
import { distanceLines, type DistanceLine } from './distance';
import { render, textTarget, outlineIcon, type TextTarget } from './renderers';
import { classLabel, REF_MIME, setDragGhost } from '../ui/tree';
import { PALETTE_MIME, readPaletteDrag, type PaletteDrag } from '../ui/palette';
import { componentDropPosition, findPaletteDef, insertPositions } from '../../core/palette';
import type { InsertPosition } from '../../core/paste';
import canvasCss from './canvas.css';
import { DataCollection } from './chart';

const MOVE_MIME = 'application/x-websquare5-canvas-move';
let renders = 0;

export function Canvas({ body, dataCollection, defs, sheets, styleRules, selected, extra = [], onSelect, onSelectCells, onEditText, onEditAttr, onOpenFrame, onOpenEditor, onBindRef, onContextMenu, onInsertComponent, onMove, idChoices }: {
	body: XmlNode; dataCollection?: XmlNode; defs: ComponentDef[]; sheets?: string[]; styleRules?: CssRuleSource[]; selected?: number;
	extra?: number[];
	onSelect(i: number, additive?: boolean): void;
	/** 그리드 칸을 끌어 여러 칸 고름: primary는 누른 칸 */
	onSelectCells?(primary: number, cells: number[]): void; onEditText(target: TextTarget, value: string, also?: { name: string; value?: string }[]): void;
	onEditAttr(name: string, value: string | undefined): void; onOpenFrame(index: number): void;
	onOpenEditor?(index: number): boolean;
	onBindRef?(index: number, value: string): void;
	onMove?(dragged: number, target: number, position: InsertPosition): void;
	onInsertComponent?(drag: PaletteDrag, index: number, position: InsertPosition): void;
	onContextMenu?(index: number, x: number, y: number, rules: number[]): void;
	/** 이 노드의 id로 고를 값(바인딩된 그리드 본문 셀 → dataList 컬럼 id) */
	idChoices?(index: number): string[] | undefined;
}) {
	const host = useRef<HTMLDivElement>(null);
	const page = useRef<HTMLDivElement>(null);
	const [shadow, setShadow] = useState<ShadowRoot>();
	const [hover, setHover] = useState<number>();
	const [measuring, setMeasuring] = useState(false);
	useEffect(() => {
		const key = (e: KeyboardEvent) => { if (e.key === 'Alt') { setMeasuring(e.type === 'keydown'); } };
		const clear = () => { setMeasuring(false); setHover(undefined); };
		window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', clear);
		return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', clear); };
	}, []);
	// 이동 손잡이를 보일 그리드: 마우스가 그리드 위에 있었거나(손잡이로 가는 동안 잠깐 벗어나도 유지) 고른 칸이 그리드 안
	const [hoverGrid, setHoverGrid] = useState<number>();
	const hoverGridTimer = useRef<number>(undefined);
	const keepHoverGrid = (grid: number | undefined) => {
		clearTimeout(hoverGridTimer.current);
		if (grid !== undefined) { setHoverGrid(grid); } else { hoverGridTimer.current = window.setTimeout(() => setHoverGrid(undefined), 400); }
	};
	const [drop, setDrop] = useState<{ index: number; position: InsertPosition; side: string }>();
	const [dragging, setDragging] = useState<number[]>([]);
	const moving = useRef<{ index: number; body: XmlNode }>(undefined);
	// form: 그리드 칸이면 문구 아래 입력(헤더: 너비·높이, 본문: 자주 고치는 속성). draft: 그 입력 값
	const [editing, setEditing] = useState<{ target: TextTarget; rect: CSSProperties; form?: Form }>();
	const [draft, setDraft] = useState<Record<string, string>>({});
	const changes = editing?.form ? formAttrs(editing.form, draft) : [];
	const columnResize = useColumnResize((index, width) => { onSelect(index); onEditAttr('width', String(width)); });
	const cellRange = useCellRange(body, page, onSelectCells);
	// 끌기·놓기 단위(그리드 안 칸은 그리드 전체)를 문서당 한 번만 찾는다.
	const units = useMemo(() => {
		const out = new Map<number, XmlNode>();
		const walk = (n: XmlNode, grid?: XmlNode) => {
			grid ??= localName(n.tag) === 'gridView' ? n : undefined;
			out.set(n.index, grid ?? n);
			n.children.forEach(c => walk(c, grid));
		};
		walk(body);
		return out;
	}, [body]);
	const unitAt = (index: number) => units.get(index);
	const gridOf = (index: number | undefined) => {
		const unit = index === undefined ? undefined : unitAt(index);
		return unit && localName(unit.tag) === 'gridView' ? unit : undefined;
	};
	/** 컴포넌트 옮기기 시작(캔버스 끌기·그리드 손잡이 공통) */
	const startMove = (e: ReactDragEvent, n: XmlNode) => {
		if (n.index !== selected && !extra.includes(n.index)) { onSelect(n.index); }
		moving.current = { index: n.index, body };
		const group = n.index === selected || extra.includes(n.index) ? [selected, ...extra].filter((i): i is number => i !== undefined) : [n.index];
		setDragging(group);
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData(MOVE_MIME, String(n.index));
		setDragGhost(e.dataTransfer, outlineIcon(n, defs), `${moveName(n, defs)}${group.length > 1 ? ` 외 ${group.length - 1}개` : ''}`);
	};
	const handleGrid = gridOf(hoverGrid) ?? gridOf(selected);
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
	// 고른 것이 바뀔 때만 보이게 스크롤(새로 넣은 노드는 다음 문서에서 나타날 때). 속성만 바꾼 새 문서마다 하면 그리드 가로 스크롤이 튄다
	const scrolledTo = useRef<number>(undefined);
	useEffect(() => {
		if (selected === scrolledTo.current) { return; }
		const element = page.current?.querySelector(node(selected));
		if (element) {
			element.scrollIntoView({ block: 'nearest' });
			scrolledTo.current = selected;
		}
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
	/** 화면 배치 방향으로 판정하되 XML에는 기존 before/after/inside를 보낸다. */
	const dropAt = (e: { target: EventTarget; clientX: number; clientY: number }) => {
		const hit = target(e);
		const node = unitAt(hit ? wseIndex(hit) : body.index);
		if (!node) { return undefined; }
		const element = page.current?.querySelector<HTMLElement>(`[data-wse="${node.index}"]`);
		const rect = (element ?? page.current)?.getBoundingClientRect();
		if (!rect) { return undefined; }
		const { horizontal, reverse } = element ? dropAxis(element) : { horizontal: false, reverse: false };
		const ratio = horizontal ? (e.clientX - rect.left) / (rect.width || 1) : (e.clientY - rect.top) / (rect.height || 1);
		const position = componentDropPosition(node, reverse ? 1 - ratio : ratio);
		const leading = (position === 'before') !== reverse;
		const side = position === 'inside' ? 'inside' : horizontal ? leading ? 'left' : 'right' : leading ? 'top' : 'bottom';
		return insertPositions(node).includes(position) ? { index: node.index, position, side } : undefined;
	};
	useEffect(() => {
		moving.current = undefined;
		setDragging([]);
		setDrop(undefined);
		page.current?.querySelectorAll<HTMLElement>('[data-wse]').forEach(el => {
			const index = wseIndex(el);
			el.draggable = !!onMove && index !== body.index && unitAt(index)?.index === index;
		});
	}, [body, tree, shadow, onMove]);
	const moveDrop = (e: { target: EventTarget; clientX: number; clientY: number }) => {
		const source = moving.current;
		const at = dropAt(e);
		if (!source || source.body !== body || !at) { return undefined; }
		const dragged = nodeAt(body, source.index), target = nodeAt(body, at.index);
		if (!dragged || !target || target.start >= dragged.start && target.end <= dragged.end
			|| extra.some(i => { const n = nodeAt(body, i); return n && target.start >= n.start && target.end <= n.end; })) { return undefined; }
		return at;
	};
	useEffect(() => {
		const clear = () => { moving.current = undefined; setDragging([]); setDrop(undefined); };
		window.addEventListener('dragend', clear);
		return () => window.removeEventListener('dragend', clear);
	}, []);
	const selectedNode = nodeAt(body, selected);
	const commitStyle = (props: Record<string, string>) => onEditAttr('style', setStyle(selectedNode?.attrs.style, props));
	return (
		<div className="canvas-host" ref={host} style={{ height: '100%' }}>
			{shadow && createPortal(<div className="wse-view">
				<div ref={page} className="wse-page"
					onClick={e => {
						const el = target(e);
						if (el && !cellRange.takeClick()) {
							onSelect(wseIndex(el), e.ctrlKey || e.metaKey);
						}
					}}
					// 열 너비 끌기(머리 칸 오른쪽 끝)가 먼저, 아니면 칸 범위 고르기
					onPointerDown={e => { columnResize.onPointerDown(e); cellRange.onPointerDown(e); }}
					onPointerMove={e => { columnResize.onPointerMove(e); cellRange.onPointerMove(e); }}
					onPointerUp={e => { columnResize.onPointerUp(e); cellRange.onPointerUp(); }}
					onContextMenu={e => {
						const el = target(e);
						if (el && onContextMenu) {
							e.preventDefault();
							onContextMenu(wseIndex(el), e.clientX, e.clientY, matchingCssRules(el, styleRules ?? []));
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
						// 그리드 칸(헤더·본문·footer·subTotal 모두): 문구 아래 자주 고치는 속성. 문구 칸이 없는 inputType(checkbox 등)이어도 연다
						const cellPath = n && pathTo(body, n.index);
						const gridCell = !!n && localName(n.tag) === 'column' && !!cellPath?.some(a => localName(a.tag) === 'gridView');
						const t = n && (textTarget(n, defOf(n, defs)) ?? (gridCell ? { index: n.index, attr: 'value', value: n.attrs.value } : undefined));
						const p = page.current;
						if (el && n && t && p) {
							const r = relRect(el, p);
							const form = gridCell ? cellForm(n, defOf(n, defs), r, idChoices?.(n.index), cellPath ?? []) : undefined;
							const width = form ? Math.min(Math.max(r.width, FORM_WIDTH.min), FORM_WIDTH.max) : Math.max(r.width, 160), height = Math.max(r.height, 18 * 3 + 8);
							const left = Math.max(p.scrollLeft, Math.min(r.left, p.scrollLeft + p.clientWidth - width));
							// 아래 입력 줄까지 보이게
							const top = Math.max(p.scrollTop, Math.min(r.top, p.scrollTop + p.clientHeight - height - (form ? FORM_HEIGHT : 0)));
							// 더블클릭이 고른 글자 선택이 새로 뜬 입력 줄까지 번져 파랗게 칠해지지 않게
							getSelection()?.removeAllRanges();
							setDraft(form?.values ?? {});
							setEditing({ target: t, rect: { left, top, width, height }, form });
						}
					}}
					onDragStart={e => {
						const el = target(e);
						const n = el && unitAt(wseIndex(el));
						if (!onMove || !n || n.index === body.index || editing || cellRange.active()) { e.preventDefault(); return; }
						startMove(e, n);
					}}
					onDragOver={e => {
						if (e.dataTransfer.types.includes(MOVE_MIME)) {
							const next = moveDrop(e); setDrop(next);
							if (next) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
							return;
						}
						if (onInsertComponent && e.dataTransfer.types.includes(PALETTE_MIME)) {
							const next = dropAt(e);
							setDrop(next);
							if (next) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
							return;
						}
						const el = e.dataTransfer.types.includes(REF_MIME) ? target(e) : null;
						if (el && !el.hasAttribute('data-wse-frame') && wseIndex(el) !== body.index) {
							e.preventDefault();
							e.dataTransfer.dropEffect = 'link';
							setHover(wseIndex(el));
						}
					}}
					onDragLeave={e => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) { setDrop(undefined); } }}
					onDrop={e => {
						setDrop(undefined);
						setDragging([]);
						if (e.dataTransfer.types.includes(MOVE_MIME)) {
							e.preventDefault();
							const at = moveDrop(e), source = moving.current;
							moving.current = undefined;
							if (at && source) { onMove?.(source.index, at.index, at.position); }
							return;
						}
						if (e.dataTransfer.types.includes(PALETTE_MIME)) {
							e.preventDefault();
							const drag = readPaletteDrag(e.dataTransfer), at = dropAt(e);
							if (drag && at && findPaletteDef(defs, drag.component)) {
								onInsertComponent?.(drag, at.index, at.position);
							}
							return;
						}
						const el = target(e);
						const value = e.dataTransfer.getData(REF_MIME);
						if (el && value) {
							e.preventDefault();
							onBindRef?.(wseIndex(el), value);
						}
					}}
					onMouseOver={e => { setMeasuring(e.altKey); const el = target(e); setHover(el ? wseIndex(el) : undefined); keepHoverGrid(el ? gridOf(wseIndex(el))?.index : undefined); }}
					onMouseLeave={() => { setHover(undefined); keepHoverGrid(undefined); }}>
					<Boundary generation={generation}><DataCollection.Provider value={dataCollection}>{tree}</DataCollection.Provider></Boundary>
					{editing && (
						<EditBox key={editing.target.index} style={editing.rect} value={editing.target.value ?? ''}
							header={editing.form && <FormHeader form={editing.form} />}
							footer={editing.form && <FormFields form={editing.form} values={draft} onChange={setDraft} />}
							status={changes.length > 0 && `바꾼 속성 ${changes.length}`}
							changed={changes.length > 0}
							onCommit={v => onEditText(editing.target, v, editing.form && formAttrs(editing.form, draft))} onClose={() => setEditing(undefined)} />
					)}
				</div>
				{/* 글자 편집 중에는 선택 테두리·손잡이·표시 점이 편집 상자를 덮지 않게 숨긴다(겹침 층이 페이지 위라 z-index로는 못 내림) */}
				<div className="wse-overlay" hidden={!!editing}>
					<Badges page={page} body={body} tree={tree} />
					{!drop && !dragging.length && <>
						<HoverSpacing page={page} index={hover} tree={tree} sheets={sheets} />
						<Frame page={page} index={hover !== selected ? hover : undefined} kind="hover" tree={tree} />
					</>}
					{!dragging.length && <>
						{extra.map(i => <Frame key={i} page={page} index={i} kind="selected extra" tree={tree} />)}
						<Frame page={page} index={selected} kind="selected" tree={tree} onResize={commitStyle}
							label={!measuring && !drop && selectedNode ? label(selectedNode, defOf(selectedNode, defs)) : undefined} />
					</>}
					{drop && <Frame page={page} index={drop.index} kind={`drop ${drop.position} ${drop.side}`} tree={tree} />}
					{handleGrid && onMove && <GridHandle page={page} index={handleGrid.index} tree={tree} onEnter={() => keepHoverGrid(handleGrid.index)}
						onSelect={() => onSelect(handleGrid.index)} onDragStart={e => startMove(e, handleGrid)} />}
					{!drop && !dragging.length && measuring && hover !== undefined && hover !== selected && !extra.includes(hover) && <Distances page={page} from={selected} extra={extra} to={hover} tree={tree} sheets={sheets} />}
				</div>
			</div>, shadow)}
		</div>
	);
}

/** flex 방향을 우선하고, 그 밖에는 실제 이웃 배치(같은 줄/열)를 본다. */
function dropAxis(el: HTMLElement): { horizontal: boolean; reverse: boolean } {
	const parent = el.parentElement, style = getComputedStyle(el), layout = parent && getComputedStyle(parent);
	if (layout?.display.includes('flex')) {
		const horizontal = layout.flexDirection.startsWith('row');
		return { horizontal, reverse: layout.flexDirection.endsWith('reverse') !== (horizontal && layout.direction === 'rtl') };
	}
	const rect = el.getBoundingClientRect();
	for (const [neighbor, next] of [[el.nextElementSibling, true], [el.previousElementSibling, false]] as const) {
		if (!neighbor?.hasAttribute('data-wse')) { continue; }
		const other = neighbor.getBoundingClientRect();
		if (!other.width || !other.height) { continue; }
		if (Math.min(rect.bottom, other.bottom) > Math.max(rect.top, other.top) && Math.abs(other.left - rect.left) > 1) {
			return { horizontal: true, reverse: (other.left < rect.left) === next };
		}
		if (Math.min(rect.right, other.right) > Math.max(rect.left, other.left) && Math.abs(other.top - rect.top) > 1) {
			return { horizontal: false, reverse: (other.top < rect.top) === next };
		}
	}
	const horizontal = style.display.startsWith('inline') || style.display === 'table-cell';
	return { horizontal, reverse: horizontal && style.direction === 'rtl' };
}

const moveName = (n: XmlNode, defs: ComponentDef[]) => {
	const text = textTarget(n, defOf(n, defs))?.value?.trim();
	return [text, n.attrs.id ? `#${n.attrs.id}` : defOf(n, defs)?.display ?? localName(n.tag)].filter(Boolean).join(' ');
};

/**
 * 그리드 열 너비: 머리 칸 오른쪽 끝 5px을 끌면 그 <col>을 바로 넓히고, 놓으면 width 속성으로 반영(onResized).
 * 기준은 화면 폭이 아니라 <col>의 width(=XML 값). autoFit(100%)이면 화면 폭이 비율로 늘어나 있어서
 * 화면 폭을 넣으면 그 열만 몇 배로 커진다 → 마우스 이동량도 같은 비율(scale)로 나눠 XML 단위로 바꾼다
 */
/**
 * 그리드 칸을 누른 채 끌면 누른 칸부터 지금 칸까지 직사각형 안의 칸을 모두 고른다(엑셀처럼, 같은 header·gBody 등 안에서만).
 * 그리드 옮기기는 이동 손잡이(GridHandle)로만. 끌어서 고른 뒤 따라오는 click은 선택을 덮지 않게 무시
 */
function useCellRange(body: XmlNode, page: RefObject<HTMLDivElement | null>, onSelectCells?: (primary: number, cells: number[]) => void) {
	/** scroller: 그리드 스크롤 칸(가장자리 밖으로 끌면 그쪽으로 굴린다), x·y: 마지막 포인터 자리 */
	const drag = useRef<{ anchor: number; owner: number; last: number; scroller?: HTMLElement; x: number; y: number; frame?: number }>(undefined);
	const swallowClick = useRef(false);
	const cellAt = (t: EventTarget) => {
		const el = pick(t as Element), path = el ? pathTo(body, wseIndex(el)) : undefined, grid = path?.find(n => localName(n.tag) === 'gridView');
		return path && grid && localName(path.at(-1)!.tag) === 'column' && path.length > 3 ? { path, grid } : undefined;
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
		const rect = (i: number) => page.current?.querySelector(`[data-wse="${i}"]`)?.getBoundingClientRect();
		const a = rect(d.anchor), b = rect(index), owner = nodeAt(body, d.owner);
		if (!a || !b || !owner) { return false; }
		const box = { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) };
		// 칸 가운데가 상자 안이면 고름(병합 칸처럼 여러 줄·칸을 차지해도). 스크롤에 가려진 칸도 좌표는 있다
		const cells = owner.children.flatMap(row => row.children).filter(c => localName(c.tag) === 'column').flatMap(c => {
			const r = rect(c.index), cx = r && (r.left + r.right) / 2, cy = r && (r.top + r.bottom) / 2;
			return r && cx! >= box.left && cx! <= box.right && cy! >= box.top && cy! <= box.bottom ? [c.index] : [];
		});
		onSelectCells!(d.anchor, cells);
		return true;
	};
	/** 포인터가 그리드 가장자리(EDGE px 안)나 밖이면 멀수록 빠르게 굴리고 새로 보인 칸까지 고른다. 안쪽으로 오면 멈춤 */
	const EDGE = 24;
	const autoScroll = () => {
		const d = drag.current, s = d?.scroller;
		if (!d || !s) { return; }
		const r = s.getBoundingClientRect();
		const speed = (before: number, after: number) => before > 0 ? -Math.min(16, Math.ceil(before / 5)) : after > 0 ? Math.min(16, Math.ceil(after / 5)) : 0;
		const dx = speed(r.left + EDGE - d.x, d.x - (r.left + s.clientLeft + s.clientWidth - EDGE));
		const dy = speed(r.top + EDGE - d.y, d.y - (r.top + s.clientTop + s.clientHeight - EDGE));
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
	return {
		/** 끌어서 고르는 중(그리드 옮기기 native drag를 막는다) */
		active: () => !!drag.current,
		/** 방금 끌어서 골랐으면 이번 click은 건너뛴다 */
		takeClick: () => { const swallow = swallowClick.current; swallowClick.current = false; return swallow; },
		onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
			swallowClick.current = false;
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
				try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 등 활성 포인터가 없으면 캡처 없이 */ }
				swallowClick.current = true;
			}
			if (swallowClick.current && d.frame === undefined) { autoScroll(); }
		},
		onPointerUp: stop,
	};
}

function useColumnResize(onResized: (index: number, width: number) => void) {
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
			try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트(테스트) 등 활성 포인터가 없으면 캡처 없이 진행 */ }
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
	};
}

function Badges({ page, body, tree }: { page: RefObject<HTMLDivElement | null>; body: XmlNode; tree: ReactNode }) {
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
	const [rects, setRects] = useState<{ index: number; bind: boolean; event: boolean; left: number; top: number }[]>([]);
	// useLayoutEffect면 자식인 이 컴포넌트가 부모 page ref가 붙기 전에 돌아 루프가 안 시작된다(문서가 바뀌어야 나타나던 원인) → 커밋 후 useEffect
	useEffect(() => {
		const p = page.current;
		if (!p || !marked.length) {
			setRects([]);
			return;
		}
		let stop: (() => void) | undefined;
		const sync = () => {
			stop?.();
			const elements = new Map([...p.querySelectorAll<HTMLElement>('[data-wse]:not([data-wse-frame] *)')].map(el => [wseIndex(el), el]));
			const targets = marked.flatMap(m => {
				const el = elements.get(m.index);
				return el ? [{ ...m, el }] : [];
			});
			const measure = () => targets.flatMap(({ el, ...m }) => {
				const r = visibleRect(el, p);
				return r ? [{ ...m, left: r.left, top: r.top }] : [];
			});
			stop = watchLayout(targets.map(t => t.el), p, measure, setRects);
		};
		// 탭 content처럼 DOM만 바뀔 때도 새 요소를 찾아 감시한다.
		const observer = new MutationObserver(sync);
		observer.observe(p, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-wse'] });
		sync();
		return () => { observer.disconnect(); stop?.(); };
	}, [page, marked, tree]);
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
	// 같은 page와 스크롤 조상에 요소 수만큼 observer/listener를 붙이지 않는다.
	const ancestors = new Set([...elements, page].flatMap(el => getOverflowAncestors(el)));
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
	};
}

function HoverSpacing({ page, index, tree, sheets }: {
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
			let left = b.left + p.clientLeft, top = b.top + p.clientTop, right = left + p.clientWidth, bottom = top + p.clientHeight;
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
function Distances({ page, from, extra, to, tree, sheets }: {
	page: RefObject<HTMLDivElement | null>; from?: number; extra: number[]; to?: number; tree: ReactNode; sheets?: string[];
}) {
	const [measurement, setMeasurement] = useState<{ lines: DistanceLine[]; width: number; height: number }>();
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
			return { lines: distanceLines(group, bounds(b)), width: p.clientWidth, height: p.clientHeight };
		}, setMeasurement);
	}, [page, from, extra, to, tree, sheets]);
	return measurement && <svg className="wse-measure" aria-hidden="true">{measurement.lines.map((line, i) => {
		const { x1, y1, x2, y2, horizontal, guide } = line;
		const text = `${Math.round(Math.abs(horizontal ? x2 - x1 : y2 - y1) * 10) / 10}px`, width = text.length * 7 + 8;
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

function Frame({ page, index, kind, tree, onResize, label }: {
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
 * 칸을 끄는 것은 칸 범위 고르기라서 그리드는 이걸로만 옮긴다. 캔버스는 Shadow DOM이라 codicon 대신 SVG
 */
function GridHandle({ page, index, tree, onDragStart, onSelect, onEnter }: {
	page: RefObject<HTMLDivElement | null>; index: number; tree: ReactNode; onDragStart(e: ReactDragEvent): void; onSelect(): void; onEnter(): void;
}) {
	const { rect } = useNodeRect(page, index, tree);
	if (!rect) {
		return null;
	}
	const size = 18, left = rect.left >= size ? rect.left - size : rect.left, top = rect.top >= size ? rect.top - size : rect.top;
	return <div className="wse-grid-handle" style={{ left, top, width: size, height: size }} draggable role="button" title="그리드 이동(끌기) · 선택(클릭)" aria-label="그리드 이동"
		onDragStart={onDragStart} onClick={onSelect} onMouseEnter={onEnter}>
		<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M8 1l2.5 2.5H8.75v3.75h3.75V5.5L15 8l-2.5 2.5V8.75H8.75v3.75h1.75L8 15l-2.5-2.5h1.75V8.75H3.5v1.75L1 8l2.5-2.5v1.75h3.75V3.5H5.5z" /></svg>
	</div>;
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

/**
 * 그리기 오류는 새로 그릴 때(generation) 지운다. key로 다시 만들면 캔버스 DOM이 통째로 새로 생겨
 * 속성 하나만 바꿔도 그리드 등 안쪽 스크롤 위치가 처음으로 돌아간다
 */
class Boundary extends Component<{ generation: number; children: ReactNode }, { error?: Error; generation: number }> {
	state: { error?: Error; generation: number } = { generation: this.props.generation };
	static getDerivedStateFromProps(props: { generation: number }, state: { generation: number }) {
		return props.generation === state.generation ? null : { error: undefined, generation: props.generation };
	}
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
	const b = page.getBoundingClientRect();
	const x = b.left + page.clientLeft, y = b.top + page.clientTop;
	clip({ left: x, top: y, right: x + page.clientWidth, bottom: y + page.clientHeight });
	if (right <= left || bottom <= top) { return undefined; }
	for (let p = el.parentElement; p && p !== page; p = p.parentElement) {
		if (getComputedStyle(p).overflow !== 'visible') {
			clip(p.getBoundingClientRect());
		}
	}
	if (right <= left || bottom <= top) {
		return undefined;
	}
	return { left: left - b.left, top: top - b.top, width: right - left, height: bottom - top };
}
