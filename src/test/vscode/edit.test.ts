import * as assert from 'assert';
import * as vscode from 'vscode';
import { findNode, parseXml } from '../../core/xmlModel';
import { gridPartCells } from '../../core/grid';
import { applyCodeEdit, applyNodeEdit } from '../../vscode/documentEdit';
import { SCREEN } from '../helpers';

suite('edit (VS Code)', () => {
	test('editGridCells: 칸마다 여러 속성 바꾸기·지우기, 칸끼리 id 맞바꾸기는 되고 겹치면 안 바꿈', async () => {
		const doc = await vscode.workspace.openTextDocument({ language: 'xml', content: '<html xmlns:w2="urn:w2"><body><w2:gridView id="g">'
			+ '<w2:header><w2:row><w2:column id="h1" value="이름" class="req"/><w2:column id="h2"/></w2:row></w2:header>'
			+ '<w2:gBody><w2:row><w2:column id="a" width="70"/><w2:column id="b"/></w2:row></w2:gBody></w2:gridView></body></html>' });
		const grid = findNode(parseXml(doc.getText())!, n => n.attrs.id === 'g')!;
		const [h1, h2] = gridPartCells(grid, 'header')!, [a, b] = gridPartCells(grid, 'gBody')!;
		assert.deepStrictEqual([h1.label, h2.label, b.label], ['0,0', '0,1', '0,1']);
		const before = doc.getText();
		await vscode.window.showTextDocument(doc);
		assert.ok(await applyNodeEdit(doc, { type: 'editGridCells', version: doc.version, index: grid.index, popup: 'p', cells: [
			{ index: h1.index, attrs: { value: '성명', class: null } }, { index: a.index, attrs: { id: 'b', width: '90' } }, { index: b.index, attrs: { id: 'a' } }] }));
		assert.ok(doc.getText().includes('<w2:column id="h1" value="성명"/>'), doc.getText());
		assert.ok(doc.getText().includes('<w2:column id="b" width="90"/><w2:column id="a"/>'), doc.getText());
		const after = doc.getText();
		await vscode.commands.executeCommand('undo');
		assert.strictEqual(doc.getText(), before, '여러 칸 편집도 Undo 한 번');
		await vscode.commands.executeCommand('redo');
		assert.strictEqual(doc.getText(), after, 'Redo 한 번으로 모두 복원');
		const notes: string[] = [];
		assert.strictEqual(await applyNodeEdit(doc, { type: 'editGridCells', version: doc.version, index: grid.index, popup: 'p', cells: [{ index: a.index, attrs: { id: 'a' } }] }, m => notes.push(m)), false);
		assert.strictEqual(notes.length, 1, '겹치는 id 알림');
	});

	test('setAttr more: 여러 노드를 한 편집으로(노드마다 다른 값), 하나라도 없으면 안 바꿈', async () => {
		const doc = await vscode.workspace.openTextDocument({ content: '<html><body><a id="x" s="1"/><b id="y"/></body></html>', language: 'xml' });
		const root = parseXml(doc.getText())!, [a, b] = root.children[0].children;
		assert.ok(await applyNodeEdit(doc, { type: 'setAttr', version: doc.version, index: a.index, name: 's', value: '2', more: [{ index: b.index, value: '3' }] }));
		assert.strictEqual(doc.getText(), '<html><body><a id="x" s="2"/><b id="y" s="3"/></body></html>');
		assert.strictEqual(await applyNodeEdit(doc, { type: 'setAttr', version: doc.version, index: a.index, name: 's', value: '9', more: [{ index: 99, value: '9' }] }), false);
		assert.ok(await applyNodeEdit(doc, { type: 'setAttr', version: doc.version, index: b.index, name: 's', value: '4', more: [{ index: b.index, value: '5' }] }), '같은 노드 중복');
		assert.ok(doc.getText().includes('<b id="y" s="4"/>'), doc.getText());
		assert.ok(doc.getText().includes('s="2"'));
	});

	test('setAttr also: 같은 노드의 여러 속성을 한 편집으로(그리드 헤더 칸 문구·너비·높이), 지우기 포함', async () => {
		const doc = await vscode.workspace.openTextDocument({ content: '<html><body><w2:column id="c" value="이름" style="height:26px;" width="70"/></body></html>', language: 'xml' });
		const col = parseXml(doc.getText())!.children[0].children[0];
		assert.ok(await applyNodeEdit(doc, { type: 'setAttr', version: doc.version, index: col.index, name: 'value', value: '성명',
			also: [{ name: 'width', value: '120' }, { name: 'style', value: 'height:40px;' }, { name: 'rowSpan', value: '2' }] }));
		assert.strictEqual(doc.getText(), '<html><body><w2:column id="c" value="성명" style="height:40px;" width="120" rowSpan="2"/></body></html>');
		assert.ok(await applyNodeEdit(doc, { type: 'setAttr', version: doc.version, index: col.index, name: 'value', value: '성명', also: [{ name: 'style' }, { name: 'rowSpan' }] }));
		assert.strictEqual(doc.getText(), '<html><body><w2:column id="c" value="성명" width="120"/></body></html>');
	});

	test('Source 수정은 line:ch 변경분으로 적용', async () => {
		const doc = await vscode.workspace.openTextDocument({ content: SCREEN, language: 'xml' });
		const at = doc.positionAt(SCREEN.indexOf('한글'));
		assert.ok(await applyCodeEdit(doc, 'source', [{ fromLine: at.line, fromCh: at.character, toLine: at.line, toCh: at.character + 2, insert: '수정' }]));
		assert.ok(doc.getText().includes('label="수정"'));
	});

	test('Script 수정: 편집기 값에 적용 후 원문으로 되돌려 가운데만 교체', async () => {
		const doc = await vscode.workspace.openTextDocument({ content: '<html><script><![CDATA[a;\r\n  b;]]></script></html>', language: 'xml' });
		assert.ok(await applyCodeEdit(doc, 'script', [
			{ fromLine: 0, fromCh: 0, toLine: 0, toCh: 1, insert: 'x' },
			{ fromLine: 1, fromCh: 2, toLine: 1, toCh: 3, insert: 'y\nz' },
		]));
		assert.strictEqual(doc.getText(), '<html><script><![CDATA[x;\r\n  y\r\nz;]]></script></html>');
		// CDATA 안에 ]]>를 쳐도 XML이 깨지지 않는다
		assert.ok(await applyCodeEdit(doc, 'script', [{ fromLine: 0, fromCh: 0, toLine: 0, toCh: 0, insert: ']]>' }]));
		assert.strictEqual(doc.getText(), '<html><script><![CDATA[]]]]><![CDATA[>x;\r\n  y\r\nz;]]></script></html>');
		const plain = await vscode.workspace.openTextDocument({ content: '<html><script>a &lt; b;</script></html>', language: 'xml' });
		assert.ok(await applyCodeEdit(plain, 'script', [{ fromLine: 0, fromCh: 5, toLine: 0, toCh: 5, insert: ' && c' }]));
		assert.strictEqual(plain.getText(), '<html><script>a &lt; b &amp;&amp; c;</script></html>');
	});

	test('문서에 적용 (WorkspaceEdit)', async () => {
		const doc = await vscode.workspace.openTextDocument({ content: SCREEN, language: 'xml' });
		const version = doc.version;
		assert.ok(await applyNodeEdit(doc, { type: 'setAttr', version, index: 7, name: 'label', value: '영문' }));
		assert.ok(doc.getText().includes('<w2:textbox id="tbx_title" label="영문"/>'));
		assert.ok(!await applyNodeEdit(doc, { type: 'setAttr', version, index: 999, name: 'x', value: '1' }), '없는 노드');
	});
});
