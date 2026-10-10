import * as assert from 'assert';
import * as path from 'path';
import { runInNewContext } from 'vm';
import { buildSync } from 'esbuild';
import type { CssRuleSource } from '../core/protocol';

suite('CSS navigation', () => {
	test('1개·다중 CSS 이동은 줄 전체 선택, 취소·없는 규칙·잘못된 번호는 파일을 열지 않음', async () => {
		const opened: { uri: string; options: { selection: number[]; preview: boolean } }[] = [];
		let picks = 0, notices = 0, cancel = false;
		const window = {
			showInformationMessage: () => { notices++; },
			showQuickPick: async (items: { label: string; description: string }[], options: { matchOnDescription: boolean }) => {
				picks++;
				assert.strictEqual(items.length, 2);
				assert.strictEqual(items[1].label, '.parent .same');
				assert.strictEqual(items[1].description, '/css/screen.css:8');
				assert.strictEqual(options.matchOnDescription, true);
				return cancel ? undefined : items[1];
			},
			showTextDocument: async (document: { uri: string }, options: { selection: number[]; preview: boolean }) => { opened.push({ uri: document.uri, options: structuredClone(options) }); },
		};
		const mock = {
			window, workspace: {
				asRelativePath: (uri: string) => uri,
				openTextDocument: async (uri: string) => ({ uri, lineAt: (line: number) => ({ range: [line, 0, line, uri === '/css/common.css' ? 21 : 35] }) }),
			}, Uri: { file: (file: string) => file },
		};
		const bundle = buildSync({ entryPoints: [path.resolve(__dirname, '../../src/vscode/css.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
		const module = { exports: {} as { openCss(sources: CssRuleSource[], indexes: number[]): Promise<void> } };
		runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: (name: string) => {
			assert.strictEqual(name, 'vscode');
			return mock;
		} });
		const rule = (file: string, line: number, ch: number, selector: string): CssRuleSource => ({ file, line, ch, selector, match: selector, media: [], supports: [] });
		const sources = [rule('/css/common.css', 2, 1, '.same'), rule('/css/screen.css', 7, 3, '.parent .same')];
		const { openCss } = module.exports;
		await openCss(sources, [0]);
		assert.strictEqual(picks, 0);
		assert.deepStrictEqual(opened[0], { uri: '/css/common.css', options: { selection: [2, 0, 2, 21], preview: false } });
		await openCss(sources, [0, 0, 1]);
		assert.strictEqual(picks, 1);
		assert.deepStrictEqual(opened[1], { uri: '/css/screen.css', options: { selection: [7, 0, 7, 35], preview: false } });
		cancel = true;
		await openCss(sources, [0, 1]);
		assert.strictEqual(opened.length, 2);
		await openCss(sources, []);
		assert.strictEqual(notices, 1);
		for (const indexes of [[-1], [2], [0.5], [NaN], [0, 99]]) { await openCss(sources, indexes); }
		assert.strictEqual(opened.length, 2);
		assert.strictEqual(picks, 2);
	});
});
