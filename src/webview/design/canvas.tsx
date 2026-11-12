import { Component, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import type { ComponentDef, CssRuleSource } from '../../core/protocol';
import { defOf, localName, nodeAt, pathTo, type XmlNode } from '../../core/xmlModel';
import { setStyle } from '../../core/style';
import { EditBox } from '../ui/editBox';
import { cellForm, FORM_HEIGHT, FORM_WIDTH, formAttrs, FormFields, FormHeader, type Form } from './cellForm';
import { matchingCssRules } from './cssRules';
import { render, textTarget, outlineIcon, breaksToNewlines, newlinesToBreaks, fitUploadInputs, type TextTarget } from './renderers';
import { classLabel, REF_MIME, setDragGhost } from '../ui/tree';
import { PALETTE_MIME, readPaletteDrag, type PaletteDrag } from '../ui/palette';
import { componentDropPosition, findPaletteDef, insertPositions } from '../../core/palette';
import type { InsertPosition } from '../../core/paste';
import canvasCss from './canvas.css';
import { DataCollection } from './chart';
import { node, pick, relRect, wseIndex } from './canvasDom';
import { useCanvasZoom, ZOOM_STEP } from './canvasZoom';
import { useCellRange, useColumnResize } from './gridPointer';
import { Badges, Distances, Frame, GridHandle, HoverSpacing } from './overlay';

const MOVE_MIME = 'application/x-websquare5-canvas-move';
let renders = 0;

const sheet = (text: string) => {
	const s = new CSSStyleSheet();
	s.replaceSync(text);
	return s;
};
let canvasSheet: CSSStyleSheet | undefined;
const parsedSheets = new WeakMap<string[], CSSStyleSheet[]>();
/** CSP상 <style> 태그는 막혀 있어서 생성한 스타일시트(adoptedStyleSheets)로 붙인다. 같은 styles 메시지의 CSS는 한 번만 파싱한다(Design 탭에 돌아올 때 큰 프로젝트 CSS를 다시 읽지 않게) */
function styleSheets(sheets: string[] | undefined): CSSStyleSheet[] {
	canvasSheet ??= sheet(canvasCss);
	if (!sheets) { return [canvasSheet]; }
	let parsed = parsedSheets.get(sheets);
	if (!parsed) {
		parsed = sheets.map(sheet);
		parsedSheets.set(sheets, parsed);
	}
	return [...parsed, canvasSheet];
}

/** 편집 상자에 보일 글자: <br/>은 줄바꿈으로(그리드 칸 편집은 그대로) */
const editValue = (editing: { target: TextTarget; form?: unknown }) => editing.form ? editing.target.value ?? '' : breaksToNewlines(editing.target.value ?? '');

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
	const { zoom, view, scroller, zoomBy, reset } = useCanvasZoom(host);
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
	useEffect(() => {
		if (shadow) {
			shadow.adoptedStyleSheets = styleSheets(sheets);
		}
	}, [shadow, sheets]);
	const [tree, generation] = useMemo(() => [render(body, defs), ++renders], [body, defs]);
	const canvasContent = useMemo(() => (
		<Boundary generation={generation}><DataCollection.Provider value={dataCollection}>{tree}</DataCollection.Provider></Boundary>
	), [generation, dataCollection, tree]);
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
			const tallest = Math.max(...rows.map(r => r.offsetHeight));
			rows.forEach(r => r.style.height = `${tallest}px`);
		}));
		return () => cancelAnimationFrame(frame);
	}, [tree, shadow, sheets]);
	// 엔진이 JS로 크기를 정하는 부분: 스타일시트를 붙인 위 effect 뒤에 돌아 그 CSS로 잰다
	useEffect(() => { if (page.current) { fitUploadInputs(page.current); } }, [tree, shadow, sheets]);
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
		// 바뀐 요소만 쓴다: 같은 값도 쓰면 문서가 바뀔 때마다 모든 요소의 속성을 다시 써서 큰 화면에서 느리다
		page.current?.querySelectorAll<HTMLElement>('[data-wse]').forEach(el => {
			const index = wseIndex(el), draggable = !!onMove && index !== body.index && unitAt(index)?.index === index;
			if (el.draggable !== draggable) { el.draggable = draggable; }
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps -- unitAt은 tree에서 나오는 매 렌더 새 함수
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
		<div className="design-zoomable">
		<div className="canvas-host" ref={host} style={{ height: '100%' }}>
			{shadow && createPortal(<div className="wse-view">
				<div ref={scroller} className={clsx('wse-zoom-scroll', { zoomed: zoom !== 1 })}>
				<div className="wse-zoom-size" style={zoom !== 1 ? { width: view.width * zoom, height: view.height * zoom } : undefined}>
				<div className="wse-zoom" style={zoom !== 1 ? { width: view.width, height: view.height, transform: `scale(${zoom})` } : undefined}>
				<div ref={page} className="wse-page"
					onClick={e => {
						const el = target(e);
						if (el && !cellRange.takeClick() && !(e.shiftKey && cellRange.rangeTo(e.target, selected))) {
							onSelect(wseIndex(el), e.ctrlKey || e.metaKey);
						}
					}}
					// 열 너비 끌기(머리 칸 오른쪽 끝)가 먼저, 아니면 칸 범위 고르기
					onPointerDown={e => { columnResize.onPointerDown(e); cellRange.onPointerDown(e); }}
					onPointerMove={e => { columnResize.onPointerMove(e); cellRange.onPointerMove(e); }}
					onPointerUp={e => { columnResize.onPointerUp(e); cellRange.onPointerUp(); }}
					onPointerCancel={() => { columnResize.onPointerCancel(); cellRange.onPointerUp(); }}
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
					{canvasContent}
					{editing && (
						<EditBox key={editing.target.index} style={editing.rect} value={editValue(editing)}
							header={editing.form && <FormHeader form={editing.form} />}
							footer={editing.form && <FormFields form={editing.form} values={draft} onChange={setDraft} />}
							status={changes.length > 0 && `바꾼 속성 ${changes.length}`}
							changed={changes.length > 0}
							onCommit={v => onEditText(editing.target, editing.form ? v : newlinesToBreaks(v), editing.form && formAttrs(editing.form, draft))} onClose={() => setEditing(undefined)} />
					)}
				</div>
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
				</div>
			</div>
			</div>, shadow)}
		</div>
		{zoom !== 1 && <div className="design-zoom-controls" role="group" aria-label="화면 확대·축소">
			<button type="button" title="확대" aria-label="확대" onClick={() => zoomBy(ZOOM_STEP)}>+</button>
			<button type="button" className="zoom-level" title="100%로" aria-label={`배율 ${Math.round(zoom * 100)}%, 누르면 100%로`} onClick={reset}>{Math.round(zoom * 100)}%</button>
			<button type="button" title="축소" aria-label="축소" onClick={() => zoomBy(1 / ZOOM_STEP)}>−</button>
		</div>}
		</div>
	);
}

/** flex 방향을 우선하고,그 밖에는 실제 이웃 배치(같은 줄/열)를 본다. */
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

const label = (n: XmlNode, def?: ComponentDef) => [def?.display || localName(n.tag), n.attrs.id && `#${n.attrs.id}`, classLabel(n)].filter(Boolean).join(' ');

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
