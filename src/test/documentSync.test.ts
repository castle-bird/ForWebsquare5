import * as assert from 'assert';
import * as path from 'path';
import { runInNewContext } from 'vm';
import { build, type Plugin } from 'esbuild';
import type { ToExtension, ToWebview } from '../core/protocol';

const src = path.resolve(__dirname, '../../src');

/**
 * ScreenSession을 실제 core·resources와 함께 묶고, VS Code API와 디스크를 읽는 모듈(project/*, 다른 vscode/*)만 mocks로 바꾼다.
 * mocks에 없는 모듈은 빈 객체다(부르면 그 자리에서 실패)
 */
async function loadSession(mocks: Record<string, unknown>) {
	const real = new Set(['vscode/screenSession', 'vscode/resources', 'project/paths']);
	const mock: Plugin = {
		name: 'mock',
		setup(build) {
			build.onResolve({ filter: /.*/ }, args => {
				const key = args.path === 'vscode' ? 'vscode'
					: args.path.startsWith('.') ? path.relative(src, path.resolve(args.resolveDir, args.path)).replaceAll('\\', '/') : undefined;
				return key && (key === 'vscode' || /^(project|vscode)\//.test(key)) && !real.has(key) ? { path: key, namespace: 'mock' } : undefined;
			});
			build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: `module.exports = mocks[${JSON.stringify(args.path)}] ?? {};`, loader: 'js' }));
		},
	};
	const { outputFiles } = await build({ entryPoints: [path.join(src, 'vscode/screenSession.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [mock], logLevel: 'silent' });
	const module = { exports: {} as { ScreenSession: new (...args: unknown[]) => unknown } };
	runInNewContext(outputFiles[0].text, { module, exports: module.exports, mocks, require, setTimeout, clearTimeout, setImmediate });
	return module.exports.ScreenSession;
}

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
		const ScreenSession = await loadSession({
			vscode: {
				Uri: { file: (s: string) => s, joinPath: (...s: string[]) => s.join('/') },
				RelativePattern: class {},
				workspace: { createFileSystemWatcher: () => ({ ...disposable, onDidChange: event, onDidCreate: event, onDidDelete: event }), onDidChangeConfiguration: event, onDidChangeTextDocument: event },
				window: { showErrorMessage() {}, showWarningMessage() {} },
			},
			'project/frames': { attachFrames: async () => { if (blockFrames) { frameStarted = true; await frames; } } },
			'project/components': { annotate() {} },
			'project/styles': { stylesheetFiles: async () => [] },
			'project/modules': { udcNames: async () => new Set(), engineModules: async () => ({ files: [], failed: [] }) },
			'project/apiDocs': { loadApiDocs: async () => ({ api: {} }) },
			'vscode/setup': { resolvePath: async () => undefined, offerSetup() {}, onDidChangeInstall: event },
			'vscode/links': { LinkedFiles: class { handle() { return false; } dispose() {} } },
			'vscode/tables': { UsedTablesStore: class { handle() { return false; } dispose() {} } },
			'vscode/browserPreview': { BrowserPreview: class { update() {} dispose() {} } },
			'vscode/gitBase': { onGitChange: event, blameFeed: () => ({ schedule() {}, dispose() {} }) },
			'vscode/viewSettings': { onBlameToggled: event },
			'vscode/documentEdit': { applyNodeEdit: async (_doc: unknown, msg: ToExtension) => {
				applied.push(msg);
				if (blockEdit) { await paused; }
				document.version++;
				return true;
			} },
		});
		const panel = { webview: {
			asWebviewUri: (uri: string) => uri,
			postMessage: async (msg: ToWebview) => { sent.push(msg); return true; },
			onDidReceiveMessage: (fn: typeof receive) => { receive = fn; return disposable; },
		}, onDidDispose: (fn: () => void) => { dispose = fn; } };
		new ScreenSession(document, panel, 'C:/web', { globalState: {}, workspaceState: {}, tablesFolder: 'storage', broadcast() {} });
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
