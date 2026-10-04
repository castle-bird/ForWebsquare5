import * as assert from 'assert';
import * as vscode from 'vscode';
import { findNode, parseXml, type XmlNode } from '../core/xmlModel';
import { applyNodeEdit } from '../vscode/documentEdit';
import { idConflict, problemAncestors, screenProblems } from '../core/check';

suite('화면 점검·중복 id', () => {
	test('경고 조상: 여러 가지·부모 자체 경고·없는 index를 포함해 기존 경로 탐색과 동일', () => {
		const root = parseXml('<html><body><a><b/><c/></a><d><e/></d><f/></body></html>')!;
		const a = root.children[0].children[0], d = root.children[0].children[1];
		const problems = new Map([a.index, a.children[0].index, a.children[1].index, d.children[0].index, 999].map(i => [i, ['경고']]));
		assert.deepStrictEqual(problemAncestors(root, problems), new Set([root.index, root.children[0].index, a.index, d.index]));
		assert.deepStrictEqual(problemAncestors(root, new Map([[a.index, ['경고']]])), new Set([root.index, root.children[0].index]), '자기 경고만 있으면 자기 자신은 조상에서 제외');
		assert.deepStrictEqual(problemAncestors(root, new Map([[root.index, ['경고']]])), new Set());
		assert.deepStrictEqual(problemAncestors(root, new Map()), new Set());
	});

	test('화면 점검: id 범위(화면·그리드 부분·데이터 컬럼), 없는 데이터·컬럼 바인딩, Script에 없는 이벤트 함수', () => {
		const xml = `<html xmlns:w2="http://www.inswave.com/websquare" xmlns:ev="urn:ev"><head><w2:dataCollection>
<w2:dataList id="dlt"><w2:columnInfo><w2:column id="a"/><w2:column id="b"/></w2:columnInfo></w2:dataList>
<w2:dataMap id="dma"><w2:keyInfo><w2:key id="a"/></w2:keyInfo></w2:dataMap><w2:linkedDataList id="ldt" bind="dlt"/>
<xf:submission id="sbm" ref='data:json,[{"id":"dlt","action":"modified"},"dma_none"]' target="data:json,dma" ev:submitdone="scwin.sbm_done"/>
</w2:dataCollection></head><body>
<w2:gridView id="grd" dataList="data:dlt"><w2:header><w2:row><w2:column id="a"/></w2:row></w2:header><w2:gBody><w2:row><w2:column id="a"/><w2:column id="a"/></w2:row></w2:gBody></w2:gridView>
<xf:input id="dlt" ref="data:dlt.c"/><xf:input id="i2" ref="data:ldt.any"/><xf:input id="i3" ref="data:dma.a" ev:onclick="scwin.i3_onclick"/><xf:input id="i4" ev:onblur="scwin.gone"/>
</body></html>`;
		const root = parseXml(xml)!;
		const byId = (id: string, tag?: string) => findNode(root, n => n.attrs.id === id && (!tag || n.tag === tag))!;
		const problems = screenProblems(root, 'scwin.sbm_done = function () {};\nscwin.i3_onclick = async function () {};');
		const of = (n: XmlNode) => problems.get(n.index);
		assert.deepStrictEqual(of(byId('dlt', 'w2:dataList')), ['ID가 중복되었습니다. `dlt` (2곳)'], '화면 전체 범위');
		assert.deepStrictEqual(of(byId('dlt', 'xf:input')), ['ID가 중복되었습니다. `dlt` (2곳)', 'dataList에 존재하지 않는 ID입니다. `dlt.c`']);
		const body = findNode(root, n => n.tag === 'w2:gBody')!;
		assert.deepStrictEqual(body.children[0].children.map(of), [['ID가 중복되었습니다. `a` (2곳)'], ['ID가 중복되었습니다. `a` (2곳)']], '같은 gBody 안');
		assert.strictEqual(of(findNode(root, n => n.tag === 'w2:header')!.children[0].children[0]), undefined, 'header·gBody·데이터 컬럼은 따로');
		assert.strictEqual(of(byId('a', 'w2:column')), undefined);
		assert.strictEqual(of(byId('sbm')), undefined, '화면에 없는 데이터(스크립트에서 만듦)는 경고 안 함, 정의된 함수는 통과');
		assert.strictEqual(screenProblems(parseXml('<html><body><a ref="data:dlt_code.x"/><b nodeset="data:dlt_code"/></body></html>')!).size, 0, '동적 생성 데이터 바인딩');
		assert.strictEqual(of(byId('i2')), undefined, '컬럼을 모르는 linkedDataList는 컬럼 안 봄');
		assert.strictEqual(of(byId('i3')), undefined);
		assert.deepStrictEqual(of(byId('i4')), ['등록되지 않은 handler가 적용되어 있습니다. `scwin.gone`']);
		// 바꾸기 검사: 같은 범위만
		assert.strictEqual(idConflict(root, byId('i2').index, 'i3'), '이미 사용 중인 ID입니다. `i3`');
		assert.strictEqual(idConflict(root, byId('i2').index, 'a'), undefined, '그리드·데이터 컬럼 id와는 안 겹침');
		assert.strictEqual(idConflict(root, body.children[0].children[0].index, 'x'), undefined);
		assert.strictEqual(idConflict(root, body.children[0].children[0].index, 'a'), '이미 사용 중인 ID입니다. `a`', '같은 gBody의 다른 칸');
		assert.strictEqual(idConflict(root, findNode(root, n => n.tag === 'w2:header')!.children[0].children[0].index, 'a'), undefined, '자기 id 그대로');
	});

	test('겹치는 id로 바꾸기는 막고 알림(F2·Property·그리드 칸 편집의 also)', async () => {
		const xml = '<html><body><a id="x"/><b id="y"/></body></html>';
		const doc = await vscode.workspace.openTextDocument({ content: xml, language: 'xml' });
		const b = parseXml(xml)!.children[0].children[1], notes: string[] = [];
		assert.strictEqual(await applyNodeEdit(doc, { type: 'setAttr', version: doc.version, index: b.index, name: 'id', value: 'x' }, m => notes.push(m)), false);
		assert.strictEqual(await applyNodeEdit(doc, { type: 'setAttr', version: doc.version, index: b.index, name: 'value', value: 'v', also: [{ name: 'id', value: 'x' }] }, m => notes.push(m)), false);
		assert.strictEqual(doc.getText(), xml, '안 바뀜');
		assert.deepStrictEqual(notes, ['이미 사용 중인 ID입니다. `x`', '이미 사용 중인 ID입니다. `x`']);
		assert.ok(await applyNodeEdit(doc, { type: 'setAttr', version: doc.version, index: b.index, name: 'id', value: 'z' }));
	});
});
