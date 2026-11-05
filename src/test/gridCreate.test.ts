import * as assert from 'assert';
import { applyEdits } from '../core/edit';
import { prepareNodeEdit } from '../core/nodeEdit';
import { parseXml } from '../core/xmlModel';
import type { GridCreateOptions } from '../core/gridCreate';

suite('gridCreate', () => {
	const text = '<html xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms"><head><xf:model><w2:dataCollection><w2:dataList id="dl"><w2:columnInfo><w2:column id="code" name="코드"/><w2:column id="name" name="이름"/></w2:columnInfo></w2:dataList></w2:dataCollection></xf:model></head><body><w2:gridView id="gridView1"/></body></html>';
	const root = parseXml(text)!, body = root.children[1], list = root.children[0].children[0].children[0].children[0];
	const create = (options: GridCreateOptions) => {
		const plan = prepareNodeEdit(text, { type: 'createGrid', version: 1, popup: 'p', index: body.index, position: 'inside', options });
		assert.ok(plan && 'changes' in plan);
		return parseXml(applyEdits(text, plan.changes))!.children[1].children[1];
	};
	test('빈 그리드의 행·열 수와 고유 id', () => {
		const grid = create({ columns: 3, headerRows: 2, bodyRows: 1, subTotalRows: 2, footerRows: 1 });
		assert.strictEqual(grid.attrs.id, 'gridView2');
		assert.deepStrictEqual(grid.children.map(s => [s.tag, s.children.length]), [['w2:header', 2], ['w2:gBody', 1], ['w2:subTotal', 2], ['w2:footer', 1]]);
		assert.ok(grid.children.every(s => s.children.every(r => r.children.length === 3)));
	});
	test('dataList 이름과 바디 컬럼 바인딩', () => {
		const grid = create({ columns: 2, headerRows: 1, bodyRows: 1, subTotalRows: 0, footerRows: 0, list: list.index });
		assert.strictEqual(grid.attrs.dataList, 'data:dl');
		assert.deepStrictEqual(grid.children[0].children[0].children.map(c => c.attrs.value), ['코드', '이름']);
		assert.deepStrictEqual(grid.children[1].children[0].children.map(c => c.attrs.id), ['code', 'name']);
		const more = create({ columns: 3, headerRows: 1, bodyRows: 1, subTotalRows: 0, footerRows: 0, list: list.index });
		assert.strictEqual(more.children[1].children[0].children.length, 3);
		assert.deepStrictEqual(more.children[1].children[0].children.slice(0, 2).map(c => c.attrs.id), ['code', 'name']);
		const less = create({ columns: 1, headerRows: 0, bodyRows: 1, subTotalRows: 0, footerRows: 0, list: list.index });
		assert.deepStrictEqual(less.children[0].children[0].children.map(c => c.attrs.id), ['code']);
	});
	test('새 칸 id는 dataList 컬럼 id와 겹치지 않는다', () => {
		const src = text.replace('<w2:column id="code"', '<w2:column id="column1"');
		const r = parseXml(src)!, l = r.children[0].children[0].children[0].children[0];
		const plan = prepareNodeEdit(src, { type: 'createGrid', version: 1, popup: 'p', index: r.children[1].index, position: 'inside', options: { columns: 3, headerRows: 0, bodyRows: 1, subTotalRows: 0, footerRows: 0, list: l.index } });
		assert.ok(plan && 'changes' in plan);
		const ids = parseXml(applyEdits(src, plan.changes))!.children[1].children[1].children[0].children[0].children.map(c => c.attrs.id);
		assert.deepStrictEqual(ids, ['column1', 'name', 'column2']);
	});
	test('잘못된 수와 바인딩은 거부', () => {
		assert.throws(() => create({ columns: 101, headerRows: 1, bodyRows: 1, subTotalRows: 0, footerRows: 0 }), /행 또는 열/);
		assert.throws(() => create({ columns: 1, headerRows: 0, bodyRows: 0, subTotalRows: 0, footerRows: 0 }), /행 또는 열/);
		assert.throws(() => create({ columns: 1, headerRows: 1, bodyRows: 1, subTotalRows: 0, footerRows: 0, list: body.index }), /dataList/);
	});
});
