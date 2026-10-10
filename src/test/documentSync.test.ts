import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { webcrypto } from 'crypto';
import { runInNewContext } from 'vm';
import { transformSync } from 'esbuild';
import * as model from '../core/xmlModel';
import { errorMessage } from '../core/errors';
import { serial } from '../project/paths';
import type { ToExtension, ToWebview } from '../core/protocol';

suite('디자이너 편집 동기화', () => {
	test('구조·팝업 편집 버전 검사를 직렬화하고 읽는 동안 바뀐 문서는 보내지 않음', async () => {
		const document = { version: 1, uri: { fsPath: 'C:/web/main.xml' }, getText: () => '<html xmlns:w2="http://www.inswave.com/websquare"><body><group/></body></html>' };
		const sent: ToWebview[] = [], applied: ToExtension[] = [];
		const disposable = { dispose() {} }, event = () => disposable;
		let receive!: (msg: ToExtension) => void, dispose!: () => void;
		let release!: () => void, releaseFrames!: () => void;
		let blockEdit = true, blockFrames = false, frameStarted = false;
		const paused = new Promise<void>(resolve => { release = resolve; });
		const frames = new Promise<void>(resolve => { releaseFrames = resolve; });
		const vscode = {
			Uri: { file: (s: string) => s, joinPath: (...s: string[]) => s.join('/') },
			RelativePattern: class {},
			workspace: { createFileSystemWatcher: () => ({ ...disposable, onDidChange: event, onDidCreate: event, onDidDelete: event }), onDidChangeConfiguration: event, onDidChangeTextDocument: event },
			window: { showErrorMessage() {}, showWarningMessage() {} },
		};
		const mocks: Record<string, unknown> = {
			vscode, './core/xmlModel': model, './core/errors': { errorMessage },
			'./core/edit': { scriptBody: () => ({ text: '' }) },
			'./core/links': { linkIdOf: () => undefined },
			'./project/paths': { serial, findWebRoot: async () => 'C:/web' },
			'./project/frames': { attachFrames: async () => { if (blockFrames) { frameStarted = true; await frames; } } },
			'./project/components': { annotate() {} },
			'./project/styles': { stylesheetFiles: async () => [] },
			'./project/modules': { udcNames: async () => new Set(), engineModules: async () => ({ files: [], failed: [] }) },
			'./project/apiDocs': { loadApiDocs: async () => ({ api: {} }) },
			'./vscode/setup': { resolvePath: async () => undefined, offerSetup() {} },
			'./vscode/links': { LinkedFiles: class { handle() { return false; } dispose() {} } },
			'./vscode/tables': { UsedTablesStore: class { handle() { return false; } } },
			'./vscode/gitBase': { onGitChange: event, blameFeed: () => ({ schedule() {}, dispose() {} }) },
			'./vscode/linkTabs': { onBlameToggled: event },
			'./vscode/documentEdit': { applyNodeEdit: async (_doc: unknown, msg: ToExtension) => {
				applied.push(msg);
				if (blockEdit) { await paused; }
				document.version++;
				return true;
			} },
		};
		const source = fs.readFileSync(path.resolve(__dirname, '../../src/extension.ts'), 'utf8') + '\nexport { DesignerProvider };';
		const module = { exports: {} as { DesignerProvider: new (...args: unknown[]) => { resolveCustomTextEditor(doc: unknown, panel: unknown): Promise<void> } } };
		runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
			module, exports: module.exports, require: (name: string) => mocks[name] ?? (name.startsWith('node:') ? require(name) : {}),
			crypto: webcrypto, setTimeout, clearTimeout,
		});
		const panel = { webview: {
			asWebviewUri: (uri: string) => uri,
			postMessage: async (msg: ToWebview) => { sent.push(msg); return true; },
			onDidReceiveMessage: (fn: typeof receive) => { receive = fn; return disposable; },
		}, onDidDispose: (fn: () => void) => { dispose = fn; } };
		await new module.exports.DesignerProvider('extension', {}, {}, 'storage').resolveCustomTextEditor(document, panel);
		const settle = () => new Promise<void>(resolve => setImmediate(resolve));
		try {
			receive({ type: 'editChoices', version: 1, index: 2, popup: 'p', fields: {} } as ToExtension);
			receive({ type: 'delete', version: 1, index: 2 });
			await settle();
			assert.strictEqual(applied.length, 1, '첫 적용 중에는 두 번째 편집을 시작하지 않음');
			release();
			await settle();
			assert.strictEqual(applied.length, 1, '대기 뒤 버전이 달라진 삭제는 거부');
			assert.ok(sent.some(msg => msg.type === 'popupAck' && msg.ok));
			assert.ok(sent.some(msg => msg.type === 'document' && msg.version === 2));
			blockEdit = false;
			blockFrames = true;
			receive({ type: 'delete', version: 2, index: 2 });
			await settle();
			assert.ok(frameStarted);
			document.version++;
			sent.length = 0;
			releaseFrames();
			await settle();
			assert.ok(!sent.some(msg => msg.type === 'document'), '비동기 frame 읽기 중 바뀐 버전은 보내지 않음');
		} finally { release(); releaseFrames(); dispose(); }
	});
});
