import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { findNode, parseXml } from '../core/xmlModel';
import { pasteNode } from '../core/paste';
import { moveNode } from '../core/move';
import { addDataNode, DATA_KINDS, editDataFields } from '../core/data';
import { addSubmissionNode, editSubmissionNode, newSubmissionFields, nextSubmissionId, submissionFields, type SubmissionFields } from '../core/submission';
import { addGridColumn, addGridPart, addGridRow, bindGridView } from '../core/grid';
import { resizeBox, resizeEdges } from '../webview/ui/resizeBox';
import { applyNodeEdit } from '../vscode/documentEdit';
import { editChoices, readChoices } from '../core/choices';

suite('DataCollection creation', () => {
	test('우클릭 메뉴의 다섯 종류를 고유 ID로 추가하고 기존 XML·줄바꿈을 보존', () => {
		let text = '<html xmlns:w2="http://www.inswave.com/websquare"><head><w2:dataCollection baseNode="map">\r\n\t<w2:dataMap id="dataMap1"/>\r\n</w2:dataCollection></head></html>';
		for (const kind of DATA_KINDS) {
			const root = parseXml(text)!;
			const collection = root.children[0].children[0];
			const edit = addDataNode(text, root, collection, kind);
			text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
		}
		const collection = parseXml(text)!.children[0].children[0];
		assert.deepStrictEqual(collection.children.map(c => [c.tag, c.attrs.id]), [
			['w2:dataMap', 'dataMap1'], ['w2:dataList', 'dataList1'], ['w2:dataMap', 'dataMap2'],
			['w2:linkedDataList', 'linkedDataList1'], ['w2:aliasDataList', 'aliasDataList1'], ['w2:aliasDataMap', 'aliasDataMap1'],
		]);
		assert.strictEqual(collection.children[1].children[0].tag, 'w2:columnInfo');
		assert.strictEqual(collection.children[2].children[0].tag, 'w2:keyInfo');
		assert.ok(!/(?<!\r)\n/.test(text), 'CRLF 문서에 LF를 섞지 않음');
		assert.throws(() => addDataNode(text, parseXml(text)!, collection.children[0], 'dataMap'));
	});

	test('추가 요청을 VS Code 문서 편집으로 적용', async () => {
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-data-')), 'screen.xml');
		fs.writeFileSync(file, '<html xmlns:w2="http://www.inswave.com/websquare"><head><w2:dataCollection/></head></html>');
		const document = await vscode.workspace.openTextDocument(file);
		const collection = parseXml(document.getText())!.children[0].children[0];
		assert.ok(await applyNodeEdit(document, { type: 'addData', version: document.version, index: collection.index, kind: 'dataList' }));
		assert.strictEqual(parseXml(document.getText())!.children[0].children[0].children[0].attrs.id, 'dataList1');
	});
});

suite('Choices (selectbox·radio 선택 항목)', () => {
	const apply = (text: string, edit?: { start: number; end: number; replacement: string }) => edit ? text.slice(0, edit.start) + edit.replacement + text.slice(edit.end) : text;
	const select = (text: string) => parseXml(text)!.children[0].children[0];

	test('항목 다시 쓰기: CDATA(]]> 포함)·CRLF·들여쓰기, 다른 속성 유지, 바뀐 속성만', () => {
		const text = '<html xmlns:xf="http://www.w3.org/2002/xforms">\r\n\t<body>\r\n\t\t<xf:select1 id="sel" appearance="minimal" allOption="">\r\n\t\t\t<xf:choices>\r\n\t\t\t\t<xf:item>\r\n\t\t\t\t\t<xf:label><![CDATA[재직자]]></xf:label>\r\n\t\t\t\t\t<xf:value><![CDATA[1]]>\r\n\t\t\t\t\t</xf:value>\r\n\t\t\t\t</xf:item>\r\n\t\t\t</xf:choices>\r\n\t\t</xf:select1>\r\n\t</body>\r\n</html>';
		const root = parseXml(text)!, node = select(text);
		assert.deepStrictEqual(readChoices(node), { items: [{ label: '재직자', value: '1' }] });
		const items = [{ label: '재직자', value: '1' }, { label: 'a]]>b', value: '2' }];
		const updated = apply(text, editChoices(text, root, node, { items, attrs: { allOption: 'true', ref: undefined } }));
		assert.deepStrictEqual(readChoices(select(updated)), { items });
		assert.deepStrictEqual(select(updated).attrs, { id: 'sel', appearance: 'minimal', allOption: 'true' });
		const cleared = apply(updated, editChoices(updated, parseXml(updated)!, select(updated), { items, attrs: { allOption: null } }));
		assert.deepStrictEqual(select(cleared).attrs, { id: 'sel', appearance: 'minimal' }, 'null이면 속성 제거');
		assert.ok(!/(?<!\r)\n/.test(updated), 'CRLF 유지');
		assert.ok(updated.includes('\r\n\t\t\t<xf:choices>\r\n\t\t\t\t<xf:item>\r\n\t\t\t\t\t<xf:label><![CDATA[재직자]]></xf:label>'), updated);
		assert.strictEqual(editChoices(text, root, node, { items: [{ label: '재직자', value: '1' }], attrs: { allOption: '' } }), undefined, '바뀐 게 없으면 편집 없음');
		const attrOnly = editChoices(text, root, node, { items: [{ label: '재직자', value: '1' }], attrs: { chooseOption: 'true' } })!;
		assert.strictEqual(attrOnly.end, text.indexOf('>', attrOnly.start) + 1, '시작 태그만 고침');
		// checkcombobox도 같은 모양(빈 태그에 choices 추가)
		const combo = '<html xmlns:xf="http://www.w3.org/2002/xforms"><body><xf:checkcombobox id="k" style="width:148px;"/></body></html>';
		const filled = apply(combo, editChoices(combo, parseXml(combo)!, select(combo), { items: [{ label: 'A', value: 'a' }], attrs: { allOption: 'true' } }));
		assert.deepStrictEqual(readChoices(select(filled)), { items: [{ label: 'A', value: 'a' }] });
		assert.strictEqual(select(filled).attrs.allOption, 'true');
	});

	test('multiupload 파라미터: <param name value></param> 다시 쓰기, script 등 다른 자식 유지', () => {
		const head = '<html xmlns:w2="http://www.inswave.com/websquare">\r\n\t<body>\r\n\t\t';
		const empty = `${head}<w2:multiupload id="mu" style="width:500px;"/>\r\n\t</body>\r\n</html>`;
		const added = apply(empty, editChoices(empty, parseXml(empty)!, select(empty), { items: [{ label: 'a', value: '1' }, { label: 'b"', value: '2' }], attrs: {} }));
		assert.ok(added.includes('<w2:multiupload id="mu" style="width:500px;">\r\n\t\t\t<param name="a" value="1"></param>\r\n\t\t\t<param name="b&quot;" value="2"></param>\r\n\t\t</w2:multiupload>'), added);
		assert.deepStrictEqual(readChoices(select(added)), { items: [{ label: 'a', value: '1' }, { label: 'b"', value: '2' }] });
		const withScript = `${head}<w2:multiupload id="mu">\r\n\t\t\t<param name="x" value="1"></param>\r\n\t\t\t<script type="javascript" ev:event="onComplete"><![CDATA[f();]]></script>\r\n\t\t\t<param name="y" value="2"></param>\r\n\t\t</w2:multiupload>\r\n\t</body>\r\n</html>`;
		const replaced = apply(withScript, editChoices(withScript, parseXml(withScript)!, select(withScript), { items: [{ label: 'z', value: '3' }], attrs: {} }));
		assert.ok(replaced.includes('<w2:multiupload id="mu">\r\n\t\t\t<param name="z" value="3"></param>\r\n\t\t\t<script type="javascript" ev:event="onComplete"><![CDATA[f();]]></script>\r\n\t\t</w2:multiupload>'), replaced);
		const cleared = apply(added, editChoices(added, parseXml(added)!, select(added), { items: [], attrs: {} }));
		assert.ok(cleared.includes('<w2:multiupload id="mu" style="width:500px;">\r\n\t\t</w2:multiupload>'), cleared);
		assert.strictEqual(editChoices(added, parseXml(added)!, select(added), { items: [{ label: 'a', value: '1' }, { label: 'b"', value: '2' }], attrs: {} }), undefined, '그대로면 편집 없음');
	});

	test('데이터 바인딩(itemset)으로 바꾸고 다시 읽기, 빈 select1·자체 닫힘에도 추가', () => {
		const text = '<html xmlns:xf="http://www.w3.org/2002/xforms"><body>\n\t<xf:select1 id="rad" appearance="full"></xf:select1>\n</body></html>';
		const root = parseXml(text)!, node = select(text);
		const itemset = { nodeset: 'data:dlt_code', label: 'name', value: 'code' };
		const bound = apply(text, editChoices(text, root, node, { items: [{ label: 'x', value: 'y' }], itemset, attrs: { cols: '3' } }));
		assert.deepStrictEqual(readChoices(select(bound)), { items: [], itemset });
		assert.strictEqual(select(bound).attrs.cols, '3');
		assert.ok(bound.includes('\t<xf:select1 id="rad" appearance="full" cols="3">\n\t\t<xf:choices>\n\t\t\t<xf:itemset nodeset="data:dlt_code">') && bound.includes('\t\t</xf:choices>\n\t</xf:select1>'), bound);
		const self = '<html xmlns:xf="http://www.w3.org/2002/xforms"><body>\n\t<xf:select1 id="s" />\n</body></html>';
		const added = apply(self, editChoices(self, parseXml(self)!, select(self), { items: [{ label: 'A', value: 'a' }], attrs: {} }));
		assert.deepStrictEqual(readChoices(select(added)), { items: [{ label: 'A', value: 'a' }] });
		assert.ok(added.includes('<xf:select1 id="s">\n\t\t<xf:choices>') && added.includes('\n\t</xf:select1>'), added);
	});

	test('그리드 select 컬럼(w2 접두사): 항목 → 바인딩, 컬럼 속성 유지', () => {
		const text = '<w2:gridView xmlns:w2="http://www.inswave.com/websquare"><w2:gBody><w2:row>\n\t<w2:column id="stat" inputType="select" allOption="" chooseOption="" ref="">\n\t\t<w2:choices>\n\t\t\t<w2:item><w2:label><![CDATA[미사용]]></w2:label><w2:value><![CDATA[F]]></w2:value></w2:item>\n\t\t</w2:choices>\n\t</w2:column>\n</w2:row></w2:gBody></w2:gridView>';
		const root = parseXml(text)!, column = root.children[0].children[0].children[0];
		assert.deepStrictEqual(readChoices(column), { items: [{ label: '미사용', value: 'F' }] });
		const itemset = { nodeset: 'data:dlt_stat', label: 'nm', value: 'cd' };
		const updated = apply(text, editChoices(text, root, column, { items: [], itemset, attrs: { chooseOption: 'true' } }));
		const after = parseXml(updated)!.children[0].children[0].children[0];
		assert.deepStrictEqual(readChoices(after), { items: [], itemset });
		assert.deepStrictEqual(after.attrs, { id: 'stat', inputType: 'select', allOption: '', chooseOption: 'true', ref: '' });
		assert.ok(updated.includes('\t\t<w2:choices>\n\t\t\t<w2:itemset nodeset="data:dlt_stat">\n\t\t\t\t<w2:label ref="nm"></w2:label>'), updated);
	});

	test('checkbox(xf:select): 정렬 속성만 바뀌고 빈 rows=""·falseValue는 그대로', () => {
		const text = '<html xmlns:xf="http://www.w3.org/2002/xforms"><body><xf:select id="chk" appearance="full" cols="" rows="" ref="data:dl.m07" falseValue="0"><xf:choices><xf:item><xf:label><![CDATA[7월]]></xf:label><xf:value><![CDATA[1]]></xf:value></xf:item></xf:choices></xf:select></body></html>';
		const root = parseXml(text)!, node = select(text);
		const edit = editChoices(text, root, node, { items: [{ label: '7월', value: '1' }], attrs: { ref: 'data:dl.m07', cols: '4', rows: '' } })!;
		assert.strictEqual(edit.end, text.indexOf('>', edit.start) + 1, '항목은 그대로라 시작 태그만');
		assert.deepStrictEqual(select(apply(text, edit)).attrs, { id: 'chk', appearance: 'full', cols: '4', rows: '', ref: 'data:dl.m07', falseValue: '0' });
	});

	test('팝업이 다 못 담는 구조(항목에 다른 자식·주석)는 거부해 원문을 잃지 않음', () => {
		const odd = '<html xmlns:xf="http://www.w3.org/2002/xforms"><body><xf:select1 id="s"><xf:choices><xf:item><xf:label>A</xf:label><xf:value>a</xf:value><xf:hint>h</xf:hint></xf:item></xf:choices></xf:select1></body></html>';
		assert.ok('error' in readChoices(select(odd)));
		assert.throws(() => editChoices(odd, parseXml(odd)!, select(odd), { items: [], attrs: {} }), /Source/);
		const commented = '<html xmlns:xf="http://www.w3.org/2002/xforms"><body><xf:select1 id="s"><xf:choices><!-- 주석 --><xf:item><xf:label>A</xf:label><xf:value>a</xf:value></xf:item></xf:choices></xf:select1></body></html>';
		assert.throws(() => editChoices(commented, parseXml(commented)!, select(commented), { items: [], attrs: {} }), /주석/);
	});
});

suite('Submission creation', () => {
	test('고유 ID·필수 속성·문자 이스케이프·CRLF 보존', () => {
		const text = '<html xmlns:xf="http://www.w3.org/2002/xforms"><head><xf:model>\r\n\t<xf:submission id="submission1"/>\r\n</xf:model></head></html>';
		const root = parseXml(text)!;
		const model = root.children[0].children[0];
		assert.strictEqual(nextSubmissionId(root), 'submission2');
		const attrs = { id: 'submission2', ref: 'data:json,request&more\ndata:json,other', target: 'data:json,response', action: '/api/search?q=1&x=2', method: 'post', mode: 'asynchronous', mediatype: 'application/json' };
		// 빈 이벤트 칸은 속성을 만들지 않는다
		const fields: SubmissionFields = { ...attrs, 'ev:submit': '', 'ev:submitdone': '', 'ev:submiterror': '' };
		const edit = addSubmissionNode(text, root, model, fields);
		const updated = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
		const created = parseXml(updated)!.children[0].children[0].children[1];
		assert.strictEqual(created.tag, 'xf:submission');
		assert.deepStrictEqual(created.attrs, attrs);
		assert.ok(updated.includes('request&amp;more'));
		assert.ok(updated.includes('&#10;'));
		assert.ok(!/(?<!\r)\n/.test(updated), '기존 CRLF 유지');
		assert.throws(() => addSubmissionNode(text, root, model, { ...fields, id: 'submission1' }), /이미 사용 중/);
		assert.throws(() => addSubmissionNode(text, root, model, { ...fields, method: 'patch' }), /지원하지 않는/);
	});

	test('기존 Submission 수정: 시작 태그만 교체, 다른 속성·자식 유지, 빈 값은 삭제, id 고유', () => {
		const text = '<html xmlns:xf="http://www.w3.org/2002/xforms" xmlns:ev="http://www.w3.org/2001/xml-events"><head><xf:model><xf:submission id="sbm_a" method="post" custom="keep" ev:submitdone="scwin.done"><xf:x/></xf:submission><xf:submission id="sbm_b"/></xf:model></head></html>';
		const root = parseXml(text)!;
		const node = root.children[0].children[0].children[0];
		const fields = { ...submissionFields(node), id: 'sbm_c', action: '/api?a=1&b=2', method: 'PATCH_CUSTOM', mode: '' };
		const edit = editSubmissionNode(text, root, node, fields)!;
		const updated = parseXml(text.slice(0, edit.start) + edit.replacement + text.slice(edit.end))!.children[0].children[0].children[0];
		assert.deepStrictEqual(updated.attrs, { id: 'sbm_c', method: 'PATCH_CUSTOM', custom: 'keep', 'ev:submitdone': 'scwin.done', action: '/api?a=1&b=2' });
		assert.strictEqual(updated.children[0].tag, 'xf:x');
		assert.strictEqual(editSubmissionNode(text, root, node, submissionFields(node)), undefined, '바뀐 게 없으면 편집 없음');
		assert.throws(() => editSubmissionNode(text, root, node, { ...fields, id: 'sbm_b' }), /이미 사용 중/);
	});

	test('이벤트 칸: 바꾼 칸만 적용(손대지 않은 빈 속성 유지), 조상에 xmlns:ev가 있으면 다시 선언하지 않음', () => {
		const text = '<html xmlns:xf="http://www.w3.org/2002/xforms" xmlns:ev="http://www.w3.org/2001/xml-events"><head><xf:model><xf:submission id="sbm_a" mode="" ev:submit=""/></xf:model></head></html>';
		const root = parseXml(text)!;
		const model = root.children[0].children[0], node = model.children[0];
		const edit = editSubmissionNode(text, root, node, { ...submissionFields(node), 'ev:submitdone': 'scwin.sbm_a_submitdone' })!;
		const updated = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
		assert.deepStrictEqual(parseXml(updated)!.children[0].children[0].children[0].attrs, { id: 'sbm_a', mode: '', 'ev:submit': '', 'ev:submitdone': 'scwin.sbm_a_submitdone' });
		const add = addSubmissionNode(text, root, model, { ...newSubmissionFields(root), 'ev:submiterror': 'scwin.err' });
		assert.ok(add.replacement.includes('ev:submiterror="scwin.err"') && !add.replacement.includes('xmlns:ev'), add.replacement);
	});

	test('gridView에 dataList 바인딩: 신규 생성·바디 업데이트(기존 컬럼 보존)·바인드 업데이트', () => {
		const text = '<w2:root xmlns:w2="http://www.inswave.com/websquare"><w2:dataList id="dl"><w2:columnInfo><w2:column id="a" name="에이"/><w2:column id="b"/></w2:columnInfo></w2:dataList>\n<w2:gridView id="g"/></w2:root>';
		const root = parseXml(text)!;
		const [list, grid] = root.children;
		const apply = (t: string, e?: { start: number; end: number; replacement: string }) => e ? t.slice(0, e.start) + e.replacement + t.slice(e.end) : t;
		const created = apply(text, bindGridView(text, root, grid, list, 'new'));
		const g1 = parseXml(created)!.children[1];
		assert.strictEqual(g1.attrs.dataList, 'data:dl');
		assert.deepStrictEqual(g1.children.map(c => c.tag), ['w2:header', 'w2:gBody']);
		assert.deepStrictEqual(g1.children[0].children[0].children.map(c => c.attrs.value), ['에이', 'b']);
		assert.deepStrictEqual(g1.children[1].children[0].children.map(c => c.attrs.id), ['a', 'b']);
		const widened = created.replace('id="a" displayMode', 'id="a" width2="300" displayMode');
		const r2 = parseXml(widened)!;
		const body = parseXml(apply(widened, bindGridView(widened, r2, r2.children[1], r2.children[0], 'body')))!.children[1];
		assert.strictEqual(body.children[1].children[0].children[0].attrs.width2, '300', '같은 id 바디 컬럼은 원문 유지');
		assert.strictEqual(bindGridView(created, parseXml(created)!, g1, list, 'bind'), undefined, '이미 같은 바인딩');
		assert.throws(() => bindGridView(text, root, list, list, 'new'), /gridView/);
		// 바인드 업데이트 + footer·subTotal 체크: 없던 둘을 gBody 뒤에 subTotal → footer 순으로, 컬럼 수는 dataList에 맞춰
		const r3 = parseXml(created)!;
		const g3 = parseXml(apply(created, bindGridView(created, r3, r3.children[1], r3.children[0], 'bind', { footer: true, subTotal: true })))!.children[1];
		assert.deepStrictEqual(g3.children.map(c => c.tag), ['w2:header', 'w2:gBody', 'w2:subTotal', 'w2:footer']);
		assert.strictEqual(g3.children[3].children[0].children.length, 2);
		// subTotal 두 개 + 신규 생성: 전부 지우고 체크했으면 1개만
		const two = created.replace('</w2:gridView>', '<w2:subTotal id="s1"/><w2:subTotal id="s2"/></w2:gridView>');
		const r4 = parseXml(two)!;
		const newOf = (extras?: { subTotal?: boolean }) => parseXml(apply(two, bindGridView(two, r4, r4.children[1], r4.children[0], 'new', extras)))!.children[1];
		assert.deepStrictEqual(newOf().children.map(c => c.tag), ['w2:header', 'w2:gBody']);
		assert.deepStrictEqual(newOf({ subTotal: true }).children.map(c => c.tag), ['w2:header', 'w2:gBody', 'w2:subTotal']);
		// 다단 subTotal + 바인드 업데이트 체크: 전부 컬럼 수만 맞추고 targetColumnID 등 속성 유지
		const multi = created.replace('</w2:gridView>', '<w2:subTotal id="s1" targetColumnID="a"><w2:row id="sr1"><w2:column id="x"/></w2:row></w2:subTotal><w2:subTotal id="s2" targetColumnID="b"/></w2:gridView>');
		const r5 = parseXml(multi)!;
		const subs = parseXml(apply(multi, bindGridView(multi, r5, r5.children[1], r5.children[0], 'bind', { subTotal: true })))!.children[1].children.filter(c => c.tag === 'w2:subTotal');
		assert.deepStrictEqual(subs.map(s => [s.attrs.id, s.attrs.targetColumnID, s.children[0].attrs.id, s.children[0].children.length]), [['s1', 'a', 'sr1', 2], ['s2', 'b', subs[1].children[0].attrs.id, 2]]);
	});

	test('다중 선택: 붙여넣기(id 서로 안 겹침)·이동(문서 순서로 모아서)', () => {
		const text = '<body>\n\t<a id="x"/>\n\t<b id="y"/>\n\t<c id="z"/>\n</body>';
		const root = parseXml(text)!;
		const [x, y, z] = root.children;
		const pasted = pasteNode(text, root, z, ['\t<a id="x"/>', '\t<a id="x"/>']);
		assert.strictEqual(text.slice(0, pasted.start) + pasted.replacement + text.slice(pasted.end), '<body>\n\t<a id="x"/>\n\t<b id="y"/>\n\t<c id="z"/>\n\t<a id="x_copy1"/>\n\t<a id="x_copy2"/>\n</body>');
		const moved = [...moveNode(text, [z, x], y, 'after')].sort((a, b) => b.start - a.start).reduce((t, e) => t.slice(0, e.start) + e.replacement + t.slice(e.end), text);
		assert.strictEqual(moved, '<body>\n\t<b id="y"/>\n\t<a id="x"/>\n\t<c id="z"/>\n</body>');
	});

	test('그리드 우클릭 subTotal·footer 추가: 컬럼 수는 gBody, subTotal은 마지막 subTotal 뒤, footer는 하나만', () => {
		const text = '<w2:gridView xmlns:w2="http://www.inswave.com/websquare" id="g"><w2:gBody id="b"><w2:row id="r"><w2:column id="a"/><w2:column id="c"/></w2:row></w2:gBody><w2:footer id="f"/></w2:gridView>';
		const root = parseXml(text)!;
		const e = addGridPart(text, root, root, 'subTotal');
		const g = parseXml(text.slice(0, e.start) + e.replacement + text.slice(e.end))!;
		assert.deepStrictEqual(g.children.map(c => c.tag), ['w2:gBody', 'w2:subTotal', 'w2:footer']);
		assert.strictEqual(g.children[1].children[0].children.length, 2);
		assert.throws(() => addGridPart(text, root, root, 'footer'), /이미/);
		// Header 추가: 없으면 맨 앞에 새 header(칸 수 = gBody), 있으면 header row 하나 더
		const h1 = addGridPart(text, root, root, 'header');
		const withHeader = text.slice(0, h1.start) + h1.replacement + text.slice(h1.end);
		const hg = parseXml(withHeader)!;
		assert.deepStrictEqual([hg.children[0].tag, hg.children[0].children[0].children.length], ['w2:header', 2]);
		const h2 = addGridPart(withHeader, hg, hg, 'header');
		assert.strictEqual(parseXml(withHeader.slice(0, h2.start) + h2.replacement + withHeader.slice(h2.end))!.children[0].children.length, 2);
		const apply = (t: string, es: { start: number; end: number; replacement: string }[]) => [...es].sort((x, y) => y.start - x.start).reduce((s, x) => s.slice(0, x.start) + x.replacement + s.slice(x.end), t);
		// Column 추가: 우클릭한 a 바로 뒤, footer는 빈(자체 닫힘) 자리라 건너뜀
		const col = parseXml(apply(text, addGridColumn(text, root, root, root.children[0].children[0].children[0].index)))!;
		assert.deepStrictEqual(col.children[0].children[0].children.map(c => c.attrs.id), ['a', 'column1', 'c']);
		const left = parseXml(apply(text, addGridColumn(text, root, root, root.children[0].children[0].children[0].index, 'left')))!;
		assert.deepStrictEqual(left.children[0].children[0].children.map(c => c.attrs.id), ['column1', 'a', 'c'], '왼쪽: 클릭한 칸 앞');
		// 병합 헤더: | m(2칸) | n | / | c1 | c2 | c3 | — n 왼쪽이면 실제 열 2 앞, c1 오른쪽이면 m을 가로질러 colSpan 3
		const merged = '<w2:gridView xmlns:w2="http://www.inswave.com/websquare" id="g"><w2:header id="h"><w2:row id="h1"><w2:column id="m" colSpan="2"/><w2:column id="n"/></w2:row><w2:row id="h2"><w2:column id="c1"/><w2:column id="c2"/><w2:column id="c3"/></w2:row></w2:header><w2:gBody id="b"><w2:row id="br"><w2:column id="b1"/><w2:column id="b2"/><w2:column id="b3"/></w2:row></w2:gBody></w2:gridView>';
		const mr = parseXml(merged)!;
		const ids = (t: string) => parseXml(t)!.children.flatMap(s => s.children.map(r => r.children.map(c => c.attrs.id + (c.attrs.colSpan ? `:${c.attrs.colSpan}` : '')).join(',')));
		const n = mr.children[0].children[0].children[1];
		assert.deepStrictEqual(ids(apply(merged, addGridColumn(merged, mr, mr, n.index, 'left'))), ['m:2,column1,n', 'c1,c2,column2,c3', 'b1,b2,column3,b3']);
		const c1 = mr.children[0].children[1].children[0];
		assert.deepStrictEqual(ids(apply(merged, addGridColumn(merged, mr, mr, c1.index, 'right'))), ['m:3,n', 'c1,column1,c2,c3', 'b1,column2,b2,b3']);
		// Row 추가: 같은 칸 수의 row가 기존 row 뒤
		const row = parseXml(apply(text, [addGridRow(text, root, root)]))!;
		assert.deepStrictEqual(row.children[0].children.map(r => r.children.length), [2, 2]);
	});

	test('빈 xf:model에 추가 요청을 VS Code 문서 편집으로 적용', async () => {
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-submission-')), 'screen.xml');
		fs.writeFileSync(file, '<html xmlns:xf="http://www.w3.org/2002/xforms"><head><xf:model/></head></html>');
		const document = await vscode.workspace.openTextDocument(file);
		const model = parseXml(document.getText())!.children[0].children[0];
		const fields: SubmissionFields = { ...newSubmissionFields(model), id: 'submission1', action: '/api' };
		assert.ok(await applyNodeEdit(document, { type: 'addSubmission', version: document.version, index: model.index, popup: 'p', fields }));
		assert.strictEqual(parseXml(document.getText())!.children[0].children[0].children[0].attrs.id, 'submission1');
	});
});

suite('DataMap/DataList fields', () => {
	test('행 추가·순서 변경·삭제와 DataMap 값을 한 편집으로 반영하고 기존 속성을 보존', () => {
		const base = '<html xmlns:w2="http://www.inswave.com/websquare"><w2:dataMap id="dma" baseNode="map"><w2:keyInfo><w2:key id="old" name="Old" dataType="text" custom="keep"/></w2:keyInfo><w2:data use="false"><old custom="value-attr">old value</old><external>x</external></w2:data></w2:dataMap></html>';
		const root = parseXml(base)!;
		const map = root.children[0];
		const change = editDataFields(base, root, map, [
			{ id: 'new', name: 'New', dataType: 'number', length: '10', encYN: true, value: '42' },
			{ sourceIndex: map.children[0].children[0].index, id: 'old', name: 'Renamed', dataType: 'text', length: '', encYN: false, value: 'changed' },
		])!;
		const result = base.slice(0, change.start) + change.replacement + base.slice(change.end);
		const edited = parseXml(result)!.children[0];
		assert.deepStrictEqual(edited.children[0].children.map(c => c.attrs.id), ['new', 'old']);
		assert.strictEqual(edited.children[0].children[0].attrs.length, '10');
		assert.strictEqual(edited.children[0].children[0].attrs.encYN, 'true');
		assert.strictEqual(edited.children[0].children[1].attrs.custom, 'keep');
		assert.ok(result.includes('<w2:data use="false">'));
		assert.ok(result.includes('<old custom="value-attr">changed</old>'));
		assert.ok(result.includes('<external>x</external>'));
		assert.deepStrictEqual(edited.children[1].children.map(c => [c.tag, c.text]), [['new', '42'], ['old', 'changed'], ['external', 'x']]);
		assert.throws(() => editDataFields(base, root, map, [{ id: 'bad space', name: '', dataType: 'text', length: '', encYN: false }]));
		const removed = editDataFields(base, root, map, [])!;
		const without = base.slice(0, removed.start) + removed.replacement + base.slice(removed.end);
		assert.ok(!without.includes('<old>'));
		assert.ok(without.includes('<external>x</external>'));
	});

	test('DataMap/DataList 자체 id도 바꿀 수 있고, 문서 전체에서 고유해야 한다', () => {
		const base = '<html xmlns:w2="http://www.inswave.com/websquare"><w2:dataCollection><w2:dataMap id="dma"><w2:keyInfo/></w2:dataMap><w2:dataList id="dlt"><w2:columnInfo/></w2:dataList></w2:dataCollection></html>';
		const root = parseXml(base)!;
		const collection = root.children[0];
		const map = collection.children[0];
		// 다른 곳에서 이미 쓰는 id(dlt)로는 못 바꾼다
		assert.throws(() => editDataFields(base, root, map, [], 'dlt'), /이미 사용 중/);
		// 형식이 안 맞는 id도 거부
		assert.throws(() => editDataFields(base, root, map, [], 'bad id'), /올바른 ID/);
		// 문제없는 새 id면 바뀐다
		const change = editDataFields(base, root, map, [], 'renamed')!;
		const result = base.slice(0, change.start) + change.replacement + base.slice(change.end);
		assert.strictEqual(parseXml(result)!.children[0].children[0].attrs.id, 'renamed');
	});

	test('DataList 컬럼을 생성하고 keyInfo가 아닌 columnInfo를 편집', async () => {
		const base = '<html xmlns:w2="http://www.inswave.com/websquare"><w2:dataList id="dl"><w2:columnInfo custom="keep"/></w2:dataList></html>';
		const root = parseXml(base)!;
		const list = root.children[0];
		const change = editDataFields(base, root, list, [{ id: 'col1', name: 'name1', dataType: 'date', length: '', encYN: false }])!;
		const result = base.slice(0, change.start) + change.replacement + base.slice(change.end);
		assert.strictEqual(parseXml(result)!.children[0].children[0].children[0].tag, 'w2:column');
		assert.strictEqual(parseXml(result)!.children[0].children[0].attrs.custom, 'keep');
		assert.ok(!result.includes('<w2:data '));
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-fields-')), 'screen.xml');
		fs.writeFileSync(file, base);
		const document = await vscode.workspace.openTextDocument(file);
		assert.ok(await applyNodeEdit(document, { type: 'editDataFields', version: document.version, index: list.index, popup: 'p', fields: [{ id: 'col1', name: 'name1', dataType: 'date', length: '', encYN: false }], id: 'renamed' }));
		assert.strictEqual(parseXml(document.getText())!.children[0].children[0].children[0].attrs.id, 'col1');
		assert.strictEqual(parseXml(document.getText())!.children[0].attrs.id, 'renamed');
	});
});

suite('Data popup geometry', () => {
	test('8방향 리사이즈와 최소 크기·화면 경계', () => {
		const start = { x: 100, y: 100, width: 500, height: 400 };
		const expected = [
			{ x: 100, y: 130, width: 500, height: 370 }, { x: 100, y: 100, width: 500, height: 430 },
			{ x: 100, y: 100, width: 520, height: 400 }, { x: 120, y: 100, width: 480, height: 400 },
			{ x: 120, y: 130, width: 480, height: 370 }, { x: 100, y: 130, width: 520, height: 370 },
			{ x: 120, y: 100, width: 480, height: 430 }, { x: 100, y: 100, width: 520, height: 430 },
		];
		resizeEdges.forEach((edge, i) => assert.deepStrictEqual(resizeBox(start, edge, 20, 30, 1000, 800), expected[i]));
		assert.deepStrictEqual(resizeBox(start, 'nw', 999, 999, 1000, 800), { x: 200, y: 240, width: 400, height: 260 });
		assert.deepStrictEqual(resizeBox(start, 'se', 999, 999, 700, 600), { x: 100, y: 100, width: 600, height: 500 });
	});
});

suite('데이터 id 바꾸기', () => {
	test('데이터 id 바꾸기: 바인딩(ref·nodeset·dataList·json·bind)도 같이, 컬럼 이름·더 긴 id·Script는 그대로, 알림', async () => {
		const xml = `<html xmlns:w2="http://www.inswave.com/websquare"><head><w2:dataCollection>
<w2:dataList id="dlt_a"><w2:columnInfo><w2:column id="dlt_a"/></w2:columnInfo></w2:dataList>
<w2:dataList id="dlt_a2"><w2:columnInfo/></w2:dataList><w2:linkedDataList id="ldt" bind="dlt_a"/>
<xf:submission ref='data:json,[{"id":"dlt_a","action":"modified"},"dma_x"]' target="data:json,dlt_a"/>
<script>scwin.f = () => dlt_a.getRowCount();</script>
</w2:dataCollection></head><body>
<w2:gridView dataList="data:dlt_a"/><xf:select1 ref="data:dlt_a.dlt_a"><xf:itemset nodeset="data:dlt_a2"/></xf:select1><xf:input ref="data:dlt_a2.x"/>
</body></html>`;
		const doc = await vscode.workspace.openTextDocument({ content: xml, language: 'xml' });
		const list = findNode(parseXml(xml)!, n => n.attrs.id === 'dlt_a' && n.tag === 'w2:dataList')!;
		const notes: string[] = [];
		assert.ok(await applyNodeEdit(doc, { type: 'setAttr', version: doc.version, index: list.index, name: 'id', value: 'dlt_b' }, m => notes.push(m)));
		assert.strictEqual(doc.getText(), xml.replace('dataList id="dlt_a"', 'dataList id="dlt_b"').replace('bind="dlt_a"', 'bind="dlt_b"')
			.replace('"id":"dlt_a"', '"id":"dlt_b"').replace('data:json,dlt_a"', 'data:json,dlt_b"').replace('dataList="data:dlt_a"', 'dataList="data:dlt_b"')
			.replace('ref="data:dlt_a.dlt_a"', 'ref="data:dlt_b.dlt_a"'));
		assert.deepStrictEqual(notes, ['바인딩 5곳도 함께 변경했습니다. `dlt_a` → `dlt_b`']);
		// DataList 팝업에서 id를 바꿔도 같이. 참조가 없으면 알림 없음
		const two = findNode(parseXml(doc.getText())!, n => n.attrs.id === 'dlt_a2')!;
		assert.ok(await applyNodeEdit(doc, { type: 'editDataFields', version: doc.version, index: two.index, popup: 'p', fields: [], id: 'dlt_c' }, m => notes.push(m)));
		assert.ok(doc.getText().includes('nodeset="data:dlt_c"') && doc.getText().includes('ref="data:dlt_c.x"'), doc.getText());
		assert.strictEqual(notes.at(-1), '바인딩 2곳도 함께 변경했습니다. `dlt_a2` → `dlt_c`');
		const ldt = findNode(parseXml(doc.getText())!, n => n.attrs.id === 'ldt')!;
		assert.ok(await applyNodeEdit(doc, { type: 'setAttr', version: doc.version, index: ldt.index, name: 'id', value: 'ldt2' }, m => notes.push(m)));
		assert.strictEqual(notes.length, 2, '참조 없으면 알림 없음');
	});


	test('데이터 컬럼·키 id 바꾸기: data:id.col·바인딩된 그리드 본문 column·itemset label/value도 같이(다른 데이터·헤더·더 긴 이름은 그대로)', async () => {
		const xml = `<html xmlns:w2="http://www.inswave.com/websquare"><head><w2:dataCollection>
<w2:dataList id="dataList1"><w2:columnInfo><w2:column id="testCol" dataType="text"/><w2:column id="b"/></w2:columnInfo></w2:dataList>
<w2:dataMap id="dma"><w2:keyInfo><w2:key id="k"/></w2:keyInfo></w2:dataMap>
</w2:dataCollection></head><body>
<w2:gridView dataList="data:dataList1"><w2:header><w2:row><w2:column id="testCol"/></w2:row></w2:header><w2:gBody><w2:row><w2:column id="testCol"/><w2:column id="testCol2"/></w2:row></w2:gBody></w2:gridView>
<w2:gridView dataList="data:other"><w2:gBody><w2:row><w2:column id="testCol"/></w2:row></w2:gBody></w2:gridView>
<xf:input ref="data:dataList1.testCol"/><xf:input ref="data:dataList1.testCol2"/><xf:input ref="data:dma.k"/>
<xf:select1><xf:choices><xf:itemset nodeset="data:dataList1"><xf:label ref="b"/><xf:value ref="testCol"/></xf:itemset></xf:choices></xf:select1>
</body></html>`;
		const doc = await vscode.workspace.openTextDocument({ content: xml, language: 'xml' });
		const notes: string[] = [];
		const col = findNode(parseXml(xml)!, n => n.tag === 'w2:column' && n.attrs.dataType === 'text')!;
		assert.ok(await applyNodeEdit(doc, { type: 'setAttr', version: doc.version, index: col.index, name: 'id', value: 'testCol2x' }, m => notes.push(m)));
		assert.strictEqual(doc.getText(), xml.replace('<w2:column id="testCol" dataType', '<w2:column id="testCol2x" dataType')
			.replace('<w2:gBody><w2:row><w2:column id="testCol"/><w2:column id="testCol2"/>', '<w2:gBody><w2:row><w2:column id="testCol2x"/><w2:column id="testCol2"/>')
			.replace('ref="data:dataList1.testCol"', 'ref="data:dataList1.testCol2x"').replace('<xf:value ref="testCol"/>', '<xf:value ref="testCol2x"/>'));
		assert.deepStrictEqual(notes, ['바인딩 3곳도 함께 변경했습니다. `dataList1.testCol` → `testCol2x`']);
		// 팝업: 데이터 id와 키를 한 번에(키 바꾸기)
		const map = findNode(parseXml(doc.getText())!, n => n.attrs.id === 'dma')!;
		const key = findNode(map, n => n.tag === 'w2:key')!;
		assert.ok(await applyNodeEdit(doc, { type: 'editDataFields', version: doc.version, index: map.index, popup: 'p', id: 'dma2',
			fields: [{ sourceIndex: key.index, id: 'k2', name: '', dataType: 'text', length: '', encYN: false }] }, m => notes.push(m)));
		assert.ok(doc.getText().includes('ref="data:dma2.k2"'), doc.getText());
		assert.strictEqual(notes.at(-1), '바인딩 1곳도 함께 변경했습니다. `dma` → `dma2`, `dma.k` → `k2`');
	});
});
