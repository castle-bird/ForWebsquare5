import * as assert from 'assert';
import * as vscode from 'vscode';
import { remoteCompletions } from '../../vscode/completion';

const labels = async (doc: vscode.TextDocument, marker: string) => {
	const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', doc.uri, doc.positionAt(doc.getText().indexOf(marker) + marker.length));
	return list.items.filter(i => i.kind !== vscode.CompletionItemKind.Text).map(i => typeof i.label === 'string' ? i.label : i.label.label);
};

suite('MyBatis SQL 자동완성', () => {
	test('.xml 매퍼의 SQL 본문에서 키워드·함수만, 태그 안·일반 XML에서는 없음', async () => {
		const mapper = await vscode.workspace.openTextDocument({ language: 'xml', content:
			'<mapper namespace="a">\n<select id="test">\n\tSELECT USER_NM FROM TB_USER\n\tseleC\n</select>\n</mapper>' });
		const found = await labels(mapper, '\tsele');
		assert.ok(found.includes('select'), '소문자로 치면 소문자 키워드');
		assert.ok(!found.includes('TB_USER') && !found.includes('USER_NM'), '매퍼 단어는 내지 않음');
		assert.ok((await labels(mapper, '\tS')).includes('SELECT'), '대문자로 치면 대문자');
		assert.ok(!(await labels(mapper, 'id="te')).includes('select'), '속성 안');
		const plain = await vscode.workspace.openTextDocument({ language: 'xml', content: '<root>\n<select>sele</select>\n</root>' });
		assert.ok(!(await labels(plain, '>sele')).includes('select'), '매퍼가 아닌 XML');
	});

	test('연결 탭: 설명 없는 태그 넣기(XML 확장의 where)에 MyBatis 태그, SQL 키워드는 그대로', async () => {
		const sub = vscode.languages.registerCompletionItemProvider({ language: 'xml' }, {
			provideCompletionItems: () => [Object.assign(new vscode.CompletionItem('where', vscode.CompletionItemKind.Property), { insertText: new vscode.SnippetString('<where>$1</where>') })],
		});
		try {
			const doc = await vscode.workspace.openTextDocument({ language: 'xml', content: '<mapper namespace="a">\n<select id="t">\nwhe\n</select>\n</mapper>' });
			const items = (await remoteCompletions(doc, 2, 3))?.items ?? [];
			assert.deepStrictEqual(items.filter(i => i.label === 'where').map(i => i.detail).sort(), ['MyBatis 태그', 'SQL 키워드']);
		} finally {
			sub.dispose();
		}
	});
});
