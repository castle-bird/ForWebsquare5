import { eolOf, escape, indentUnit, type TextEdit } from './edit';
import { gridColumnXml, listColumns } from './grid';
import { insertNode, type InsertPosition } from './paste';
import { insertPositions } from './palette';
import { isWs, nsPrefix, uniqueId, usedIds, WEBSQUARE_NS, type XmlNode } from './xmlModel';

export type GridCreateOptions = { columns: number; headerRows: number; bodyRows: number; subTotalRows: number; footerRows: number; list?: number };

export function createGrid(text: string, root: XmlNode, target: XmlNode, position: InsertPosition, options: GridCreateOptions, list?: XmlNode): TextEdit {
	if (!insertPositions(target).includes(position)) { throw new Error('그리드를 넣을 수 없는 위치입니다.'); }
	const p = nsPrefix(root, WEBSQUARE_NS);
	if (p === undefined) { throw new Error('WebSquare 네임스페이스 선언이 없습니다.'); }
	const valid = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
	const sections = [['header', options.headerRows], ['gBody', options.bodyRows], ['subTotal', options.subTotalRows], ['footer', options.footerRows]] as const;
	if (!valid(options.columns, 1, 100) || sections.some(([, count]) => !valid(count, 0, 10)) || !sections.some(([, count]) => count > 0)) { throw new Error('행 또는 열 수가 올바르지 않습니다.'); }
	if (options.list !== undefined && (!isWs(list, 'dataList') || !list?.attrs.id || !listColumns(list).length)) { throw new Error('컬럼이 있는 dataList를 선택해 주세요.'); }
	const listCols = list ? listColumns(list) : [];
	const columns = Array.from({ length: options.columns }, (_, i) => listCols[i]);
	const used = usedIds(root), next = (base: string) => uniqueId(used, base), q = (v: string) => escape(v, '"');
	const unit = indentUnit(text), eol = eolOf(text), lines: string[] = [];
	const id = next('gridView');
	lines.push(`<${p}gridView id="${q(id)}" checkAllType="false" defaultCellHeight="20" dataList="${list ? `data:${q(list.attrs.id)}` : ''}">`);
	for (const [part, count] of sections) {
		if (!count) { continue; }
		lines.push(`${unit}<${p}${part} id="${q(next(part))}">`);
		for (let row = 0; row < count; row++) {
			lines.push(`${unit}${unit}<${p}row id="${q(next('row'))}">`);
			for (const col of columns) {
				const colId = part === 'gBody' && col && row === 0 ? col.attrs.id : next('column');
				const value = part === 'header' && col && row === 0 ? ` value="${q(col.attrs.name || col.attrs.id)}"` : '';
				lines.push(`${unit}${unit}${unit}${gridColumnXml(p, `id="${q(colId)}"${value}`)}`);
			}
			lines.push(`${unit}${unit}</${p}row>`);
		}
		lines.push(`${unit}</${p}${part}>`);
	}
	lines.push(`</${p}gridView>`);
	return insertNode(text, target, position, lines.join(eol));
}
