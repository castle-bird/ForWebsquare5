import * as assert from 'assert';
import * as path from 'path';
import { runInNewContext } from 'vm';
import { buildSync } from 'esbuild';
import { isScreen, parseXml } from '../core/xmlModel';
import { scriptBody } from '../core/edit';

suite('Create WebSquare5 file', () => {
	test('빈 화면 생성·확장자·폴더·취소·기존 파일 보호·오류·신뢰 검사', async () => {
		const uri = (value: string): { path: string; with(change: { path: string }): unknown } => ({ path: value, with: change => uri(change.path) });
		let chosen: ReturnType<typeof uri> | undefined = uri('/project/screen');
		let applied = true, failure = false, dialogs = 0, notices = 0;
		const edits: Edit[] = [], opened: unknown[][] = [];
		class Edit {
			files: unknown[][] = [];
			text = '';
			createFile(...args: unknown[]) { this.files.push(args); }
			insert(_uri: unknown, _position: unknown, text: string) { this.text = text; }
		}
		const mock = {
			Uri: { joinPath: (base: ReturnType<typeof uri>, name: string) => uri(base.path + '/' + name) },
			WorkspaceEdit: Edit, Position: class { constructor(public line: number, public character: number) {} },
			workspace: {
				isTrusted: true, workspaceFolders: [{ uri: uri('/project') }],
				applyEdit: async (edit: Edit) => { edits.push(edit); if (failure) { throw new Error('exists'); } return applied; },
			},
			window: {
				showSaveDialog: async (options: { title: string; defaultUri?: ReturnType<typeof uri> }) => {
					dialogs++;
					assert.strictEqual(options.title, 'New Websquare5 File...');
					assert.strictEqual(options.defaultUri?.path, dialogs === 1 ? '/selected/new-screen.xml' : '/project/new-screen.xml');
					return chosen;
				},
				showErrorMessage: () => { notices++; },
			},
			commands: { executeCommand: async (...args: unknown[]) => { opened.push(args); } },
		};
		const bundle = buildSync({ entryPoints: [path.resolve(__dirname, '../../src/vscode/createScreen.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
		const module = { exports: {} as { createScreen(folder?: unknown): Promise<void> } };
		runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: (name: string) => { assert.strictEqual(name, 'vscode'); return mock; } });
		const { createScreen } = module.exports;
		await createScreen(uri('/selected'));
		assert.strictEqual((edits[0].files[0][0] as ReturnType<typeof uri>).path, '/project/screen.xml');
		assert.deepStrictEqual(structuredClone(edits[0].files[0][1]), { overwrite: false, ignoreIfExists: false });
		// saxes 타입 선언은 확장 호스트 tsc와 호환되지 않아 테스트에서 런타임으로만 읽는다.
		const { SaxesParser } = require('saxes');
		new SaxesParser({ xmlns: true }).write(edits[0].text).close();
		const root = parseXml(edits[0].text)!;
		assert.ok(isScreen(root));
		assert.strictEqual(root.children.find(n => n.tag === 'body')?.children.length, 0);
		const script = scriptBody(edits[0].text, root);
		assert.ok(typeof script !== 'string');
		assert.strictEqual(script.text.trim(), 'scwin.onpageload = function() {\n\t\n};');
		const head = root.children.find(n => n.tag === 'head')!;
		assert.deepStrictEqual(head.children.map(n => n.tag), ['w2:type', 'w2:buildDate', 'w2:MSA', 'xf:model', 'w2:layoutInfo', 'w2:publicInfo', 'script']);
		const model = head.children.find(n => n.tag === 'xf:model')!;
		assert.deepStrictEqual(model.children.map(n => n.tag), ['w2:dataCollection', 'w2:workflowCollection']);
		assert.strictEqual(model.children[0].attrs.baseNode, 'map');
		assert.strictEqual(head.children.find(n => n.tag === 'w2:publicInfo')?.attrs.method, '');
		assert.strictEqual(head.children.find(n => n.tag === 'script')?.attrs.lazy, 'false');
		assert.strictEqual(root.children.find(n => n.tag === 'body')?.attrs['ev:onpageload'], 'scwin.onpageload');
		assert.strictEqual(opened[0][0], 'vscode.open');
		chosen = uri('/project/other.XML');
		await createScreen();
		assert.strictEqual((edits[1].files[0][0] as ReturnType<typeof uri>).path, chosen.path);
		chosen = undefined;
		await createScreen();
		assert.strictEqual(edits.length, 2);
		chosen = uri('/project/existing.xml');
		applied = false;
		await createScreen();
		assert.strictEqual(notices, 1);
		assert.strictEqual(opened.length, 2);
		failure = true;
		await createScreen();
		assert.strictEqual(notices, 2);
		assert.strictEqual(opened.length, 2);
		mock.workspace.isTrusted = false;
		await createScreen();
		assert.strictEqual(dialogs, 5);
	});
});
