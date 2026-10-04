import { applyEdits, deleteNode, eolOf, escape, lineIndent, setAttribute, sourceChange, startTagEnd, type TextEdit } from './edit';
import { prefixOf, uniqueId, usedIds, WEBSQUARE_NS, type XmlNode } from './xmlModel';

export const GRID_BIND_MODES = { new: '신규 생성', header: '헤더만 업데이트', body: '바디만 업데이트', all: '모두 업데이트', bind: '바인드 업데이트' } as const;
export type GridBindMode = keyof typeof GRID_BIND_MODES;

export type GridExtras = { subTotal?: boolean; footer?: boolean };
export type GridPart = 'header' | 'subTotal' | 'footer';
const SECTION_ORDER = ['header', 'gBody', 'subTotal', 'footer'] as const;
const COLUMN_WIDTH = 100;
export const gridColumnXml = (p: string, attrs: string) => `<${p}column width="${COLUMN_WIDTH}" inputType="text" ${attrs} displayMode="label"></${p}column>`;

export const listColumns = (list: XmlNode) => list.children.find(c => c.tag.endsWith(':columnInfo'))?.children.filter(c => c.tag.endsWith(':column') && c.attrs.id) ?? [];

const findDataList = (n: XmlNode, id: string): XmlNode | undefined =>
	n.tag.endsWith(':dataList') && n.attrs.id === id ? n : n.children.reduce<XmlNode | undefined>((found, c) => found ?? findDataList(c, id), undefined);

/**
 * 고른 노드(path 끝)가 dataList에 바인딩된 gridView의 본문(gBody) 컬럼이면 그 dataList의 컬럼 id들(셀 id를 오타 없이 고르는 목록).
 * 아니면(헤더 컬럼·바인딩 없음·dataList 없음) undefined
 */
export function boundColumnIds(root: XmlNode, path: XmlNode[]): string[] | undefined {
	const at = (suffix: string) => path.map(n => n.tag.endsWith(suffix)).lastIndexOf(true);
	const grid = at(':gridView'), body = at(':gBody');
	if (!path.at(-1)?.tag.endsWith(':column') || grid < 0 || body < grid) {
		return undefined;
	}
	const ref = /^data:(.+)$/.exec(path[grid].attrs.dataList ?? '')?.[1];
	const list = ref ? findDataList(root, ref) : undefined;
	return list && listColumns(list).map(c => c.attrs.id!);
}

const indentOf = (text: string, node: XmlNode) => lineIndent(text, node.start);

function gridContext(text: string, root: XmlNode, grid: XmlNode) {
	if (grid.ns !== WEBSQUARE_NS || !grid.tag.endsWith(':gridView')) { throw new Error('gridView에서만 할 수 있습니다.'); }
	const p = prefixOf(grid.tag);
	const used = usedIds(root);
	const all = (name: string) => grid.children.filter(c => c.tag === p + name);
	const rowsOf = (n: XmlNode | undefined) => n?.children.filter(c => c.tag === `${p}row`) ?? [];
	return {
		p,
		eol: eolOf(text),
		nextId: (base: string) => uniqueId(used, base),
		all,
		rowsOf,
		columnsOf: (row: XmlNode | undefined) => row?.children.filter(c => c.tag === `${p}column`) ?? [],
		sections: () => grid.children.filter(s => SECTION_ORDER.some(name => s.tag === p + name)),
		column: (attrs: string) => gridColumnXml(p, attrs),
	};
}

export function addGridPart(text: string, root: XmlNode, grid: XmlNode, part: GridPart): TextEdit {
	const g = gridContext(text, root, grid);
	if (part === 'footer' && g.all('footer').length) { throw new Error('footer는 이미 있습니다.'); }
	const headerRow = g.rowsOf(g.all('header')[0]).at(-1);
	if (part === 'header' && headerRow) { return addGridRow(text, root, grid, headerRow.index); }
	const count = g.columnsOf(g.rowsOf(g.all('gBody')[0])[0] ?? g.rowsOf(g.all('header')[0])[0]).length;
	if (!count) { throw new Error('gBody(또는 header) 컬럼이 없습니다. dataList를 먼저 바인딩해 줘.'); }
	const i1 = `${indentOf(text, grid)}\t`, i2 = `${i1}\t`, i3 = `${i2}\t`;
	const cols = Array.from({ length: count }, () => `${g.eol}${i3}${g.column(`id="${g.nextId('column')}"`)}`).join('');
	const xml = `<${g.p}${part} id="${g.nextId(part)}">${g.eol}${i2}<${g.p}row id="${g.nextId('row')}">${cols}${g.eol}${i2}</${g.p}row>${g.eol}${i1}</${g.p}${part}>`;
	const prev = SECTION_ORDER.slice(0, SECTION_ORDER.indexOf(part) + 1).flatMap(g.all).at(-1);
	const at = prev ? prev.end : startTagEnd(text, grid.start) + 1;
	return { start: at, end: at, replacement: `${g.eol}${i1}${xml}` };
}

/** 셀이 차지하는 칸: 시작 열·가로 칸 수, 시작 행(구역 안)·세로 칸 수 */
interface ColumnSpan { start: number; span: number; row: number; down: number }

const attrSpans = (col: XmlNode) => ({ across: Number(col.attrs.colSpan), down: Number(col.attrs.rowSpan) });

/**
 * 표 모양 배치: 가로·세로로 합친 셀(colSpan·rowSpan)이 덮는 자리에는 셀 요소가 없다. 구역(sections)마다 행 목록.
 * spanOf: 셀이 합친 칸 수를 읽는 방법(기본은 gridView 컬럼의 colSpan·rowSpan 속성)
 */
export function columnLayout(sections: XmlNode[][], columnsOf: (row: XmlNode) => XmlNode[], spanOf: (cell: XmlNode) => { across: number; down: number } = attrSpans) {
	const cells = new Map<XmlNode, ColumnSpan>();
	const covered = new Map<XmlNode, { start: number; span: number }[]>();
	for (const sectionRows of sections) {
		const taken: Set<number>[] = sectionRows.map(() => new Set());
		sectionRows.forEach(row => covered.set(row, []));
		sectionRows.forEach((row, i) => {
			let pos = 0;
			for (const col of columnsOf(row)) {
				while (taken[i].has(pos)) { pos++; }
				const { across, down: rows } = spanOf(col);
				const span = Math.max(1, across || 1), down = Math.max(1, rows || 1);
				cells.set(col, { start: pos, span, row: i, down: Math.min(down, sectionRows.length - i) });
				for (let r = i; r < Math.min(i + down, sectionRows.length); r++) {
					for (let c = pos; c < pos + span; c++) { taken[r].add(c); }
					if (r > i) { covered.get(sectionRows[r])!.push({ start: pos, span }); }
				}
				pos += span;
			}
		});
	}
	return { cells, covered };
}

export function addGridColumn(text: string, root: XmlNode, grid: XmlNode, at?: number, side: 'left' | 'right' = 'right'): TextEdit[] {
	const g = gridContext(text, root, grid);
	const rows = g.sections().flatMap(g.rowsOf);
	if (!rows.length) { throw new Error('header·gBody가 없습니다. dataList를 먼저 바인딩해 줘.'); }
	const { cells, covered } = columnLayout(g.sections().map(g.rowsOf), g.columnsOf);
	const clicked = [...cells].find(([c]) => c.index === at)?.[1];
	const x = clicked ? clicked.start + (side === 'right' ? clicked.span : 0) : Infinity;
	const crosses = (c: { start: number; span: number }) => c.start < x && x < c.start + c.span;
	return rows.flatMap(row => {
		const cols = g.columnsOf(row);
		const wide = cols.find(c => crosses(cells.get(c)!));
		if (wide) { return [setAttribute(text, wide, 'colSpan', String(cells.get(wide)!.span + 1))!]; }
		if (covered.get(row)!.some(crosses)) { return []; }
		const xml = g.column(`id="${g.nextId('column')}"`);
		const next = cols.find(c => cells.get(c)!.start >= x);
		if (next) { return [{ start: next.start, end: next.start, replacement: `${xml}${g.eol}${indentOf(text, next)}` }]; }
		const ref = cols.at(-1);
		if (ref) { return [{ start: ref.end, end: ref.end, replacement: `${g.eol}${indentOf(text, ref)}${xml}` }]; }
		const tagEnd = startTagEnd(text, row.start);
		if (text[tagEnd - 1] === '/') { return []; }
		return [{ start: tagEnd + 1, end: tagEnd + 1, replacement: `${g.eol}${indentOf(text, row)}\t${xml}` }];
	});
}

export function addGridRow(text: string, root: XmlNode, grid: XmlNode, at?: number): TextEdit {
	const g = gridContext(text, root, grid);
	const ref = g.sections().flatMap(g.rowsOf).find(r => r.index === at || r.children.some(c => c.index === at)) ?? g.rowsOf(g.all('gBody')[0]).at(-1);
	if (!ref) { throw new Error('gBody row가 없습니다. dataList를 먼저 바인딩해 줘.'); }
	const indent = indentOf(text, ref);
	const count = Math.max(1, g.columnsOf(ref).length);
	const cols = Array.from({ length: count }, () => `${g.eol}${indent}\t${g.column(`id="${g.nextId('column')}"`)}`).join('');
	return { start: ref.end, end: ref.end, replacement: `${g.eol}${indent}<${g.p}row id="${g.nextId('row')}">${cols}${g.eol}${indent}</${g.p}row>` };
}

export function bindGridView(text: string, root: XmlNode, grid: XmlNode, list: XmlNode, mode: GridBindMode, extras: GridExtras = {}): TextEdit | undefined {
	const g = gridContext(text, root, grid);
	if (!list.tag.endsWith(':dataList') || !list.attrs.id) { throw new Error('id가 있는 dataList만 바인딩할 수 있습니다.'); }
	if (!Object.hasOwn(GRID_BIND_MODES, mode)) { throw new Error(`알 수 없는 옵션: ${mode}`); }
	const { p, eol } = g;
	const tagEnd = startTagEnd(text, grid.start);
	const selfClosing = text[tagEnd - 1] === '/';
	const tag = text.slice(grid.start, tagEnd + 1);
	const bind = setAttribute(tag, { ...grid, start: 0, end: tag.length }, 'dataList', `data:${list.attrs.id}`);
	const open = applyEdits(tag, [bind]);
	if (mode === 'bind' && !extras.subTotal && !extras.footer) {
		return bind && { start: grid.start + bind.start, end: grid.start + bind.end, replacement: bind.replacement };
	}

	const indent = indentOf(text, grid);
	const columns = listColumns(list);
	const q = (v: string) => escape(v, '"');
	const section = (name: string, old: XmlNode | undefined, rows: string[]) => {
		const tag = (n: XmlNode) => text.slice(n.start, startTagEnd(text, n.start) + 1).replace(/\s*\/>$/, '>');
		const row = g.rowsOf(old)[0];
		const i1 = `${indent}\t`, i2 = `${i1}\t`, i3 = `${i2}\t`;
		return `${old ? tag(old) : `<${p}${name} id="${q(g.nextId(name))}">`}${eol}${i2}${row ? tag(row) : `<${p}row id="${q(g.nextId('row'))}">`}`
			+ `${rows.map(r => `${eol}${i3}${r}`).join('')}${eol}${i2}</${p}row>${eol}${i1}</${p}${name}>`;
	};
	const blank = () => g.column(`id="${q(g.nextId('column'))}"`);
	const makers: Record<string, (old?: XmlNode) => string> = {
		header: old => section('header', old, columns.map(c => g.column(`id="${q(g.nextId('column'))}" value="${q(c.attrs.name || c.attrs.id)}"`))),
		gBody: old => {
			const kept = new Map(g.columnsOf(g.rowsOf(old)[0]).filter(c => c.attrs.id).map(c => [c.attrs.id, c]));
			return section('gBody', old, columns.map(c => { const k = kept.get(c.attrs.id); return k ? text.slice(k.start, k.end) : g.column(`id="${q(c.attrs.id)}"`); }));
		},
		subTotal: old => section('subTotal', old, columns.map(blank)),
		footer: old => section('footer', old, columns.map(blank)),
	};
	const fresh = mode === 'new' || selfClosing;
	const chosen = SECTION_ORDER.filter(name => name === 'header' ? fresh || mode === 'header' || mode === 'all'
		: name === 'gBody' ? fresh || mode === 'body' || mode === 'all' : extras[name]);

	let inner: string;
	if (fresh) {
		inner = `${chosen.map(name => `${eol}${indent}\t${makers[name]()}`).join('')}${eol}${indent}`;
	} else {
		const innerStart = tagEnd + 1;
		inner = text.slice(innerStart, text.lastIndexOf('</', grid.end - 1));
		const edits = chosen.flatMap(name => {
			const olds = g.all(name);
			const order = SECTION_ORDER.indexOf(name);
			if (olds.length) { return olds.map(old => ({ start: old.start - innerStart, end: old.end - innerStart, xml: makers[name](old), order })); }
			const prev = SECTION_ORDER.slice(0, order).flatMap(g.all).at(-1);
			const at = (prev?.end ?? innerStart) - innerStart;
			return [{ start: at, end: at, xml: `${eol}${indent}\t${makers[name]()}`, order }];
		});
		for (const e of edits.sort((a, b) => b.start - a.start || b.order - a.order)) { inner = inner.slice(0, e.start) + e.xml + inner.slice(e.end); }
	}
	const before = text.slice(grid.start, grid.end);
	const after = `${open.replace(/\s*\/>$/, '>')}${inner}</${grid.tag}>`;
	const change = sourceChange(before, after);
	return change && { ...change, start: change.start + grid.start, end: change.end + grid.start };
}

/** 그리드의 모든 구역(header·gBody·subTotal·footer) 행과 셀 배치. 열 번호는 구역마다 0부터라 같은 번호가 같은 열 */
function gridLayout(grid: XmlNode) {
	if (grid.ns !== WEBSQUARE_NS || !grid.tag.endsWith(':gridView')) { throw new Error('gridView에서만 할 수 있습니다.'); }
	const p = prefixOf(grid.tag);
	const rowsOf = (s: XmlNode) => s.children.filter(c => c.tag === `${p}row`);
	const columnsOf = (r: XmlNode) => r.children.filter(c => c.tag === `${p}column`);
	const sections = grid.children.filter(s => SECTION_ORDER.some(name => s.tag === p + name));
	const { cells } = columnLayout(sections.map(rowsOf), columnsOf);
	return { rows: sections.flatMap(rowsOf), columnsOf, cells };
}

interface ColumnRange { start: number; end: number }
type Layout = Map<XmlNode, ColumnSpan>;

/** 붙어 있는 열 범위 a·b를 바꿔도 되는지: 모든 셀이 a 안·b 안·둘 다 덮음·바깥 중 하나(걸치면 그 셀이 쪼개진다) */
const swappable = (cells: Layout, a: ColumnRange, b: ColumnRange) => [...cells.values()].every(({ start, span }) => {
	const end = start + span;
	return end <= a.start || start >= b.end || start >= a.start && end <= a.end || start >= b.start && end <= b.end || start <= a.start && end >= b.end;
});

/** 셀이 있는 열(합친 칸이면 그 칸 전부)을 왼쪽·오른쪽 이웃 열(묶음 머리 칸이 있으면 그 묶음)과 바꿀 범위. 못 옮기면 undefined */
function columnSwap(cells: Layout, cellIndex: number, dir: 'left' | 'right'): { a: ColumnRange; b: ColumnRange } | undefined {
	const at = [...cells].find(([c]) => c.index === cellIndex)?.[1];
	if (!at) { return undefined; }
	const block = { start: at.start, end: at.start + at.span };
	const width = Math.max(0, ...[...cells.values()].map(c => c.start + c.span));
	if (dir === 'left') {
		for (let t = block.start - 1; t >= 0; t--) {
			const a = { start: t, end: block.start };
			if (swappable(cells, a, block)) { return { a, b: block }; }
		}
	} else {
		for (let t = block.end + 1; t <= width; t++) {
			const b = { start: block.end, end: t };
			if (swappable(cells, block, b)) { return { a: block, b }; }
		}
	}
	return undefined;
}

/** 그리드 칸의 열을 그 방향으로 옮길 수 있는지(우클릭 메뉴 켜짐). WebSquare gridView가 아니면 false */
export function canMoveGridColumn(grid: XmlNode, cellIndex: number, dir: 'left' | 'right'): boolean {
	try {
		return !!columnSwap(gridLayout(grid).cells, cellIndex, dir);
	} catch {
		return false;
	}
}

/**
 * 그리드 열 옮기기: 셀이 있는 열을 이웃 열과 바꾼다(header·gBody·subTotal·footer 모든 행). 행마다 셀 순서만 바꾸고 사이 공백은 그대로.
 * 합친 칸이 걸쳐 쪼개지면(묶음 머리 칸 밖으로 빼기 등) 못 옮긴다
 */
export function moveGridColumn(text: string, grid: XmlNode, cellIndex: number, dir: 'left' | 'right'): TextEdit[] {
	const { rows, columnsOf, cells } = gridLayout(grid);
	const swap = columnSwap(cells, cellIndex, dir);
	if (!swap) { throw new Error(`합친 칸이 걸쳐 있거나 더 ${dir === 'left' ? '왼쪽' : '오른쪽'}에 열이 없어 옮길 수 없습니다.`); }
	const inside = (c: XmlNode, r: ColumnRange) => { const p = cells.get(c)!; return p.start >= r.start && p.start + p.span <= r.end; };
	return rows.flatMap(row => {
		const cols = columnsOf(row), a = cols.filter(c => inside(c, swap.a)), b = cols.filter(c => inside(c, swap.b));
		if (!a.length || !b.length) { return []; }
		const list = [...a, ...b], gaps = list.slice(1).map((c, i) => text.slice(list[i].end, c.start));
		const replacement = [...b, ...a].map((c, i) => text.slice(c.start, c.end) + (gaps[i] ?? '')).join('');
		return [{ start: list[0].start, end: list.at(-1)!.end, replacement }];
	});
}

/**
 * 그리드 열 지우기: 고른 칸들이 있는 열을 header·gBody·subTotal·footer 모든 행에서 지운다(행·열이 어긋나지 않게).
 * 그 열을 넘어 더 넓게 합친 칸(묶음 머리 칸)은 지우지 않고 colSpan만 줄인다
 */
export function deleteGridColumns(text: string, grid: XmlNode, cellIndexes: number[]): TextEdit[] {
	const { cells } = gridLayout(grid);
	const gone = new Set<number>();
	for (const index of cellIndexes) {
		const p = [...cells].find(([c]) => c.index === index)?.[1];
		for (let x = p?.start ?? 0; p && x < p.start + p.span; x++) { gone.add(x); }
	}
	if (!gone.size) { throw new Error('지울 그리드 열을 찾지 못했습니다.'); }
	return [...cells].flatMap(([cell, p]) => {
		const hit = Array.from({ length: p.span }, (_, i) => p.start + i).filter(x => gone.has(x)).length;
		const left = p.span - hit;
		return !hit ? [] : !left ? [deleteNode(text, cell)] : [setAttribute(text, cell, 'colSpan', left > 1 ? String(left) : undefined)!];
	});
}
