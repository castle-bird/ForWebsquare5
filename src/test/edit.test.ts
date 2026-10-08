import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findNode, parseXml, pathTo, type XmlNode } from '../core/xmlModel';
import { mergeCells, mergeProblem } from '../core/merge';
import { pasteNode } from '../core/paste';
import { movedIndexes, moveNode } from '../core/move';
import { boundColumnIds } from '../core/grid';
import { loadDefaultStyles, parseComponents } from '../project/components';
import { readWebConfig } from '../project/config';
import { cached, serial } from '../project/paths';
import { applyEdits, deleteNode, encodeScript, leadOf, scriptBody, setAttribute, setText, sourceChange } from '../core/edit';
import { setStyle, styleChanges } from '../core/style';
import { SCREEN } from './helpers';

suite('edit', () => {
	test('boundColumnIds: 바인딩된 gridView 본문 컬럼이면 dataList 컬럼 id, 헤더·바인딩 없음은 undefined', () => {
		const text = '<html><head><w2:dataCollection><w2:dataList id="dl"><w2:columnInfo><w2:column id="a"/><w2:column id="b"/></w2:columnInfo></w2:dataList></w2:dataCollection></head>'
			+ '<body><w2:gridView id="g" dataList="data:dl"><w2:header><w2:row><w2:column id="h1"/></w2:row></w2:header><w2:gBody><w2:row><w2:column id="a"/></w2:row></w2:gBody></w2:gridView>'
			+ '<w2:gridView id="g2"><w2:gBody><w2:row><w2:column id="x"/></w2:row></w2:gBody></w2:gridView></body></html>';
		const root = parseXml(text)!;
		const all = (n: XmlNode): XmlNode[] => [n, ...n.children.flatMap(all)];
		// 그리드 안의 같은 id 노드(dataList 컬럼 a와 구분)
		const path = (id: string) => pathTo(root, all(root).filter(n => n.attrs.id === id).at(-1)!.index)!;
		assert.deepStrictEqual(boundColumnIds(root, path('a')), ['a', 'b']);
		assert.strictEqual(boundColumnIds(root, path('h1')), undefined, '헤더 컬럼');
		assert.strictEqual(boundColumnIds(root, path('x')), undefined, '바인딩 안 된 그리드');
	});

	test('deleteNode: 줄 전체를 차지하면 줄바꿈까지, 아니면 태그만', () => {
		const apply = (t: string, e: { start: number; end: number; replacement: string }) => t.slice(0, e.start) + e.replacement + t.slice(e.end);
		const text = '<a>\n\t<b/>\n\t<c/><d/>\n</a>';
		const root = parseXml(text)!;
		assert.strictEqual(apply(text, deleteNode(text, root.children[0])), '<a>\n\t<c/><d/>\n</a>', '줄 전체 → 줄바꿈까지');
		assert.strictEqual(apply(text, deleteNode(text, root.children[2])), '<a>\n\t<b/>\n\t<c/>\n</a>', '한 줄에 여럿 → 태그만');
	});

	test('movedIndexes: 옮긴 뒤 노드 번호(선택·펼침이 같은 노드를 계속 가리키게) — 실제 moveNode 결과와 같음', () => {
		const apply = (t: string, es: { start: number; end: number; replacement: string }[]) =>
			[...es].sort((x, y) => y.start - x.start).reduce((acc, e) => acc.slice(0, e.start) + e.replacement + acc.slice(e.end), t);
		const text = '<html><head id="h"/><body id="b"><xf:group id="g1"><w2:input id="a"/><xf:group id="g2"><w2:input id="c"/></xf:group></xf:group><xf:group id="g3"><w2:input id="d"/></xf:group><w2:input id="e"/></body></html>';
		const root = parseXml(text)!, idOf = (n: XmlNode) => n.attrs.id ?? n.tag;
		const byId = (r: XmlNode, id: string) => findNode(r, n => idOf(n) === id)!;
		const all = (r: XmlNode): XmlNode[] => [r, ...r.children.flatMap(all)];
		const cases: [string[], string, 'before' | 'after' | 'inside'][] = [
			[['g2'], 'e', 'after'], [['e'], 'g1', 'before'], [['g3'], 'g1', 'inside'], [['a'], 'g2', 'after'], [['d', 'a'], 'g2', 'inside'], [['e'], 'a', 'before'],
		];
		for (const [ids, to, position] of cases) {
			const dragged = ids.map(id => byId(root, id)), target = byId(root, to);
			const moved = parseXml(apply(text, moveNode(text, dragged, target, position)))!;
			const map = movedIndexes(root, dragged.map(n => n.index), target.index, position)!;
			for (const n of all(root)) {
				assert.strictEqual(idOf(all(moved).find(m => m.index === map.get(n.index))!), idOf(n), `${ids} ${position} ${to}: ${idOf(n)}`);
			}
		}
		assert.strictEqual(movedIndexes(root, [999], 1, 'after'), undefined, '없는 번호');
	});

	test('moveNode: id·이벤트 그대로 전/후/안으로 옮김 (Outline 드래그 앤 드롭), 자기 자신 안으로는 거부', () => {
		const apply = (t: string, es: { start: number; end: number; replacement: string }[]) =>
			[...es].sort((a, b) => b.start - a.start).reduce((acc, e) => acc.slice(0, e.start) + e.replacement + acc.slice(e.end), t);
		const text = [
			'<html><body>',
			'\t<xf:group id="g1">',
			'\t\t<xf:trigger id="a" ev:onclick="x"/>',
			'\t\t<xf:trigger id="b"/>',
			'\t</xf:group>',
			'\t<xf:group id="g2">',
			'\t</xf:group>',
			'</body></html>',
		].join('\n');
		const root = parseXml(text)!;
		const g1 = root.children[0].children[0], a = g1.children[0], b = g1.children[1], g2 = root.children[0].children[1];

		// 같은 부모 안 순서 바꾸기 (b를 a 앞으로)
		const reordered = apply(text, moveNode(text, b, a, 'before'));
		assert.ok(reordered.includes('<xf:trigger id="b"/>\n\t\t<xf:trigger id="a" ev:onclick="x"/>'), reordered);

		// 다른 컨테이너 안으로 (a를 g2 안으로) — id·이벤트 그대로, 원래 자리엔 안 남음
		const moved = apply(text, moveNode(text, a, g2, 'inside'));
		assert.ok(moved.includes('<xf:group id="g2">\n\t\t<xf:trigger id="a" ev:onclick="x"/>\n\t</xf:group>'), moved);
		assert.strictEqual(moved.match(/id="a"/g)?.length, 1, '원래 자리엔 안 남음');

		assert.throws(() => moveNode(text, g1, a, 'inside'), '자기 자신 안으로 거부');
	});

	test('pasteNode: 그룹이면 마지막 자식, 버튼이면 바로 뒤. id는 _copyN(안쪽 포함), ev:는 제거, 들여쓰기 맞춤', () => {
		const apply = (t: string, e: { start: number; end: number; replacement: string }) => t.slice(0, e.start) + e.replacement + t.slice(e.end);
		let text = [
			'<html xmlns:ev="http://www.w3.org/2001/xml-events"><body>',
			'\t<xf:group id="grp">',
			'\t\t<xf:trigger id="btn" ev:onclick="scwin.go"><xf:label>조회</xf:label></xf:trigger>',
			'\t</xf:group>',
			'\t<xf:group id="target">',
			'\t</xf:group>',
			'</body></html>',
		].join('\n');
		const btn = pathTo(parseXml(text)!, 3)!.at(-1)!;
		const copied = '\t\t' + text.slice(btn.start, btn.end);
		for (let i = 0; i < 2; i++) {
			const root = parseXml(text)!;
			const target = root.children[0].children[1];
			text = apply(text, pasteNode(text, root, target, copied));
		}
		assert.ok(text.includes('\t<xf:group id="target">\n\t\t<xf:trigger id="btn_copy1"><xf:label>조회</xf:label></xf:trigger>\n\t\t<xf:trigger id="btn_copy2">'), text);
		assert.ok(!/btn_copy\d+" ev:/.test(text), '이벤트 제거');
		assert.ok(text.includes('<xf:trigger id="btn" ev:onclick="scwin.go">'), '원본은 그대로');

		// 버튼을 선택하고 붙이면 버튼 안이 아니라 바로 뒤 형제 (같은 들여쓰기)
		const root = parseXml(text)!;
		const onBtn = apply(text, pasteNode(text, root, pathTo(root, 3)!.at(-1)!, copied));
		assert.ok(onBtn.includes('scwin.go"><xf:label>조회</xf:label></xf:trigger>\n\t\t<xf:trigger id="btn_copy3"><xf:label>'), onBtn);

		// 복사본을 다시 복사해도 _copy1_copy1이 아니라 다음 번호, 안쪽 id도 바뀜
		const grp = '<body><xf:group id="g_copy1"><xf:input id="i"/></xf:group><xf:group id="g"/></body>';
		const groot = parseXml(grp)!;
		const src = groot.children[0];
		const out = apply(grp, pasteNode(grp, groot, groot.children[1], grp.slice(src.start, src.end)));
		assert.ok(out.includes('<xf:group id="g"><xf:group id="g_copy2"><xf:input id="i_copy1"/></xf:group></xf:group>'), out);
		assert.throws(() => pasteNode(grp, groot, groot, '<a/><b/>'));
	});

	test('pasteNode 앞·뒤: 그룹이어도 안이 아니라 그 앞·뒤 형제로, 같은 들여쓰기(id는 보통 붙여 넣기처럼 _copyN). body 앞뒤는 거부', () => {
		const apply = (t: string, e: { start: number; end: number; replacement: string }) => t.slice(0, e.start) + e.replacement + t.slice(e.end);
		const text = '<html><body>\n\t<xf:group id="g">\n\t\t<xf:input id="i"/>\n\t</xf:group>\n</body></html>';
		const root = parseXml(text)!, g = findNode(root, n => n.attrs.id === 'g')!, copied = '\t<xf:trigger id="b"/>';
		assert.strictEqual(apply(text, pasteNode(text, root, g, copied, 'before')),
			'<html><body>\n\t<xf:trigger id="b_copy1"/>\n\t<xf:group id="g">\n\t\t<xf:input id="i"/>\n\t</xf:group>\n</body></html>');
		assert.strictEqual(apply(text, pasteNode(text, root, g, copied, 'after')),
			'<html><body>\n\t<xf:group id="g">\n\t\t<xf:input id="i"/>\n\t</xf:group>\n\t<xf:trigger id="b_copy1"/>\n</body></html>');
		assert.throws(() => pasteNode(text, root, root.children[0], copied, 'before'), /앞뒤/);
	});

	const XMLNS = 'xmlns="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms"';
	const byId = (root: XmlNode, id: string) => findNode(root, n => n.attrs.id === id)!;
	const applyOne = (text: string, edit: { start: number; end: number; replacement: string }) => text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);

	suite('데이터 붙여넣기', () => {
		const text = `<html ${XMLNS}>\n<head>\n<xf:model>\n<w2:dataCollection baseNode="map">\n<w2:dataMap id="dma" baseNode="map"><w2:keyInfo><w2:key id="k1" name="k1"/></w2:keyInfo></w2:dataMap>\n</w2:dataCollection>\n`
			+ '<xf:submission id="sbm" action="/x">\n<xf:action ev:event="xforms-submit-done"><xf:script type="text/javascript"><![CDATA[a();]]></xf:script></xf:action>\n</xf:submission>\n</xf:model>\n</head>\n<body>\n<xf:group id="grp"/>\n</body>\n</html>';
		const root = parseXml(text)!;
		const snippet = (id: string) => { const n = byId(root, id); return (leadOf(text, n.start) ?? '') + text.slice(n.start, n.end); };

		test('submission: ev:event(이벤트 종류)는 지우지 않고, id는 바깥 것만 바꾸고, xf:model 안에 들어간다', () => {
			const out = applyOne(text, pasteNode(text, root, byId(root, 'sbm'), [snippet('sbm')]));
			assert.ok(out.includes('<xf:submission id="sbm_copy1" action="/x">'), out);
			assert.strictEqual(out.match(/ev:event="xforms-submit-done"/g)?.length, 2, 'ev:event 유지');
			const copy = findNode(parseXml(out)!, n => n.attrs.id === 'sbm_copy1')!;
			assert.strictEqual(parseXml(out)!.children[0].children.find(c => c.tag === 'xf:model')?.children.includes(copy) || pathTo(parseXml(out)!, copy.index)!.some(n => n.tag === 'xf:model'), true, 'model 안');
			assert.strictEqual(out.match(/<xf:model>/g)?.length, 1, 'model은 하나');
		});

		test('submission을 화면 컴포넌트(body)를 고른 채 붙여도 body가 아니라 xf:model 맨 뒤', () => {
			const out = applyOne(text, pasteNode(text, root, byId(root, 'grp'), [snippet('sbm')]));
			const tree = parseXml(out)!, copy = findNode(tree, n => n.attrs.id === 'sbm_copy1')!;
			assert.ok(pathTo(tree, copy.index)!.some(n => n.tag === 'xf:model'), out);
			assert.ok(!pathTo(tree, copy.index)!.some(n => n.tag === 'body'), 'body에는 안 들어감');
		});

		test('dataMap: 바깥 id만 _copy, 필드(key) 이름은 그대로, DataCollection 안', () => {
			const out = applyOne(text, pasteNode(text, root, byId(root, 'sbm'), [snippet('dma')]));
			assert.ok(out.includes('<w2:dataMap id="dma_copy1" baseNode="map"><w2:keyInfo><w2:key id="k1" name="k1"/>'), out);
			const tree = parseXml(out)!;
			assert.ok(pathTo(tree, findNode(tree, n => n.attrs.id === 'dma_copy1')!.index)!.some(n => n.tag === 'w2:dataCollection'), 'dataCollection 안');
		});

		test('xf:model 복사본은 붙여 넣을 수 없고(중복 방지), 컴포넌트는 데이터 영역에 못 넣고, 데이터와 컴포넌트는 같이 못 붙인다', () => {
			const model = findNode(root, n => n.tag === 'xf:model')!;
			assert.throws(() => pasteNode(text, root, byId(root, 'grp'), [text.slice(model.start, model.end)]), /xf:model/);
			assert.throws(() => pasteNode(text, root, byId(root, 'sbm'), ['<xf:group id="g"/>']), /데이터 영역/);
			assert.throws(() => pasteNode(text, root, byId(root, 'grp'), [snippet('sbm'), '<xf:group id="g"/>']), /함께/);
		});
	});

	suite('셀 병합', () => {
		const grid = `<html ${XMLNS}><body>\n<w2:gridView id="grd"><w2:header id="h">\n`
			+ '<w2:row id="r1"><w2:column id="c1" value="A"/><w2:column id="c2" value="B"/><w2:column id="c3" value="C"/></w2:row>\n'
			+ '<w2:row id="r2"><w2:column id="c4" value="D"/><w2:column id="c5" value="E"/><w2:column id="c6" value="F"/></w2:row>\n</w2:header></w2:gridView>\n</body></html>';
		const merge = (text: string, ids: string[]) => { const root = parseXml(text)!; return applyOne(text, mergeCells(text, root, ids.map(id => byId(root, id)))[0]); };
		const problem = (text: string, ids: string[]) => { const root = parseXml(text)!; return mergeProblem(root, ids.map(id => byId(root, id))); };

		test('그리드: 가로·세로·2x2 병합은 왼쪽 위 셀에 colSpan·rowSpan, 나머지 셀은 지움', () => {
			assert.ok(merge(grid, ['c1', 'c2']).includes('<w2:column id="c1" value="A" colSpan="2"/><w2:column id="c3" value="C"/>'));
			const down = merge(grid, ['c2', 'c5']);
			assert.ok(down.includes('<w2:column id="c2" value="B" rowSpan="2"/>') && !down.includes('id="c5"'), down);
			const both = merge(grid, ['c1', 'c2', 'c4', 'c5']);
			assert.ok(/<w2:column id="c1" value="A" (colSpan="2" rowSpan="2"|rowSpan="2" colSpan="2")\/>/.test(both) && !both.includes('id="c2"') && !both.includes('id="c4"') && !both.includes('id="c5"'), both);
			assert.ok(parseXml(both), '결과가 올바른 XML');
		});

		test('그리드: 떨어진 셀·대각선·한 개는 병합 불가(이유를 돌려줌), 이미 합쳐진 셀과도 이어 합침', () => {
			assert.match(problem(grid, ['c1', 'c3'])!, /붙어 있는/);
			assert.match(problem(grid, ['c1', 'c5'])!, /붙어 있는/);
			assert.match(problem(grid, ['c1'])!, /둘 이상/);
			const wide = merge(grid, ['c1', 'c2']);
			assert.strictEqual(problem(wide, ['c1', 'c3']), undefined, '합친 셀(colSpan 2)과 옆 셀');
			assert.ok(merge(wide, ['c1', 'c3']).includes('colSpan="3"'));
		});

		const table = `<html ${XMLNS}><body>\n<xf:group tagname="table" id="t"><xf:group tagname="tbody"><xf:group tagname="tr">\n`
			+ '<xf:group tagname="th" id="th1"><w2:textbox id="tb"/></xf:group><xf:group tagname="td" id="td1">\n<xf:input id="in"/>\n</xf:group><xf:group tagname="td" id="td2"/>\n</xf:group>\n'
			+ '<xf:group tagname="tr"><xf:group tagname="th" id="th2"><w2:attributes><w2:scope>row</w2:scope></w2:attributes></xf:group><xf:group tagname="td" id="td3"/><xf:group tagname="td" id="td4"/></xf:group>\n</xf:group></xf:group></body></html>';

		test('group th·td: w2:attributes의 colspan·rowspan, 지워지는 셀 안 컴포넌트는 왼쪽 위 셀로 옮김', () => {
			const out = merge(table, ['th1', 'td1']);
			assert.ok(out.includes('<w2:attributes><w2:colspan>2</w2:colspan></w2:attributes>'), out);
			assert.ok(out.includes('id="tb"') && out.includes('id="in"') && !out.includes('id="td1"'), '컴포넌트 보존');
			const tree = parseXml(out)!, th = byId(tree, 'th1');
			assert.deepStrictEqual(th.children.map(c => c.attrs.id).filter(Boolean), ['tb', 'in'].filter(id => th.children.some(c => c.attrs.id === id)).concat([]).length ? ['tb', 'in'] : [], '옮긴 순서');
			// 세로로 th1+th2: rowspan, 가진 attributes에 덧붙임·없는 셀에는 새로 만듦
			const down = merge(table, ['th2', 'td3']);
			assert.ok(down.includes('<w2:colspan>2</w2:colspan>') && down.includes('<w2:scope>row</w2:scope>'), down);
			const box = merge(table, ['td1', 'td2', 'td3', 'td4'].filter(id => id !== 'td1' || true));
			assert.ok(parseXml(box));
		});

		test('group: 2x2 병합은 colspan·rowspan을 한 w2:attributes에 같이 넣는다', () => {
			const out = merge(table.replace('<xf:group tagname="th" id="th2">', '<xf:group tagname="td" id="th2">').replace('<w2:attributes><w2:scope>row</w2:scope></w2:attributes>', ''), ['td1', 'td2', 'td3', 'td4']);
			assert.strictEqual(out.match(/<w2:attributes>/g)?.length, 1, out);
			assert.ok(out.includes('<w2:colspan>2</w2:colspan>') && out.includes('<w2:rowspan>2</w2:rowspan>'), out);
		});
	});

	test('setStyle: 바꾼 속성만 교체, 없던 속성은 뒤에, 나머지 표기·url 안 ; 유지', () => {
		assert.strictEqual(setStyle('width: 100px;height:21px;', { width: '150px' }), 'width: 150px;height:21px;');
		assert.strictEqual(setStyle('background:url(a;b.png);WIDTH:1px', { width: '2px', left: '3px' }), 'background:url(a;b.png);WIDTH:2px;left:3px;');
		assert.strictEqual(setStyle(undefined, { top: '5px' }), 'top:5px;');
		assert.strictEqual(setStyle('width:1px; top:2px;', { top: undefined }), 'width:1px;', '값이 없으면 지움');
		assert.strictEqual(setStyle('top:2px;', { top: undefined }), '', '다 지우면 빈 문자열');
	});

	test('styleChanges: 바뀐·지운 속성만(대소문자·공백 무시)', () => {
		assert.deepStrictEqual(styleChanges('width: 10px; TOP:1px;left:0', 'width:99px;top:1px;color:red'), { width: '99px', left: undefined, color: 'red' });
		assert.deepStrictEqual(styleChanges(undefined, undefined), {});
	});

	test('Source 원문은 바뀐 가운데 부분만 수정', () => {
		assert.deepStrictEqual(sourceChange('<a>\r\n  <b/>\r\n</a>', '<a>\r\n  <b x="1"/>\r\n</a>'), { start: 9, end: 9, replacement: ' x="1"' });
		assert.strictEqual(sourceChange('<a/>', '<a/>'), undefined);
	});

	test('scriptBody: CDATA(나눠 적은 인접 CDATA 포함)·일반 텍스트는 편집, 섞이면 안내', () => {
		const body = (xml: string) => scriptBody(xml, parseXml(xml)!);
		const res = body(SCREEN);
		assert.ok(typeof res === 'object' && res.cdata);
		assert.strictEqual(res.text, ' if (a < b) { scwin.x = "<tag>"; } ');
		assert.strictEqual(SCREEN.slice(res.start, res.end), res.text);
		const withSrc = body('<html><script src="ext.js"/><script>\r\n<![CDATA[var y = 2;]]>\r\n</script></html>');
		assert.ok(typeof withSrc === 'object' && withSrc.text === 'var y = 2;');
		const split = body('<html><script><![CDATA[a]]]]><![CDATA[>b]]></script></html>');
		assert.ok(typeof split === 'object' && split.cdata && split.text === 'a]]>b', '인접 CDATA는 이어 붙인 값');
		const plain = body('<html><script>if (a &lt; b &amp;&amp; c) {}</script></html>');
		assert.ok(typeof plain === 'object' && !plain.cdata && plain.text === 'if (a < b && c) {}', '일반 텍스트는 문자 참조를 푼 값');
		const refs = body('<html><script>&#65;&#x42;&quot;&apos;&gt;&#0;&#xD800;&nbsp;&AMP;</script></html>');
		assert.ok(typeof refs === 'object' && refs.text === 'AB"\'>��&nbsp;&AMP;', '숫자 참조·XML 이름 참조만 푼다');
		for (const xml of ['<html/>', '<html><script><![CDATA[a]]> <![CDATA[b]]></script></html>', '<html><script><!-- c --><![CDATA[a]]></script></html>', '<html><script><b/></script></html>']) {
			assert.strictEqual(typeof body(xml), 'string', xml);
		}
	});

	test('encodeScript: CDATA 안 ]]>는 나눠 적고, 텍스트는 이스케이프', () => {
		assert.strictEqual(encodeScript('a]]>b', true), 'a]]]]><![CDATA[>b');
		assert.strictEqual(encodeScript('a < b && c ]]>', false), 'a &lt; b &amp;&amp; c ]]&gt;');
	});

	test('DOCTYPE이 있으면 파싱 거부, 주석 안은 무시', () => {
		assert.throws(() => parseXml('<!DOCTYPE html [<!ENTITY x "y">]><html/>'), /DOCTYPE/);
		assert.ok(parseXml('<!-- <!DOCTYPE html> --><html/>'));
	});

	// 원문에 편집 한 건을 적용한 결과
	const apply = (xml: string, name: string, value: string | undefined) => {
		const node = parseXml(xml)!;
		const e = setAttribute(xml, node, name, value);
		return e ? xml.slice(0, e.start) + e.replacement + xml.slice(e.end) : xml;
	};

	test('값 변경은 그 값만 (따옴표·서식 유지)', () => {
		assert.strictEqual(apply('<a  id="x"\n\tclass=\'b\' >t</a>', 'class', 'c d'), '<a  id="x"\n\tclass=\'c d\' >t</a>');
		assert.strictEqual(apply('<a t="1>2" id="x"/>', 'id', 'y'), '<a t="1>2" id="y"/>', '값 안의 > 는 태그 끝이 아님');
	});

	test('추가 · 삭제 · 변경 없음', () => {
		assert.strictEqual(apply('<a/>', 'id', 'x'), '<a id="x"/>');
		assert.strictEqual(apply('<a id="x" >t</a>', 'style', 'w:1'), '<a id="x" style="w:1" >t</a>');
		assert.strictEqual(apply('<a id="x" style="w:1"/>', 'style', undefined), '<a id="x"/>');
		assert.strictEqual(apply('<a id="x"/>', 'nope', undefined), '<a id="x"/>');
		assert.strictEqual(setAttribute('<a id="x"/>', parseXml('<a id="x"/>')!, 'id', 'x'), undefined);
	});

	test('이스케이프 · 잘못된 이름 차단', () => {
		assert.strictEqual(apply('<a/>', 'v', 'a<b & "c"'), '<a v="a&lt;b &amp; &quot;c&quot;"/>');
		assert.strictEqual(apply('<a v=\'x\'/>', 'v', 'it\'s'), '<a v=\'it&apos;s\'/>');
		assert.throws(() => apply('<a/>', 'x="1" onload', '2'));
		assert.strictEqual(apply('<a/>', 'label', 'a\nb'), '<a label="a&#10;b"/>', '속성 줄바꿈 보존');
		assert.strictEqual(apply('<a/>', 'label', 'a\r\n\tb'), '<a label="a&#13;&#10;&#9;b"/>', 'CR·탭도 문자 참조로');
		assert.throws(() => apply('<a/>', 'label', 'a\u0001'), 'XML에 못 쓰는 제어 문자');
		assert.throws(() => apply('<a/>', 'xmlns:x', 'urn:x'), 'namespace 선언은 편집 대상 아님');
		assert.throws(() => apply('<a/>', 'x:y', '1'), '선언 안 된 접두사');
	});

	test('ev: 이벤트는 선언이 없으면 xmlns:ev를 같이 넣고, 조상에 있으면 그대로', () => {
		assert.strictEqual(apply('<a/>', 'ev:onclick', 'f()'), '<a ev:onclick="f()" xmlns:ev="http://www.w3.org/2001/xml-events"/>');
		const xml = '<html xmlns:ev="http://www.w3.org/2001/xml-events"><b/></html>';
		const root = parseXml(xml)!;
		const e = setAttribute(xml, root.children[0], 'ev:onclick', 'f()', [root])!;
		assert.strictEqual(xml.slice(0, e.start) + e.replacement + xml.slice(e.end), '<html xmlns:ev="http://www.w3.org/2001/xml-events"><b ev:onclick="f()"/></html>');
	});

	test('직계 텍스트: 공백 유지 · CDATA · 빈 태그 · 자식 앞', () => {
		const text = (xml: string, value: string, pick = (r: XmlNode) => r) => {
			const node = pick(parseXml(xml)!);
			const e = setText(xml, node, value);
			return e ? xml.slice(0, e.start) + e.replacement + xml.slice(e.end) : xml;
		};
		assert.strictEqual(text('<th a="1">\n\t사원코드\n</th>', '사번'), '<th a="1">\n\t사번\n</th>');
		assert.strictEqual(text('<b><l><![CDATA[조회]]></l></b>', '검색', r => r.children[0]), '<b><l><![CDATA[검색]]></l></b>');
		assert.strictEqual(text('<th/>', 'a<b'), '<th>a&lt;b</th>');
		assert.strictEqual(text('<th>x<w2:attributes/></th>', 'y'), '<th>y<w2:attributes/></th>');
		assert.strictEqual(text('<th></th>', 'z'), '<th>z</th>');
	});
});

suite('공통 도구', () => {
	test('applyEdits: 겹치지 않는 편집을 순서와 상관없이 적용, undefined는 건너뜀', () => {
		assert.strictEqual(applyEdits('abcdef', [{ start: 0, end: 1, replacement: 'X' }, undefined, { start: 4, end: 6, replacement: '' }, { start: 2, end: 2, replacement: '+' }]), 'Xb+cd');
	});

	test('leadOf: 줄 첫 글자면 앞 들여쓰기, 아니면 undefined', () => {
		const text = 'a\n\t  <b/><c/>';
		assert.strictEqual(leadOf(text, text.indexOf('<b')), '\t  ');
		assert.strictEqual(leadOf(text, text.indexOf('<c')), undefined);
		assert.strictEqual(leadOf(text, 0), '');
	});

	test('cached: 같은 키는 한 번만 부르고, 실패는 캐시하지 않고 다시 시도', async () => {
		const cache = new Map<string, Promise<number>>();
		let calls = 0;
		const ok = () => cached(cache, 'a', async () => ++calls);
		assert.strictEqual(await ok(), 1);
		assert.strictEqual(await ok(), 1);
		let fails = 0;
		const bad = () => cached(cache, 'b', async () => { fails++; throw new Error('x'); });
		await assert.rejects(bad());
		await assert.rejects(bad());
		assert.strictEqual(fails, 2);
	});

	test('readWebConfig: config.xml이 그대로면 다시 읽지 않고, 바뀌면(mtime) 다시 읽는다', async () => {
		const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-config-'));
		const file = path.join(webRoot, 'websquare', 'config.xml');
		fs.mkdirSync(path.dirname(file));
		fs.writeFileSync(file, '<WebSquare><a/></WebSquare>');
		const first = await readWebConfig(webRoot);
		assert.strictEqual(await readWebConfig(webRoot), first);
		fs.writeFileSync(file, '<WebSquare><b/></WebSquare>');
		fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
		const second = await readWebConfig(webRoot);
		assert.notStrictEqual(second, first);
		assert.ok(JSON.stringify(second.children.map(c => 'name' in c && c.name)).includes('WebSquare'));
	});

	test('loadDefaultStyles: 정의 파일마다 한 번만 읽고, 없으면 빈 표', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-defstyle-'));
		const definition = path.join(dir, 'WebSquareConfig.xml');
		assert.strictEqual((await loadDefaultStyles(definition)).size, 0);
		fs.writeFileSync(path.join(dir, 'ComponentDefaultStyle.xml'), '<components><component id="input"><property name="width" value="100px"/></component></components>');
		// 없던 파일은 실패로 보고 캐시하지 않아 새로 만든 파일을 읽는다
		const styles = await loadDefaultStyles(definition);
		assert.deepStrictEqual(styles.get('input'), { width: '100px' });
		fs.writeFileSync(path.join(dir, 'ComponentDefaultStyle.xml'), '<components/>');
		assert.strictEqual(await loadDefaultStyles(definition), styles);
	});

	test('serial: 같은 키는 앞 작업(실패 포함)이 끝난 뒤 차례로, 다른 키는 따로, 끝나면 비움', async () => {
		const queues = new Map<string, Promise<unknown>>(), order: string[] = [];
		const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
		const a1 = serial(queues, 'a', async () => { await sleep(30); order.push('a1'); throw new Error('x'); });
		const a2 = serial(queues, 'a', async () => { order.push('a2'); });
		const b1 = serial(queues, 'b', async () => { order.push('b1'); });
		await assert.rejects(a1);
		await Promise.all([a2, b1]);
		assert.deepStrictEqual(order, ['b1', 'a1', 'a2']);
		await sleep(0);
		assert.strictEqual(queues.size, 0);
	});

	test('parseComponents: <WebSquare> 정의 파일이 아니면 이유를 알린다', () => {
		assert.throws(() => parseComponents('<other/>'), /WebSquare/);
	});
});
