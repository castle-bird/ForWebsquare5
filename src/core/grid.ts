import { applyEdits, eolOf, escape, lineIndent, setAttribute, sourceChange, startTagEnd, type TextEdit } from './edit';
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

export interface ColumnSpan { start: number; span: number }

export function columnLayout(sections: XmlNode[][], columnsOf: (row: XmlNode) => XmlNode[]) {
	const cells = new Map<XmlNode, ColumnSpan>();
	const covered = new Map<XmlNode, ColumnSpan[]>();
	for (const sectionRows of sections) {
		const taken: Set<number>[] = sectionRows.map(() => new Set());
		sectionRows.forEach(row => covered.set(row, []));
		sectionRows.forEach((row, i) => {
			let pos = 0;
			for (const col of columnsOf(row)) {
				while (taken[i].has(pos)) { pos++; }
				const span = Math.max(1, Number(col.attrs.colSpan) || 1), down = Math.max(1, Number(col.attrs.rowSpan) || 1);
				cells.set(col, { start: pos, span });
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
