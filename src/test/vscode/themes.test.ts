import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CODE_THEMES, fromVsCodeTheme, parseJsonc, type VsTheme } from '../../core/codeTheme';

suite('코드 편집기 테마 (VS Code)', () => {
	test('코드 편집기 테마: id 중복 없음, 명령 등록(우클릭 메뉴 대신 탭 줄 톱니바퀴)', async () => {
		assert.strictEqual(new Set(CODE_THEMES.map(t => t.id)).size, CODE_THEMES.length, 'id 중복 없음');
		// 명령은 확장이 켜져야 등록된다(다른 테스트 파일이 먼저 켜 줬는지와 상관없게)
		await vscode.extensions.getExtension('castle-bird.websquare5-editor')?.activate();
		assert.ok((await vscode.commands.getCommands(true)).includes('websquare5-editor.codeTheme'));
		assert.strictEqual(vscode.extensions.all.find(e => e.packageJSON.name === 'websquare5-editor')?.packageJSON.contributes.menus['webview/context'], undefined, '코드 편집기 우클릭 메뉴 항목 없음');
		assert.ok((await vscode.commands.getCommands(true)).includes('websquare5-editor.importCodeTheme'));
	});

	test('확장에 든 테마(media/themes): 모두 읽히고 편집기 색·문법 색 14종이 다 있다', () => {
		const dir = path.join(vscode.extensions.all.find(e => e.packageJSON.name === 'websquare5-editor')!.extensionPath, 'media', 'themes');
		const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
		assert.deepStrictEqual(files.filter(f => f.startsWith('intellij-') || f.startsWith('one-')).sort(), ['intellij-dark.json', 'intellij-light.json', 'one-dark.json', 'one-light.json']);
		for (const file of files) {
			const theme = parseJsonc(fs.readFileSync(path.join(dir, file), 'utf8')) as VsTheme;
			const converted = fromVsCodeTheme(theme);
			assert.ok(theme.name, `${file}: 목록에 보일 이름`);
			assert.strictEqual(Object.keys(converted.colors ?? {}).length, 7, `${file}: 편집기 색`);
			assert.strictEqual(Object.keys(converted.tokens ?? {}).length, 14, `${file}: 문법 색`);
		}
	});
});
