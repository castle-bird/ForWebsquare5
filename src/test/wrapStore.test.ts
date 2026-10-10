import * as assert from 'assert';
import * as path from 'path';
import { runInNewContext } from 'vm';
import { buildSync } from 'esbuild';
import { applyEdits } from '../core/edit';
import { prepareNodeEdit } from '../core/nodeEdit';
import { findNode, parseXml } from '../core/xmlModel';
import type { ToWebview, ToExtension } from '../core/protocol';

suite('그룹 감싸기 요청', () => {
	test('선택 번호·버전을 전달하고 새 Group 위치 선택, 다른 부모·없는 노드는 요청하지 않음', () => {
		const sent: ToExtension[] = [];
		const bundle = buildSync({ entryPoints: [path.resolve(__dirname, '../../src/webview/store.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
		const module = { exports: {} as { useEditorStore: {
			getState(): { selected?: number; extra: number[]; setSelected(index?: number): void; wrap(indexes: number[], version: number): void; handleMessage(message: ToWebview): void };
		} } };
		runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, acquireVsCodeApi: () => ({ postMessage: (msg: ToExtension) => sent.push(msg) }) });
		const store = module.exports.useEditorStore;
		const text = '<html><head/><body><group id="p"><input id="a"/></group><input id="b"/><input id="c"/></body></html>';
		const root = parseXml(text)!;
		const index = (id: string) => findNode(root, n => n.attrs.id === id)!.index;
		store.getState().handleMessage({ type: 'document', version: 3, text, root, script: { text: '' } });
		store.getState().wrap([index('c'), index('b')], 3);
		assert.deepStrictEqual(structuredClone(sent.pop()), { type: 'wrap', version: 3, index: index('b'), more: [index('c')] });
		assert.strictEqual(store.getState().selected, index('b'));
		assert.strictEqual(store.getState().extra.length, 0);
		store.getState().wrap([index('a'), index('b')], 3);
		assert.strictEqual(sent.pop()?.type, 'warn');
		store.getState().wrap([index('b'), 999], 3);
		assert.strictEqual(sent.length, 0);
		store.getState().wrap([index('b')], 2);
		assert.strictEqual(sent.length, 0, '오래된 메뉴는 요청하지 않음');
		store.getState().wrap([index('b')], 3);
		assert.deepStrictEqual(structuredClone(sent.pop()), { type: 'wrap', version: 3, index: index('b') });
		const plan = prepareNodeEdit(text, { type: 'wrap', version: 3, index: index('b') })!;
		assert.ok(!('error' in plan));
		const wrapped = applyEdits(text, plan.changes), wrappedRoot = parseXml(wrapped)!;
		const sendDoc = (text: string, version: number) => store.getState().handleMessage({ type: 'document', version, text, root: parseXml(text), script: { text: '' } });
		sendDoc(wrapped, 4);
		assert.strictEqual(store.getState().selected, findNode(wrappedRoot, n => n.attrs.id === 'group1')!.index, '생성 직후 새 Group 선택');
		const clicked = findNode(wrappedRoot, n => n.attrs.id === 'c')!.index;
		store.getState().setSelected(clicked);
		for (let version = 5; version < 9; version++) {
			const current = version % 2 ? text : wrapped;
			sendDoc(current, version);
			assert.strictEqual(store.getState().selected, findNode(parseXml(current)!, n => n.attrs.id === 'c')!.index, 'Undo·Redo는 현재 클릭한 컴포넌트 유지');
		}
		store.getState().setSelected(findNode(wrappedRoot, n => n.attrs.id === 'group1')!.index);
		sendDoc(text, 9);
		assert.strictEqual(store.getState().selected, undefined, '되돌려 없어진 Group은 다른 컴포넌트를 고르지 않음');
		// 문서 응답 전에 다른 컴포넌트를 클릭해도 생성 요청의 선택 예약이 덮어쓰지 않는다.
		store.getState().wrap([index('b')], 9);
		store.getState().setSelected(index('c'));
		sendDoc(wrapped, 10);
		assert.strictEqual(store.getState().selected, clicked);

	});
});
