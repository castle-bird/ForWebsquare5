// 셀 병합: gridView 컬럼, 또는 group(tagname th·td)으로 만든 표의 셀. 고른 셀이 직사각형으로 빈틈없이 붙어 있을 때만.
// 왼쪽 위 셀에 합친 칸 수(colSpan·rowSpan)를 넣고 나머지 셀은 지운다. 지워지는 group 셀 안의 컴포넌트는 왼쪽 위 셀로 옮겨 잃지 않는다
import { applyEdits, deleteNode, eolOf, escape, leadOf, lineIndent, setAttribute, setText, sourceChange, startTagEnd, type TextEdit } from './edit';
import { columnLayout, gridColumnXml } from './grid';
import { insertNode, reindentLines } from './paste';
import { kid, kids, localName, nodeAt, parseXml, pathTo, prefixOf, uniqueId, usedIds, WEBSQUARE_NS, type XmlNode } from './xmlModel';

const CELL_TAGS = ['th', 'td'];
const tagnameOf = (n: XmlNode) => n.attrs.tagname?.toLowerCase();
const isGroupCell = (n: XmlNode) => localName(n.tag) === 'group' && CELL_TAGS.includes(tagnameOf(n) ?? '');
const isGridCell = (n: XmlNode) => n.ns === WEBSQUARE_NS && n.tag.endsWith(':column');

/** 합칠 수 있는 셀(gridView 컬럼, group th·td) */
export const isMergeCell = (n: XmlNode) => isGridCell(n) || isGroupCell(n);

interface Table {
	rows: XmlNode[];
	cellsOf(row: XmlNode): XmlNode[];
	spanOf(cell: XmlNode): { across: number; down: number };
}

/** 셀이 속한 표(같은 행 목록을 쓰는 구역). 셀이 아니거나 행 안에 있지 않으면 undefined */
function tableOf(path: XmlNode[]): Table | undefined {
	const cell = path.at(-1), row = path.at(-2), owner = path.at(-3);
	if (!cell || !row || !owner) {
		return undefined;
	}
	if (isGridCell(cell) && localName(row.tag) === 'row' && row.ns === WEBSQUARE_NS) {
		return { rows: kids(owner, 'row'), cellsOf: r => kids(r, 'column'), spanOf: c => ({ across: Number(c.attrs.colSpan), down: Number(c.attrs.rowSpan) }) };
	}
	if (isGroupCell(cell) && localName(row.tag) === 'group' && tagnameOf(row) === 'tr') {
		const span = (c: XmlNode, name: string) => Number(kid(kid(c, 'attributes'), name)?.text);
		return {
			rows: owner.children.filter(c => localName(c.tag) === 'group' && tagnameOf(c) === 'tr'),
			cellsOf: r => r.children.filter(isGroupCell),
			spanOf: c => ({ across: span(c, 'colspan'), down: span(c, 'rowspan') }),
		};
	}
	return undefined;
}

interface Placed { cell: XmlNode; row: number; col: number; across: number; down: number }

/** 고른 셀들의 배치(같은 표 안, 직사각형으로 빈틈없이 붙음)를 확인한다. 아니면 이유를 던진다 */
function placeSelection(root: XmlNode, cells: XmlNode[]) {
	const paths = cells.map(c => pathTo(root, c.index));
	const tables = paths.map(p => p && tableOf(p));
	if (!paths.every(Boolean) || !tables.every(Boolean)) {
		throw new Error('그리드 컬럼 또는 표(group th·td)의 셀만 병합할 수 있습니다.');
	}
	const first = tables[0]!;
	if (!paths.every(p => p!.at(-3)!.index === paths[0]!.at(-3)!.index)) {
		throw new Error('같은 표(같은 구역) 안의 셀만 병합할 수 있습니다.');
	}
	const { cells: layout } = columnLayout([first.rows], first.cellsOf, first.spanOf);
	const placed: Placed[] = cells.map(cell => {
		const at = layout.get(cell)!;
		return { cell, row: at.row, col: at.start, across: at.span, down: at.down };
	});
	const rows = placed.flatMap(p => [p.row, p.row + p.down - 1]), cols = placed.flatMap(p => [p.col, p.col + p.across - 1]);
	const box = { row: Math.min(...rows), col: Math.min(...cols), endRow: Math.max(...rows), endCol: Math.max(...cols) };
	const taken = new Set<string>();
	for (const p of placed) {
		for (let r = p.row; r < p.row + p.down; r++) {
			for (let c = p.col; c < p.col + p.across; c++) { taken.add(`${r},${c}`); }
		}
	}
	if (taken.size !== (box.endRow - box.row + 1) * (box.endCol - box.col + 1)) {
		throw new Error('붙어 있는 셀만 병합할 수 있습니다. (고른 셀이 직사각형으로 이어져야 합니다)');
	}
	const keep = placed.find(p => p.row === box.row && p.col === box.col)!.cell;
	return { keep, others: cells.filter(c => c !== keep), across: box.endCol - box.col + 1, down: box.endRow - box.row + 1, grid: isGridCell(cells[0]) };
}

/** 병합할 수 있는지(메뉴 활성 여부). 못 하면 이유 */
export function mergeProblem(root: XmlNode, cells: XmlNode[]): string | undefined {
	if (cells.length < 2) {
		return '병합할 셀을 둘 이상 골라 주세요.';
	}
	try {
		placeSelection(root, cells);
		return undefined;
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
}

/** WebSquare 네임스페이스 접두사(`w2:`). 문서에 선언돼 있어야 한다 */
function websquarePrefix(root: XmlNode): string {
	const decl = Object.entries(root.attrs).find(([k, v]) => v === WEBSQUARE_NS && (k === 'xmlns' || k.startsWith('xmlns:')));
	if (!decl) {
		throw new Error('WebSquare 네임스페이스 선언을 찾지 못했습니다.');
	}
	return decl[0] === 'xmlns' ? '' : `${decl[0].slice(6)}:`;
}

/** group 셀의 HTML 속성(`<w2:attributes><w2:colspan>2</w2:colspan>`). value가 없으면 지운다 */
function setHtmlAttr(text: string, root: XmlNode, cell: XmlNode, name: string, value: string | undefined): TextEdit | undefined {
	const holder = kid(cell, 'attributes'), entry = kid(holder, name);
	if (entry) {
		return value === undefined ? deleteNode(text, entry) : setText(text, entry, value);
	}
	if (value === undefined) {
		return undefined;
	}
	const p = websquarePrefix(root), eol = eolOf(text), indent = lineIndent(text, cell.start);
	const unit = indent.includes('\t') || !indent ? '\t' : '    ';
	const item = `<${p}${name}>${value}</${p}${name}>`;
	// 줄바꿈 없이 이어 쓴 셀(`<td><a/></td>`)은 이어서, 줄을 나눠 쓴 셀은 줄을 나눠서 넣는다
	const block = (node: XmlNode) => /^[ \t]*\r?\n/.test(text.slice(startTagEnd(text, node.start) + 1));
	if (holder) {
		const open = startTagEnd(text, holder.start), holderIndent = lineIndent(text, holder.start);
		if (text[open - 1] === '/') {
			return { start: open - 1, end: open + 1, replacement: `>${eol}${holderIndent + unit}${item}${eol}${holderIndent}</${holder.tag}>` };
		}
		const close = text.lastIndexOf('</', holder.end - 1), closeIndent = leadOf(text, close);
		return closeIndent === undefined ? { start: close, end: close, replacement: item }
			: { start: close - closeIndent.length, end: close - closeIndent.length, replacement: `${closeIndent + unit}${item}${eol}` };
	}
	const open = startTagEnd(text, cell.start), child = indent + unit;
	if (text[open - 1] === '/') {
		return { start: open - 1, end: open + 1, replacement: `>${eol}${child}<${p}attributes>${eol}${child + unit}${item}${eol}${child}</${p}attributes>${eol}${indent}</${cell.tag}>` };
	}
	return block(cell)
		? { start: open + 1, end: open + 1, replacement: `${eol}${child}<${p}attributes>${eol}${child + unit}${item}${eol}${child}</${p}attributes>` }
		: { start: open + 1, end: open + 1, replacement: `<${p}attributes>${item}</${p}attributes>` };
}

/**
 * 고른 셀을 하나로 합치는 편집(하나의 변경). 못 합치면 이유를 던진다.
 * 왼쪽 위 셀에 colSpan·rowSpan을 넣고 나머지는 지운다(1이 되면 속성 삭제)
 */
export function mergeCells(text: string, root: XmlNode, cells: XmlNode[]): TextEdit[] {
	const unique = cells.filter((c, i) => cells.findIndex(o => o.index === c.index) === i);
	if (unique.length < 2) {
		throw new Error('병합할 셀을 둘 이상 골라 주세요.');
	}
	const { keep, others, across, down, grid } = placeSelection(root, unique);
	// 1) 지워지는 group 셀 안의 컴포넌트를 왼쪽 위 셀 끝으로 옮기고, 그 셀들을 지운다
	const moved = grid ? [] : others.sort((a, b) => a.start - b.start).flatMap(o => o.children.filter(c => localName(c.tag) !== 'attributes'));
	const edits: (TextEdit | undefined)[] = others.map(o => deleteNode(text, o));
	if (moved.length) {
		const lead = (n: XmlNode) => leadOf(text, n.start) ?? '', first = lead(moved[0]);
		const snippet = first + moved.map(n => reindentLines(text.slice(n.start, n.end), lead(n), first)).join(eolOf(text) + first);
		edits.push(insertNode(text, keep, 'inside', snippet));
	}
	const merged = applyEdits(text, edits);
	// 2) 합친 칸 수. 하나 넣을 때마다 다시 읽는다(둘 다 새 attributes 요소를 만들지 않게). 지운 셀은 왼쪽 위 셀 뒤라 그 노드 번호는 그대로
	const span = (n: number) => n > 1 ? String(n) : undefined;
	let current = merged;
	for (const [name, value] of [['colspan', span(across)], ['rowspan', span(down)]] as const) {
		const tree = parseXml(current), kept = tree && nodeAt(tree, keep.index);
		if (!tree || !kept) {
			throw new Error('병합 결과를 읽지 못했습니다.');
		}
		current = applyEdits(current, [grid ? setAttribute(current, kept, name === 'colspan' ? 'colSpan' : 'rowSpan', value) : setHtmlAttr(current, tree, kept, name, value)]);
	}
	const change = sourceChange(text, current);
	return change ? [change] : [];
}

/** 가로·세로로 2칸 이상 합친 셀인지(병합 풀기 대상) */
export function isMerged(root: XmlNode, cell: XmlNode): boolean {
	const path = pathTo(root, cell.index), table = path && tableOf(path);
	const span = table?.spanOf(cell);
	return !!span && ((span.across || 1) > 1 || (span.down || 1) > 1);
}

/** 병합 풀기 때 새로 넣는 빈 셀: 그리드는 "Column 추가"와 같은 컬럼, group은 같은 태그·속성(id·이벤트 빼고)의 빈 셀 */
function blankCell(cell: XmlNode, used: Set<string>): string {
	if (isGridCell(cell)) {
		return gridColumnXml(prefixOf(cell.tag), `id="${uniqueId(used, 'column')}"`);
	}
	const attrs = Object.entries(cell.attrs).filter(([name]) => name !== 'id' && !name.startsWith('ev:')).map(([name, value]) => ` ${name}="${escape(value, '"')}"`).join('');
	return `<${cell.tag}${attrs}></${cell.tag}>`;
}

/**
 * 병합 풀기: 합쳤던 칸 수만큼 빈 셀을 다시 만들고 colSpan·rowSpan(group은 colspan·rowspan)을 지운다(하나의 변경).
 * 고른 셀 중 병합된 셀만, 문서 뒤쪽 셀부터(새 셀은 그 셀 뒤에 들어가 앞 셀의 번호가 안 바뀐다)
 */
export function unmergeCells(text: string, root: XmlNode, cells: XmlNode[]): TextEdit[] {
	const targets = cells.filter(c => isMerged(root, c)).map(c => c.index).filter((i, n, all) => all.indexOf(i) === n).sort((a, b) => b - a);
	if (!targets.length) {
		throw new Error('병합된 셀을 골라 주세요.');
	}
	let current = text;
	for (const index of targets) {
		const tree = parseXml(current), path = tree && pathTo(tree, index), cell = path?.at(-1), table = path && tableOf(path);
		if (!tree || !cell || !table) {
			throw new Error('병합을 풀 셀을 찾지 못했습니다.');
		}
		const { cells: layout } = columnLayout([table.rows], table.cellsOf, table.spanOf);
		const at = layout.get(cell)!, used = usedIds(tree), eol = eolOf(current);
		/** 셀 n개(줄을 나눠 쓴 행이면 같은 들여쓰기로 줄마다) */
		const cellsXml = (n: number, lead: string | undefined) => Array.from({ length: n }, () => blankCell(cell, used)).join(lead === undefined ? '' : eol + lead);
		const edits: TextEdit[] = [];
		for (let r = at.row; r < at.row + at.down; r++) {
			const row = table.rows[r], count = r === at.row ? at.span - 1 : at.span;
			if (!count) { continue; }
			if (r === at.row) {
				const lead = leadOf(current, cell.start);
				edits.push({ start: cell.end, end: cell.end, replacement: (lead === undefined ? '' : eol + lead) + cellsXml(count, lead) });
				continue;
			}
			// 아랫줄: 합친 칸 오른쪽 첫 셀 앞, 없으면 줄 끝
			const rowCells = table.cellsOf(row), next = rowCells.find(c => layout.get(c)!.start > at.start), last = rowCells.at(-1);
			if (next) {
				const lead = leadOf(current, next.start);
				edits.push({ start: next.start, end: next.start, replacement: cellsXml(count, lead) + (lead === undefined ? '' : eol + lead) });
			} else if (last) {
				const lead = leadOf(current, last.start);
				edits.push({ start: last.end, end: last.end, replacement: (lead === undefined ? '' : eol + lead) + cellsXml(count, lead) });
			} else {
				const open = startTagEnd(current, row.start);
				if (current[open - 1] === '/') {
					throw new Error('빈 행(<row/>)이 있어 병합을 풀 수 없습니다. Source 탭에서 확인해 주세요.');
				}
				const lead = lineIndent(current, row.start) + '\t';
				edits.push({ start: open + 1, end: open + 1, replacement: eol + lead + cellsXml(count, lead) });
			}
		}
		current = applyEdits(current, edits);
		// 합친 칸 수 지우기(새 셀은 이 셀 뒤라 번호 그대로). 하나 지울 때마다 다시 읽는다(group은 attributes 안 요소)
		for (const [attr, html] of [['colSpan', 'colspan'], ['rowSpan', 'rowspan']] as const) {
			const reread = parseXml(current), kept = reread && nodeAt(reread, index);
			if (!reread || !kept) {
				throw new Error('병합 풀기 결과를 읽지 못했습니다.');
			}
			current = applyEdits(current, [isGridCell(kept) ? setAttribute(current, kept, attr, undefined) : setHtmlAttr(current, reread, kept, html, undefined)]);
		}
	}
	const change = sourceChange(text, current);
	return change ? [change] : [];
}
