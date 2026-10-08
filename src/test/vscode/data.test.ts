import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { findNode, parseXml } from '../../core/xmlModel';
import { editDataFields } from '../../core/data';
import { newSubmissionFields, type SubmissionFields } from '../../core/submission';
import { applyNodeEdit } from '../../vscode/documentEdit';

suite('DataCollection creation (VS Code)', () => {
	test('추가 요청을 VS Code 문서 편집으로 적용', async () => {
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-data-')), 'screen.xml');
		fs.writeFileSync(file, '<html xmlns:w2="http://www.inswave.com/websquare"><head><w2:dataCollection/></head></html>');
		const document = await vscode.workspace.openTextDocument(file);
		const collection = parseXml(document.getText())!.children[0].children[0];
		assert.ok(await applyNodeEdit(document, { type: 'addData', version: document.version, index: collection.index, kind: 'dataList' }));
		assert.strictEqual(parseXml(document.getText())!.children[0].children[0].children[0].attrs.id, 'dataList1');
	});
});

suite('Submission creation (VS Code)', () => {
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

suite('DataMap/DataList fields (VS Code)', () => {
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

suite('데이터 id 바꾸기 (VS Code)', () => {
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
