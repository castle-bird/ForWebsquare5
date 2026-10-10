import * as assert from 'assert';
import * as path from 'path';
import { runInNewContext } from 'vm';
import { buildSync } from 'esbuild';
import { findNode, parseXml } from '../core/xmlModel';
import type { ToWebview, ToExtension } from '../core/protocol';

suite('Data 루트 삭제 보호', () => {
	test('Delete·잘라내기·다중 선택은 루트를 보존하고 하위 항목 삭제는 전달', () => {
		const sent: ToExtension[] = [];
		const bundle = buildSync({ entryPoints: [path.resolve(__dirname, '../../src/webview/store.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
		const module = { exports: {} as { useEditorStore: {
			setState(state: { selected: number; extra: number[] }): void;
			getState(): { selected?: number; del(): boolean; cut(): boolean; handleMessage(message: ToWebview): void };
		} } };
		runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, acquireVsCodeApi: () => ({ postMessage: (msg: ToExtension) => sent.push(msg) }) });
		const store = module.exports.useEditorStore;
		const text = '<html xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms"><head><xf:model><w2:dataCollection><w2:dataMap id="map"/><w2:dataList id="list"/></w2:dataCollection><xf:submission id="submission"/></xf:model></head><body/></html>';
		const root = parseXml(text)!;
		store.getState().handleMessage({ type: 'document', version: 1, text, root, script: { text: '' } });
		const collection = findNode(root, n => n.tag === 'w2:dataCollection')!.index;
		const map = findNode(root, n => n.attrs.id === 'map')!.index;
		for (const index of [collection, -1]) {
			for (const extra of [[], [map]]) {
				store.setState({ selected: index, extra });
				sent.length = 0;
				assert.strictEqual(store.getState().del(), true, 'Delete 이벤트 소비');
				store.getState().cut();
				assert.ok(!sent.some(m => m.type === 'delete'));
				assert.strictEqual(store.getState().selected, index);
				store.setState({ selected: map, extra: [index] });
				sent.length = 0;
				store.getState().del();
				assert.ok(!sent.some(m => m.type === 'delete'), '루트가 보조 선택이어도 보호');
			}
		}
		for (const id of ['map', 'list', 'submission']) {
			const index = findNode(root, n => n.attrs.id === id)!.index;
			store.setState({ selected: index, extra: [] });
			sent.length = 0;
			assert.strictEqual(store.getState().del(), true);
			assert.deepStrictEqual(structuredClone(sent[0]), { type: 'delete', version: 1, index });
		}
	});
});
