import * as assert from 'assert';
import { findNode, parseXml, type XmlNode } from '../core/xmlModel';
import { applyEdits } from '../core/edit';
import { canMoveGridColumn, deleteGridColumns, moveGridColumn } from '../core/grid';
import { isMerged, mergeCells, unmergeCells } from '../core/merge';

const XMLNS = 'xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms"';
const byId = (root: XmlNode, id: string) => findNode(root, n => n.attrs.id === id)!;
/** 행마다 칸 id(문서 순서). 병합 풀기로 새로 만든 칸(id 없음·columnN)은 '(새 칸)' */
const rows = (text: string) => {
	const out: string[][] = [];
	const walk = (n: XmlNode) => {
		if (n.tag === 'w2:row' || n.attrs.tagname === 'tr') { out.push(n.children.filter(c => c.tag === 'w2:column' || /^t[hd]$/.test(c.attrs.tagname ?? '')).map(c => c.attrs.id && !/^column\d+$/.test(c.attrs.id) ? c.attrs.id : '(새 칸)')); }
		n.children.forEach(walk);
	};
	walk(parseXml(text)!);
	return out;
};

// 열 3개: 머리 1행 [A 묶음(2칸) | C(세로 2칸)], 머리 2행 [A1 A2], 본문 [a1 a2 c], footer [f1 f2 fc]
const GRID = `<html ${XMLNS}><body>
	<w2:gridView id="grd">
		<w2:header id="h">
			<w2:row id="hr1">
				<w2:column id="hA" value="A" colSpan="2"/>
				<w2:column id="hC" value="C" rowSpan="2"/>
			</w2:row>
			<w2:row id="hr2">
				<w2:column id="hA1" value="A1"/>
				<w2:column id="hA2" value="A2"/>
			</w2:row>
		</w2:header>
		<w2:gBody id="b">
			<w2:row id="br"><w2:column id="a1"/><w2:column id="a2"/><w2:column id="c"/></w2:row>
		</w2:gBody>
		<w2:footer id="f">
			<w2:row id="fr"><w2:column id="f1"/><w2:column id="f2"/><w2:column id="fc"/></w2:row>
		</w2:footer>
	</w2:gridView>
</body></html>`;

suite('그리드 열 지우기·옮기기, 병합 풀기', () => {
	const grid = (text: string) => byId(parseXml(text)!, 'grd');
	const cell = (text: string, id: string) => byId(parseXml(text)!, id).index;
	const del = (text: string, ids: string[]) => applyEdits(text, deleteGridColumns(text, grid(text), ids.map(id => cell(text, id))));
	const move = (text: string, id: string, dir: 'left' | 'right') => applyEdits(text, moveGridColumn(text, grid(text), cell(text, id), dir));

	test('열 지우기: 모든 구역에서 그 열을 지우고, 더 넓게 합친 머리 칸은 colSpan만 줄임', () => {
		const out = del(GRID, ['a1']);
		assert.deepStrictEqual(rows(out), [['hA', 'hC'], ['hA2'], ['a2', 'c'], ['f2', 'fc']]);
		assert.ok(out.includes('<w2:column id="hA" value="A"/>'), 'colSpan 2 → 1이면 속성 삭제');
		assert.ok(parseXml(out));
		assert.deepStrictEqual(rows(del(GRID, ['hA'])), [['hC'], [], ['c'], ['fc']], '묶음 머리 칸이면 그 아래 열 모두');
		assert.deepStrictEqual(rows(del(GRID, ['a2', 'f1'])), [['hC'], [], ['c'], ['fc']], '여러 칸이면 그 열들');
	});

	test('열 옮기기: 행마다 칸 순서만 바꿈. 묶음 안에서는 되고, 묶음 밖으로 빼거나 끝이면 안 됨', () => {
		assert.deepStrictEqual(rows(move(GRID, 'a2', 'left')), [['hA', 'hC'], ['hA2', 'hA1'], ['a2', 'a1', 'c'], ['f2', 'f1', 'fc']], '묶음 안에서 왼쪽');
		assert.strictEqual(canMoveGridColumn(grid(GRID), cell(GRID, 'a2'), 'right'), false, '묶음 밖으로');
		assert.throws(() => move(GRID, 'a2', 'right'), /옮길 수 없습니다/);
		assert.strictEqual(canMoveGridColumn(grid(GRID), cell(GRID, 'a1'), 'left'), false, '맨 왼쪽');
		// 세로로 합친 C를 왼쪽으로: 묶음(2열) 전체와 자리를 바꿈. 아랫줄(C에 덮인 줄)은 그대로
		assert.deepStrictEqual(rows(move(GRID, 'hC', 'left')), [['hC', 'hA'], ['hA1', 'hA2'], ['c', 'a1', 'a2'], ['fc', 'f1', 'f2']]);
		assert.deepStrictEqual(rows(move(GRID, 'hA', 'right')), [['hC', 'hA'], ['hA1', 'hA2'], ['c', 'a1', 'a2'], ['fc', 'f1', 'f2']], '묶음 머리 칸을 오른쪽으로');
		const spaced = move(GRID, 'c', 'left');
		assert.ok(spaced.includes('<w2:column id="c"/><w2:column id="a1"/><w2:column id="a2"/>'), '사이 공백 그대로');
	});

	test('병합 풀기: 가로는 그 줄에, 세로는 아랫줄 그 자리에 빈 칸을 넣고 colSpan·rowSpan 삭제', () => {
		const root = parseXml(GRID)!;
		assert.strictEqual(isMerged(root, byId(root, 'hA')), true);
		assert.strictEqual(isMerged(root, byId(root, 'a1')), false);
		const across = applyEdits(GRID, unmergeCells(GRID, root, [byId(root, 'hA')]));
		assert.deepStrictEqual(rows(across), [['hA', '(새 칸)', 'hC'], ['hA1', 'hA2'], ['a1', 'a2', 'c'], ['f1', 'f2', 'fc']]);
		assert.ok(across.includes('<w2:column id="hA" value="A"/>') && /<w2:column width="100" inputType="text" id="column1" displayMode="label"><\/w2:column>/.test(across), across);
		const down = applyEdits(GRID, unmergeCells(GRID, root, [byId(root, 'hC')]));
		assert.deepStrictEqual(rows(down), [['hA', 'hC'], ['hA1', 'hA2', '(새 칸)'], ['a1', 'a2', 'c'], ['f1', 'f2', 'fc']]);
		const both = applyEdits(GRID, unmergeCells(GRID, root, [byId(root, 'hA'), byId(root, 'hC'), byId(root, 'a1')]));
		assert.deepStrictEqual(rows(both), [['hA', '(새 칸)', 'hC'], ['hA1', 'hA2', '(새 칸)'], ['a1', 'a2', 'c'], ['f1', 'f2', 'fc']], '여러 개(병합 안 된 칸은 무시)');
		assert.ok(!both.includes('Span'), both);
		assert.throws(() => unmergeCells(GRID, root, [byId(root, 'a1')]), /병합된 셀/);
	});

	test('병합 풀기: 병합(2x2)한 그리드 칸과 group th·td를 다시 나눔', () => {
		const square = `<html ${XMLNS}><body><w2:gridView id="g"><w2:gBody><w2:row><w2:column id="x1"/><w2:column id="x2"/></w2:row><w2:row><w2:column id="x3"/><w2:column id="x4"/></w2:row></w2:gBody></w2:gridView></body></html>`;
		const merge = (text: string, ids: string[]) => { const r = parseXml(text)!; return applyEdits(text, mergeCells(text, r, ids.map(id => byId(r, id)))); };
		const unmerge = (text: string, id: string) => { const r = parseXml(text)!; return applyEdits(text, unmergeCells(text, r, [byId(r, id)])); };
		assert.deepStrictEqual(rows(unmerge(merge(square, ['x1', 'x2', 'x3', 'x4']), 'x1')), [['x1', '(새 칸)'], ['(새 칸)', '(새 칸)']]);
		const table = `<html ${XMLNS}><body><xf:group tagname="table"><xf:group tagname="tr"><xf:group tagname="th" id="th1" class="w2tb_th" ev:onclick="scwin.x"/><xf:group tagname="td" id="td1"/></xf:group></xf:group></body></html>`
			.replace(`<html ${XMLNS}>`, `<html ${XMLNS} xmlns:ev="http://www.w3.org/2001/xml-events">`);
		const split = unmerge(merge(table, ['th1', 'td1']), 'th1');
		assert.deepStrictEqual(rows(split), [['th1', '(새 칸)']]);
		assert.ok(!split.includes('<w2:colspan>') && split.includes('<xf:group tagname="th" class="w2tb_th"></xf:group>'), '같은 태그·속성(id·이벤트 빼고), colspan 지움: ' + split);
	});
});
