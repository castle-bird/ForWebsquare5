// 그리드 칸 속성 표: 칸(행,열)마다 한 줄, 칸들에 적힌 속성마다 한 열이라 칸끼리 한눈에 비교하며 고친다. 비우면 그 속성을 지운다
// Excel처럼: 클릭은 입력칸 하나, 끌기·Shift+클릭은 범위 → Ctrl+C(탭·줄로 나눈 글자, Excel과 주고받음)·Ctrl+X·Ctrl+V·Delete
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { isModKey } from '../keys';
import { GRID_CELL_PARTS, gridPartCells, type GridCellEdit, type GridCellPart } from '../../core/grid';
import { defOf, type XmlNode } from '../../core/xmlModel';
import type { ComponentDef } from '../../core/protocol';
import { ComboInput } from './combo';
import { PopupActions, PopupTitle, usePopupWindow } from './popupWindow';
import { Segmented } from './segmented';
import { capturePointer } from './pointerCapture';

const PART_LABELS: Record<GridCellPart, string> = { header: 'Header', gBody: 'Body', subTotal: 'SubTotal', footer: 'Footer' };
const HEAD_PARTS = GRID_CELL_PARTS.filter(p => p !== 'gBody');

type At = { r: number; c: number };
/** 고른 범위(anchor = 누른 칸, focus = 끌어 간 칸). 두 칸이 같으면 입력칸 하나 */
type Selection = { part: GridCellPart; anchor: At; focus: At };
/** 칸 index → 속성 → 고친 값(안 고친 속성은 없음) */
type Draft = Record<number, Record<string, string>>;
const at = (target: EventTarget) => {
	const td = (target as Element).closest?.<HTMLElement>('td[data-c]');
	return td ? { r: Number(td.dataset.r), c: Number(td.dataset.c) } : undefined;
};
const same = (a: At, b: At) => a.r === b.r && a.c === b.c;
/** 끄는 중인 표(스크롤 칸)와 포인터 */
type Drag = { wrap: HTMLElement; x: number; y: number; frame?: number; captured?: boolean };
const EDGE = 24;
/** 칸이 보이는 영역: 위 머리글·왼쪽 행,열 칸은 고정이라 그 밑의 칸은 가려져 있다 */
const bodyBox = (wrap: HTMLElement) => {
	const r = wrap.getBoundingClientRect();
	return { left: r.left + (wrap.querySelector('td')?.offsetWidth ?? 0), top: r.top + (wrap.querySelector('thead')?.offsetHeight ?? 0), right: r.left + wrap.clientWidth, bottom: r.top + wrap.clientHeight };
};
/** 포인터(보이는 영역 밖이면 안으로 당김) 아래 칸 */
const cellUnder = (d: Drag) => {
	const { left, top, right, bottom } = bodyBox(d.wrap);
	const el = document.elementFromPoint(Math.max(left + 1, Math.min(right - 1, d.x)), Math.max(top + 1, Math.min(bottom - 1, d.y)));
	return el ? at(el) : undefined;
};
/** 붙여 넣을 글자 → 행·열(Excel이 붙이는 끝 줄바꿈 하나는 뺀다) */
const grid2d = (text: string) => text.replace(/\r?\n$/, '').split(/\r?\n/).map(line => line.split('\t'));

export function GridCellsEditor({ grid, defs, externalError, offsetIndex = 0, onApply, onClose }: {
	grid: XmlNode; defs?: ComponentDef[]; externalError?: string; offsetIndex?: number;
	onApply(cells: GridCellEdit[]): void; onClose(): void;
}) {
	const parts = Object.fromEntries(GRID_CELL_PARTS.map(p => [p, gridPartCells(grid, p)])) as Record<GridCellPart, ReturnType<typeof gridPartCells>>;
	const heads = HEAD_PARTS.filter(p => parts[p]);
	const [head, setHead] = useState<GridCellPart | undefined>(heads[0]);
	const [all, setAll] = useState(false);
	const [draft, setDraft] = useState<Draft>({});
	// 팝업 안 되돌리기(Ctrl+Z)·다시 하기(Ctrl+Y·Ctrl+Shift+Z). 같은 칸을 이어 타이핑하면 한 단계
	const history = useRef<{ past: Draft[]; future: Draft[]; key?: string }>({ past: [], future: [] });
	/** key: 같은 칸·속성 타이핑(이어지면 한 단계로), 없으면 늘 새 단계(붙여넣기·지우기) */
	const change = (next: Draft, key?: string) => {
		const h = history.current;
		if (key === undefined || key !== h.key) { h.past.push(draft); h.future = []; }
		h.key = key;
		setDraft(next);
	};
	const step = (redo: boolean) => {
		const h = history.current, [from, to] = redo ? [h.future, h.past] : [h.past, h.future];
		const next = from.pop();
		if (!next) { return; }
		to.push(draft);
		h.key = undefined;
		setDraft(next);
	};
	const [sel, setSel] = useState<Selection>();
	const dragging = useRef<Drag>(undefined);
	const stopDrag = () => {
		if (dragging.current?.frame) { cancelAnimationFrame(dragging.current.frame); }
		dragging.current = undefined;
	};
	/** 표 가장자리(EDGE px 안·밖)에 머무는 동안 매 프레임 굴리고(멀수록 빠르게) 새로 보인 칸까지 고른다 */
	const autoScroll = () => {
		const d = dragging.current;
		if (!d) { return; }
		d.frame = undefined;
		const { left, top, right, bottom } = bodyBox(d.wrap);
		const speed = (before: number, after: number) => before > 0 ? -Math.min(16, Math.ceil(before / 5)) : after > 0 ? Math.min(16, Math.ceil(after / 5)) : 0;
		const dx = speed(left + EDGE - d.x, d.x - (right - EDGE)), dy = speed(top + EDGE - d.y, d.y - (bottom - EDGE));
		const { scrollLeft, scrollTop } = d.wrap;
		d.wrap.scrollBy(dx, dy);
		if (d.wrap.scrollLeft === scrollLeft && d.wrap.scrollTop === scrollTop) { return; }
		const p = cellUnder(d);
		if (p) { setSel(s => s && { ...s, focus: p }); }
		d.frame = requestAnimationFrame(autoScroll);
	};
	/** 고른 표의 복사·잘라내기·붙여넣기(true = 처리함) */
	const clip = useRef<{ wrap: string; run(type: string, data: DataTransfer): boolean }>(undefined);
	useEffect(() => {
		// 문서에서 받는다: VS Code의 Ctrl+C·V(execCommand)는 글자 선택이 없으면 포커스(표)가 아니라 body에 이벤트를 보낸다
		const on = (e: Event) => {
			const { clipboardData } = e as globalThis.ClipboardEvent, c = clip.current;
			if (c && clipboardData && document.activeElement?.closest(c.wrap) && c.run(e.type, clipboardData)) { e.preventDefault(); }
		};
		const types = ['copy', 'cut', 'paste'];
		types.forEach(t => document.addEventListener(t, on));
		return () => types.forEach(t => document.removeEventListener(t, on));
	}, []);
	const { titleProps, resizeHandles, popupProps } = usePopupWindow({ initialOffset: offsetIndex, onClose });

	const table = (part: GridCellPart) => {
		const cells = parts[part] ?? [];
		// 칸들에 적힌 속성(정의 기본값과 다른 것만 XML에 남는다). 모든 속성 보기면 컴포넌트 정의의 속성도
		const names = [...new Set(cells.flatMap(c => [...Object.keys(c.node.attrs), ...all ? defOf(c.node, defs)?.properties.map(p => p.name) ?? [] : []]))].sort();
		if (!cells.length) { return <p className="table-empty">칸이 없습니다.</p>; }
		const valueOf = (r: number, c: number) => draft[cells[r].index]?.[names[c]] ?? cells[r].node.attrs[names[c]] ?? '';
		const mine = sel?.part === part ? sel : undefined;
		const range = mine && { top: Math.min(mine.anchor.r, mine.focus.r), bottom: Math.max(mine.anchor.r, mine.focus.r), left: Math.min(mine.anchor.c, mine.focus.c), right: Math.max(mine.anchor.c, mine.focus.c) };
		const multi = !!mine && !same(mine.anchor, mine.focus);
		const picked = (r: number, c: number) => multi && r >= range!.top && r <= range!.bottom && c >= range!.left && c <= range!.right;
		const rangeCells = () => range ? Array.from({ length: range.bottom - range.top + 1 }, (_, i) => Array.from({ length: range.right - range.left + 1 }, (_, j) => ({ r: range.top + i, c: range.left + j }))) : [];
		const rangeText = () => rangeCells().map(row => row.map(p => valueOf(p.r, p.c)).join('\t')).join('\n');
		/** 표 안 칸들에 값 넣기(표 밖은 버림) */
		const write = (values: { r: number; c: number; v: string }[]) => change((() => {
			const next = { ...draft };
			for (const { r, c, v } of values) {
				if (r < cells.length && c < names.length) { next[cells[r].index] = { ...next[cells[r].index], [names[c]]: v }; }
			}
			return next;
		})());
		const clear = () => write(rangeCells().flat().map(p => ({ ...p, v: '' })));
		/** 범위로 바뀌면 입력칸에서 나와 표가 키(복사·붙여넣기·Delete)를 받는다 */
		const toRange = (e: PointerEvent<HTMLElement>, focus: At) => {
			setSel({ part, anchor: mine?.anchor ?? focus, focus });
			if (mine && !same(mine.anchor, focus)) {
				getSelection()?.removeAllRanges();
				e.currentTarget.closest<HTMLElement>('.data-editor-table-wrap')?.focus();
			}
		};
		const dragTo = (e: PointerEvent<HTMLElement>) => {
			const d = dragging.current;
			if (!(e.buttons & 1)) { stopDrag(); return; }
			if (!d || !mine) { return; }
			d.x = e.clientX; d.y = e.clientY;
			const p = cellUnder(d), box = bodyBox(d.wrap);
			const outside = d.x < box.left || d.x > box.right || d.y < box.top || d.y > box.bottom;
			// 다른 칸이나 보이는 영역 밖으로 가면 범위: 표 밖에서도 계속 받고 가장자리에서는 굴린다(한 칸 안 글자 고르기는 그대로)
			if (!multi && !outside && (!p || same(mine.anchor, p))) { return; }
			if (p && !same(mine.focus, p)) { toRange(e, p); }
			if (!e.currentTarget.hasPointerCapture(e.pointerId) && !d.captured) { d.captured = true; capturePointer(e); }
			if (!d.frame) { autoScroll(); }
		};
		const paste = (data: DataTransfer) => {
			const rows = grid2d(data.getData('text/plain'));
			const one = rows.length === 1 && rows[0].length === 1;
			// 입력칸 하나에 한 칸짜리 글자는 입력칸이 그대로 받는다
			if (!multi && one) { return false; }
			// Excel처럼: 고른 범위가 복사한 크기의 배수(한 값 포함)면 범위 전체에 되풀이, 아니면 범위 왼쪽 위부터 한 번
			const height = rows.length, width = Math.max(...rows.map(r => r.length));
			const h = range!.bottom - range!.top + 1, w = range!.right - range!.left + 1;
			write(multi && h % height === 0 && w % width === 0
				? rangeCells().flat().map(p => ({ ...p, v: rows[(p.r - range!.top) % height][(p.c - range!.left) % width] ?? '' }))
				: rows.flatMap((row, i) => row.map((v, j) => ({ r: range!.top + i, c: range!.left + j, v }))));
			return true;
		};
		if (mine) {
			clip.current = { wrap: `[data-part="${part}"]`, run: (type, data) => {
				if (type === 'paste') { return paste(data); }
				// 입력칸 하나면 입력칸 글자 복사 그대로
				if (!multi) { return false; }
				data.setData('text/plain', rangeText());
				if (type === 'cut') { clear(); }
				return true;
			} };
		}
		return <div className="data-editor-table-wrap" tabIndex={-1} data-part={part}
			onKeyDown={e => { if (multi && e.target === e.currentTarget && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); clear(); } }}>
			<table style={{ width: 64 + names.length * 120 }}>
				<colgroup><col style={{ width: 64 }} />{names.map(n => <col key={n} style={{ width: 120 }} />)}</colgroup>
				<thead><tr><th>행,열</th>{names.map(n => <th key={n} title={n}>{n}</th>)}</tr></thead>
				<tbody
					onPointerDown={e => {
						const p = at(e.target);
						if (!p || e.button !== 0) { return; }
						if (e.shiftKey && mine) { e.preventDefault(); toRange(e, p); return; }
						stopDrag();
						dragging.current = { wrap: e.currentTarget.closest<HTMLElement>('.data-editor-table-wrap')!, x: e.clientX, y: e.clientY };
						setSel({ part, anchor: p, focus: p });
					}}
					onPointerMove={dragTo}
					// 칸 밖(표 밖)으로 곧장 나가도 이어서 받는다
					onPointerLeave={dragTo}
					onPointerUp={stopDrag} onPointerCancel={stopDrag}
					// Tab 등으로 입력칸에 들어오면 그 칸 하나
					onFocus={e => { const p = at(e.target); if (p && !dragging.current) { setSel({ part, anchor: p, focus: p }); } }}>
					{cells.map((cell, r) => {
					const options = (name: string) => defOf(cell.node, defs)?.properties.find(p => p.name === name)?.options;
					return <tr key={cell.index}>
						<td className="mono">{cell.label}</td>
						{names.map((name, c) => {
							const value = draft[cell.index]?.[name] ?? cell.node.attrs[name] ?? '';
							const set = (v: string) => change({ ...draft, [cell.index]: { ...draft[cell.index], [name]: v } }, `${cell.index}:${name}`);
							const label = `${PART_LABELS[part]} ${cell.label} ${name}`;
							const changed = draft[cell.index]?.[name] !== undefined && value !== (cell.node.attrs[name] ?? '');
							return <td key={name} data-r={r} data-c={c} className={[changed && 'changed', picked(r, c) && 'picked'].filter(Boolean).join(' ') || undefined}>
								{options(name)?.length
									? <ComboInput aria-label={label} value={value} options={options(name)!} onValue={set} onPick={set} />
									: <input aria-label={label} value={value} onChange={e => set(e.target.value)} />}
							</td>;
						})}
					</tr>;
				})}</tbody>
			</table>
		</div>;
	};

	const apply = () => {
		const cells = GRID_CELL_PARTS.flatMap(p => parts[p] ?? []).flatMap(cell => {
			const changed = Object.entries(draft[cell.index] ?? {}).filter(([name, v]) => v !== (cell.node.attrs[name] ?? ''));
			return changed.length ? [{ index: cell.index, attrs: Object.fromEntries(changed.map(([name, v]) => [name, v || null])) }] : [];
		});
		if (cells.length) { onApply(cells); } else { onClose(); }
	};

	return <dialog {...popupProps} onKeyDown={e => {
		const redo = isModKey(e.nativeEvent, 'y') || isModKey(e.nativeEvent, 'z') && e.shiftKey;
		if (isModKey(e.nativeEvent, 'z') || redo) { e.preventDefault(); e.stopPropagation(); step(redo); return; }
		popupProps.onKeyDown(e);
	}} className="popup data-editor grid-cells-editor" aria-label={`${grid.attrs.id ?? 'gridView'} 칸 속성`}>
		<PopupTitle titleProps={titleProps} badge="GridView" onClose={onClose}><span>{grid.attrs.id || '(id 없음)'}</span><span className="popup-meta">· 칸 속성</span></PopupTitle>
		<div className="grid-cells-sections">
			<section>
				<h3>Head {head && heads.length > 1 && <Segmented aria-label="Head 부분" value={PART_LABELS[head]} options={heads.map(p => PART_LABELS[p])}
					onChange={v => { setHead(heads.find(p => PART_LABELS[p] === v)); setSel(undefined); clip.current = undefined; }} />}{head && heads.length === 1 && <span className="popup-meta">{PART_LABELS[head]}</span>}</h3>
				<div className="data-editor-body">{head ? table(head) : <p className="table-empty">header·footer·subTotal이 없습니다.</p>}</div>
			</section>
			<section>
				<h3>Body</h3>
				<div className="data-editor-body">{table('gBody')}</div>
			</section>
		</div>
		{externalError && <p className="error" role="alert">{externalError}</p>}
		<PopupActions onClose={onClose} onApply={apply}>
			<label className="actions-hint grid-cells-all"><input type="checkbox" checked={all} onChange={e => { setAll(e.target.checked); setSel(undefined); clip.current = undefined; }} />모든 속성 보기</label>
		</PopupActions>
		{resizeHandles}
	</dialog>;
}
