import * as assert from 'assert';
import * as vscode from 'vscode';
import { formatCode } from '../../vscode/documentEdit';
import { remoteCompletions, remoteSignature } from '../../vscode/completion';

suite('format', () => {
	// 문서 전체를 fn 결과로 바꾸는 가짜 포매터
	const formatter = (selector: vscode.DocumentSelector, fn: (text: string) => string) => vscode.languages.registerDocumentFormattingEditProvider(selector, {
		provideDocumentFormattingEdits: d => [vscode.TextEdit.replace(new vscode.Range(0, 0, d.lineCount, 0), fn(d.getText()))],
	});

	test('Source: 포매터가 없으면 undefined, 있으면 결과만 돌려주고 문서는 그대로', async () => {
		const doc = await vscode.workspace.openTextDocument({ content: '<a><b/></a>', language: 'xml' });
		assert.strictEqual(await formatCode(doc, 'source'), undefined);
		const sub = formatter({ language: 'xml' }, t => t.replace('<b/>', '\n  <b/>\n'));
		try {
			// VS Code가 포매터 결과 줄바꿈을 문서 EOL(Windows는 CRLF)로 맞춘다
			assert.strictEqual((await formatCode(doc, 'source'))?.replace(/\r\n/g, '\n'), '<a>\n  <b/>\n</a>');
			assert.strictEqual(doc.getText(), '<a><b/></a>');
		} finally {
			sub.dispose();
		}
	});

	test('연결 파일·Source: 포매터에는 파일과 상관없이 공백 4칸을 넘긴다', async () => {
		let options: vscode.FormattingOptions | undefined;
		const sub = vscode.languages.registerDocumentFormattingEditProvider({ language: 'java' }, { provideDocumentFormattingEdits: (_d, o) => { options = o; return []; } });
		try {
			const tabbed = await vscode.workspace.openTextDocument({ content: 'class A {\n\tvoid f() {\n\t\tg();\n\t}\n}\n', language: 'java' });
			await formatCode(tabbed, 'link:controller');
			assert.deepStrictEqual({ tabSize: options?.tabSize, insertSpaces: options?.insertSpaces }, { tabSize: 4, insertSpaces: true });
			const twoSpaces = await vscode.workspace.openTextDocument({ content: 'class A {\n  void f() {\n    g();\n  }\n}\n', language: 'java' });
			await formatCode(twoSpaces, 'link:service');
			assert.deepStrictEqual({ tabSize: options?.tabSize, insertSpaces: options?.insertSpaces }, { tabSize: 4, insertSpaces: true });
		} finally {
			sub.dispose();
		}
	});

	test('연결 탭 자동완성: 언어 확장 결과를 이름·설명·스니펫·자동 import 편집으로 바꾼다', async () => {
		const sub = vscode.languages.registerCompletionItemProvider({ language: 'java' }, {
			provideCompletionItems: () => {
				const big = new vscode.CompletionItem({ label: 'BigDecimal', description: 'java.math' }, vscode.CompletionItemKind.Class);
				big.additionalTextEdits = [vscode.TextEdit.insert(new vscode.Position(0, 0), 'import java.math.BigDecimal;\n')];
				big.range = new vscode.Range(1, 4, 1, 7);
				const each = new vscode.CompletionItem('forEach', vscode.CompletionItemKind.Method);
				each.insertText = new vscode.SnippetString('forEach(${1:action})');
				// 필드·생성자·스니펫도 아이콘 종류가 따로(필드 f, 생성자는 메서드 m, 스니펫 S)
				return [big, each, new vscode.CompletionItem('name', vscode.CompletionItemKind.Field), new vscode.CompletionItem('Big', vscode.CompletionItemKind.Constructor),
					new vscode.CompletionItem('for', vscode.CompletionItemKind.Snippet)];
			},
		});
		try {
			const doc = await vscode.workspace.openTextDocument({ content: 'class A {\n    Big\n}\n', language: 'java' });
			const result = await remoteCompletions(doc, 1, 7);
			const items = result?.items.filter(i => i.label === 'BigDecimal' || i.label === 'forEach');
			assert.deepStrictEqual(result?.from, { line: 1, ch: 4 });
			assert.deepStrictEqual(['name', 'Big', 'for'].map(label => result?.items.find(i => i.label === label)?.type), ['field', 'method', 'snippet']);
			assert.deepStrictEqual(items?.map(i => ({ label: i.label, type: i.type, detail: i.detail, snippet: i.snippet, insert: i.insert, edits: i.edits })), [
				{ label: 'BigDecimal', type: 'class', detail: 'java.math', snippet: false, insert: 'BigDecimal', edits: [{ fromLine: 0, fromCh: 0, toLine: 0, toCh: 0, insert: 'import java.math.BigDecimal;\n' }] },
				{ label: 'forEach', type: 'method', detail: undefined, snippet: true, insert: 'forEach(${1:action})', edits: undefined },
			]);
		} finally {
			sub.dispose();
		}
	});

	test('파라미터 힌트: 언어 확장 Signature Help의 고른 것 하나, 파라미터 이름은 label 안 자리로, 지금 파라미터·설명', async () => {
		const sub = vscode.languages.registerSignatureHelpProvider({ language: 'java' }, {
			provideSignatureHelp: () => {
				const one = new vscode.SignatureInformation('find(int id)');
				one.parameters = [new vscode.ParameterInformation('int id')];
				const two = new vscode.SignatureInformation('find(int id, String id2)', new vscode.MarkdownString('Finds'));
				// 같은 글자가 앞에 또 있어도(id·id2) 차례대로 자리를 찾는다. 범위로 온 것은 그대로
				two.parameters = [new vscode.ParameterInformation('int id'), new vscode.ParameterInformation([13, 23], new vscode.MarkdownString('the **id2**'))];
				return Object.assign(new vscode.SignatureHelp(), { signatures: [one, two], activeSignature: 1, activeParameter: 1 });
			},
		}, '(', ',');
		try {
			const doc = await vscode.workspace.openTextDocument({ content: 'class A { void f() { find(1, ); } }\n', language: 'java' });
			assert.deepStrictEqual(await remoteSignature(doc, 0, 29, ','), {
				label: 'find(int id, String id2)', params: [[5, 11], [13, 23]], index: 2, count: 2, active: 1, paramDoc: 'the **id2**', doc: 'Finds',
			});
		} finally {
			sub.dispose();
		}
	});

	test('연결 탭 자동완성: 다른 문서에서 온 단어(Text)는 빼고 이 파일 단어·언어 확장 결과는 둔다', async () => {
		const sub = vscode.languages.registerCompletionItemProvider({ language: 'xml' }, {
			provideCompletionItems: () => [
				new vscode.CompletionItem('dataList', vscode.CompletionItemKind.Text),
				new vscode.CompletionItem('selectUser', vscode.CompletionItemKind.Text),
				new vscode.CompletionItem('resultMap', vscode.CompletionItemKind.Property),
			],
		});
		try {
			const doc = await vscode.workspace.openTextDocument({ content: '<mapper>\n<select id="selectUser">\n</select>\n</mapper>\n', language: 'xml' });
			const labels = (await remoteCompletions(doc, 2, 0))?.items.map(i => i.label) ?? [];
			assert.ok(labels.includes('selectUser') && labels.includes('resultMap'), labels.join());
			assert.ok(!labels.includes('dataList'), labels.join());
		} finally {
			sub.dispose();
		}
	});

	// Script는 VS Code의 JS 포매터(기본 포매터 설정, 없으면 내장)로. 결과 모양은 그 포매터 몫이라 들여쓰기·본문·앞뒤 공백만 본다
	test('Script: 본문만 VS Code JS 포매터로 포맷하고 CDATA 앞뒤 공백은 유지', async function () {
		this.timeout(10000); // 이 실행에서 JS 포매터 첫 호출: 언어 서버가 뜨는 동안 2초를 넘기기도 한다
		const doc = await vscode.workspace.openTextDocument({ content: '<html><script><![CDATA[\n\tconst a={b:1}\n\t]]></script></html>', language: 'xml' });
		const out = await formatCode(doc, 'script');
		assert.ok(out?.startsWith('\n\t') && out.endsWith('\n\t'), JSON.stringify(out));
		assert.match(out!, /const a = \{ b: 1 \}/);
	});

	test('Script: 탭으로 들여쓴 본문도 공백 4칸으로 포맷', async () => {
		const doc = await vscode.workspace.openTextDocument({ content: '<html><script><![CDATA[\nif (a) {\n\tb()\n}\n]]></script></html>', language: 'xml' });
		assert.match((await formatCode(doc, 'script'))!, /\n {4}b\(\)/);
	});
});
