import * as assert from 'assert';
import * as path from 'path';
import { runInNewContext } from 'vm';
import { buildSync } from 'esbuild';

suite('Screen editor opening', () => {
	test('텍스트 경로·활성화 시 전환, 일반 XML·diff·수동 텍스트·수정·비동기 포커스 보호', async () => {
		const screen = '<html xmlns:w2="http://www.inswave.com/websquare"><body/></html>';
		const uri = { scheme: 'file', path: '/app/screen.xml', fsPath: '/app/screen.xml', toString: () => 'file:///app/screen.xml' };
		class Text { constructor(public uri: unknown) {} }
		class Custom { constructor(public uri: unknown, public viewType: string) {} }
		const document = { uri, isDirty: false, isClosed: false, version: 1, getText: () => screen };
		const tab = { input: new Text(uri) as unknown, isDirty: false, isPreview: true };
		const group = { activeTab: tab, viewColumn: 2, tabs: [tab] };
		const editor = { document };
		let listener = () => {}, tabListener = () => {};
		let root: () => Promise<string | undefined> = async () => '/app';
		const opened: unknown[][] = [], closed: unknown[] = [];
		const mock = {
			TabInputText: Text, TabInputCustom: Custom,
			workspace: { isTrusted: true },
			window: {
				activeTextEditor: editor as typeof editor | undefined,
				onDidChangeActiveTextEditor: (fn: () => void) => { listener = fn; return { dispose() {} }; },
				tabGroups: { activeTabGroup: group,
					onDidChangeTabs: (fn: () => void) => { tabListener = fn; return { dispose() {} }; },
					close: async (t: unknown) => { closed.push(t); group.tabs = group.tabs.filter(x => x !== t); return true; },
				},
			},
			commands: { executeCommand: async (...args: unknown[]) => {
				opened.push(args);
				group.tabs.push({ ...tab, input: new Custom(uri, 'designer') });
			} },
		};
		const bundle = buildSync({ entryPoints: [path.resolve(__dirname, '../../src/vscode/screenOpen.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['vscode', '../project/paths'], write: false });
		const module = { exports: {} as { registerScreenOpen(context: unknown, viewType: string): void; rememberScreenEditor(doc: unknown): void } };
		runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: (name: string) => name === 'vscode' ? mock : name === '../project/paths' ? { findWebRoot: () => root() } : require(name) });
		const subscriptions: { dispose(): void }[] = [];
		const settle = () => new Promise<void>(resolve => setImmediate(resolve));
		module.exports.registerScreenOpen({ subscriptions }, 'designer');
		await settle();
		assert.strictEqual(opened.length, 1);
		assert.deepStrictEqual(structuredClone(opened[0].slice(2)), ['designer', { viewColumn: 2, preview: true, preserveFocus: false }]);
		assert.strictEqual(closed[0], tab);
		// 디자이너에서 텍스트로 다시 연 같은 문서는 재전환하지 않는다.
		group.tabs = [tab]; listener(); tabListener(); await settle();
		assert.strictEqual(opened.length, 1);
		const fresh = () => { editor.document = { ...document }; mock.window.activeTextEditor = editor; group.tabs = [tab]; tab.input = new Text(uri); };
		fresh(); editor.document.getText = () => '<mapper/>'; listener(); await settle();
		fresh(); tab.input = {}; listener(); await settle();
		fresh(); editor.document.isDirty = true; listener(); await settle();
		fresh(); mock.workspace.isTrusted = false; listener(); await settle(); mock.workspace.isTrusted = true;
		fresh(); root = async () => undefined; listener(); await settle();
		fresh(); root = async () => { throw new Error('read failure'); }; listener(); await settle();
		fresh(); root = async () => { mock.window.activeTextEditor = undefined; return '/app'; }; listener(); await settle();
		fresh(); root = async () => { editor.document.version++; return '/app'; }; listener(); await settle();
		assert.strictEqual(opened.length, 1);
		fresh(); root = async () => '/app'; module.exports.rememberScreenEditor(editor.document); listener(); await settle();
		assert.strictEqual(opened.length, 1, '보통 경로에서 연 디자이너도 수동 텍스트 전환 존중');
		fresh(); listener(); tabListener(); await settle();
		assert.strictEqual(opened.length, 2, '두 이벤트가 겹쳐도 한 번만 전환');
		subscriptions.forEach(s => s.dispose()); fresh(); listener(); await settle();
		assert.strictEqual(opened.length, 2);
	});
});
