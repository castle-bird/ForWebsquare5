import * as assert from 'assert';
import { parseXml, pathTo, type XmlNode } from '../core/xmlModel';
import { parseDefaultStyles } from '../project/components';
import { componentDropPosition, insertComponent, insertPositions, insertTarget, matchPalette, paletteDefs } from '../core/palette';
import type { ComponentDef } from '../core/protocol';

suite('palette', () => {
	const W2 = 'http://www.inswave.com/websquare', XF = 'http://www.w3.org/2002/xforms';
	const def = (id: string, realType: string, ns = W2, extra: Partial<ComponentDef> = {}): ComponentDef =>
		({ id, ns, realType, display: realType, category: 'Forms', parents: [], bases: [], properties: [], events: [], ...extra });
	const screen = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:w2="${W2}" xmlns:xf="${XF}">\n<head><xf:model/></head>\n<body>\n\t<xf:group id="grp">\n\t\t<xf:input id="input1"/>\n\t</xf:group>\n\t<w2:gridView id="grd"><w2:gBody id="b"><w2:row id="r"><w2:column id="c"/></w2:row></w2:gBody></w2:gridView>\n</body>\n</html>`;
	const apply = (t: string, e: { start: number; end: number; replacement: string }) => t.slice(0, e.start) + e.replacement + t.slice(e.end);
	const find = (root: XmlNode, id: string): XmlNode => root.attrs.id === id ? root : root.children.map(c => find(c, id)).find(Boolean)!;

	test('목록: 숨김·부속·이름 없음·body·데이터 계열 제외', () => {
		const defs = [def('input', 'input'), def('column', 'column', W2, { parents: ['row'] }), def('xsl', 'xsl', W2, { hidden: true }), def('td', 'td', W2, { display: undefined }),
			def('body', 'body'), def('dataList', 'dataList', W2, { category: 'Others' }), def('aliasLinkedDataList', 'aliasLinkedDataList'), def('model', 'model', XF, { category: undefined })];
		assert.deepStrictEqual(paletteDefs(defs).map(d => d.id), ['input']);
	});

	test('검색: 낱말 모두 포함(이름·id·묶음), 대소문자·앞뒤 공백 무시', () => {
		const defs = [def('select1', 'selectbox', XF, { display: 'SelectBox' }), def('select1', 'radio', XF, { display: 'Radio' }), def('gridView', 'gridView', W2, { display: 'GridView', category: 'Grid' })];
		const names = (q: string) => matchPalette(defs, q).map(d => d.display);
		assert.deepStrictEqual(names(''), ['SelectBox', 'Radio', 'GridView']);
		assert.deepStrictEqual(names(' SELECTBOX '), ['SelectBox']);
		assert.deepStrictEqual(names('select1'), ['SelectBox', 'Radio'], 'id로도 찾는다');
		assert.deepStrictEqual(names('grid forms'), [], '낱말 하나라도 없으면 제외');
		assert.deepStrictEqual(names('grid grid'), ['GridView']);
	});

	test('넣을 대상·자리: body 밖이면 body, 그리드 안이면 gridView, 컨테이너만 안쪽', () => {
		const root = parseXml(screen)!;
		const body = root.children[1], grp = find(root, 'grp'), input = find(root, 'input1');
		assert.strictEqual(insertTarget(root, undefined), body);
		assert.strictEqual(insertTarget(root, pathTo(root, root.children[0].children[0].index)), body, 'head(xf:model) 선택');
		assert.strictEqual(insertTarget(root, pathTo(root, find(root, 'c').index)), find(root, 'grd'));
		assert.strictEqual(insertTarget(root, pathTo(root, input.index)), input);
		assert.deepStrictEqual([insertPositions(body), insertPositions(grp), insertPositions(input)],
			[['first', 'inside'], ['first', 'inside', 'before', 'after'], ['before', 'after']]);
	});

	test('드롭 자리: body는 안쪽, 그룹 중앙은 안쪽·가장자리는 앞뒤, 입력은 앞뒤', () => {
		const root = parseXml(screen)!;
		const body = root.children[1], grp = find(root, 'grp'), input = find(root, 'input1');
		assert.deepStrictEqual([0, 0.25, 0.5, 0.75, 1].map(r => componentDropPosition(body, r)), Array(5).fill('inside'));
		assert.deepStrictEqual([0.1, 0.25, 0.5, 0.75, 0.9].map(r => componentDropPosition(grp, r)), ['before', 'inside', 'inside', 'inside', 'after']);
		assert.deepStrictEqual([0.1, 0.5, 0.9].map(r => componentDropPosition(input, r)), ['before', 'after', 'after']);
	});

	test('원문: 접두사·고유 id·기본 크기·최소 틀·자리·들여쓰기', () => {
		const root = parseXml(screen)!;
		const grp = find(root, 'grp'), input = find(root, 'input1');
		const first = insertComponent(screen, root, grp, 'first', def('input', 'input', XF), { width: '144px', height: '21px' });
		assert.strictEqual(first.id, 'input2', '문서에 있는 input1을 피한다');
		assert.ok(apply(screen, first.edit).includes('<xf:group id="grp">\n\t\t<xf:input id="input2" style="width:144px;height:21px;"/>\n\t\t<xf:input id="input1"/>'));
		const radio = insertComponent(screen, root, input, 'after', def('select1', 'radio', XF));
		assert.ok(apply(screen, radio.edit).includes('<xf:input id="input1"/>\n\t\t<xf:select1 id="radio1" appearance="full">\n\t\t\t<xf:choices></xf:choices>\n\t\t</xf:select1>'));
		const grid = apply(screen, insertComponent(screen, root, grp, 'before', def('gridView', 'gridView')).edit);
		const added = parseXml(grid)!;
		const g = find(added, 'gridView1');
		assert.deepStrictEqual(g.children.map(c => c.tag), ['w2:header', 'w2:gBody']);
		assert.strictEqual(g.children[1].attrs.id, 'gBody1');
		assert.strictEqual(g.children[0].children[0].children[0].attrs.id, 'column1', '문서에 있는 c와 별개로 번호');
		assert.ok(grid.includes('<body>\n\t<w2:gridView id="gridView1">\n\t\t<w2:header id="header1">'), '대상 들여쓰기에 맞춤');
		assert.throws(() => insertComponent('<html><body/></html>', parseXml('<html><body/></html>')!, parseXml('<html><body/></html>')!.children[0], 'inside', def('input', 'input')), /네임스페이스 선언/);
		const crlf = screen.replaceAll('\n', '\r\n');
		const trigger = apply(crlf, insertComponent(crlf, parseXml(crlf)!, find(parseXml(crlf)!, 'input1'), 'before', def('trigger', 'trigger', XF, { display: 'Trigger' })).edit);
		assert.ok(trigger.includes('<xf:trigger id="trigger1">\r\n\t\t\t<xf:label><![CDATA[Trigger]]></xf:label>\r\n\t\t</xf:trigger>\r\n\t\t<xf:input id="input1"/>'), 'CRLF 문서는 CRLF');
	});

	test('기본 크기: extends로 물려받고 자기 값이 덮는다, 틀은 결과에서 뺀다', () => {
		const styles = parseDefaultStyles(`<components>
	<component id="__type1"><property name="width" value="148px"/><property name="height" value="21px"/></component>
	<component id="selectbox" extends="__type1"></component>
	<component id="trigger" extends="__type1"><property name="width" value="80px"/></component>
</components>`);
		assert.deepStrictEqual(Object.fromEntries(styles), { selectbox: { width: '148px', height: '21px' }, trigger: { width: '80px', height: '21px' } });
	});
});
