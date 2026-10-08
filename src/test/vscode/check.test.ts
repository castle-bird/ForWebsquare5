import * as assert from 'assert';
import * as vscode from 'vscode';
import { parseXml } from '../../core/xmlModel';
import { applyNodeEdit } from '../../vscode/documentEdit';

suite('화면 점검·중복 id (VS Code)', () => {
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
