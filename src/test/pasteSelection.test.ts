import * as assert from 'assert';
import * as path from 'path';
import { runInNewContext } from 'vm';
import { buildSync } from 'esbuild';
import { applyEdits } from '../core/edit';
import { prepareNodeEdit } from '../core/nodeEdit';
import { findNode, parseXml } from '../core/xmlModel';
import type { ToWebview, ToExtension } from '../core/protocol';

suite('붙여넣기 선택 유지', () => {
	test('같은 속성의 td가 여러 개여도 대상·응답 전 새 선택을 보존', () => {
		const sent: ToExtension[] = [];
		const bundle = buildSync({ entryPoints: [path.resolve(__dirname, '../../src/webview/store.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
		const module = { exports: {} as { useEditorStore: {
			getState(): { selected?: number; pendingPaste?: unknown; setSelected(index?: number): void; copy(): boolean; paste(clip?: null, at?: { index: number; position: 'before' | 'after' }): boolean; handleMessage(message: ToWebview): void };
		} } };
		runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, acquireVsCodeApi: () => ({ postMessage: (msg: ToExtension) => sent.push(msg) }) });
		const store = module.exports.useEditorStore;
		const text = '<html><head/><body><group tagname="td" class="w2tb_td"><group id="group1_copy3"><input id="child"/></group></group><group tagname="td" class="w2tb_td"/><group tagname="td" class="w2tb_td"/></body></html>';
		const root = parseXml(text)!;
		const body = findNode(root, n => n.tag === 'body')!;
		const source = findNode(root, n => n.attrs.id === 'group1_copy3')!;
		const sendDoc = (text: string, version: number) => store.getState().handleMessage({ type: 'document', version, text, root: parseXml(text), script: { text: '' } });
		let version = 0;
		for (const target of body.children) {
			for (const mode of ['inside', 'before', 'after', 'click', 'clear', 'mismatch'] as const) {
				sendDoc(text, ++version);
				store.getState().setSelected(source.index);
				assert.ok(store.getState().copy());
				store.getState().setSelected(target.index);
				assert.ok(store.getState().paste(null, mode === 'before' || mode === 'after' ? { index: target.index, position: mode } : undefined));
				const request = sent.pop()!;
				assert.strictEqual(request.type, 'paste');
				if (request.type !== 'paste') { throw new Error('paste request missing'); }
				const plan = prepareNodeEdit(text, request)!;
				assert.ok(!('error' in plan));
				const pasted = applyEdits(text, plan.changes);
				if (mode === 'click') { store.getState().setSelected(body.children[2].index); }
				if (mode === 'clear') { store.getState().setSelected(undefined); }
				sendDoc(mode === 'mismatch' ? text.replace('id="child"', 'id="changed"') : pasted, ++version);
				const current = parseXml(pasted)!;
				const children = findNode(current, n => n.tag === 'body')!.children;
				const ordinal = mode === 'click' ? 2 : body.children.indexOf(target) + (mode === 'before' ? 1 : 0);
				assert.strictEqual(store.getState().selected, mode === 'clear' || mode === 'mismatch' ? undefined : children[ordinal].index, mode);
				assert.strictEqual(store.getState().pendingPaste, undefined, '문서 응답 후 예약 해제');
			}
		}
	});

	test('구조가 바뀌면 펼침 번호도 같은 노드를 따라감(ID 없는 같은 td 포함)', () => {
		const sent: ToExtension[] = [];
		const bundle = buildSync({ entryPoints: [path.resolve(__dirname, '../../src/webview/store.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
		const module = { exports: {} as { useEditorStore: {
			getState(): { remap?: { to(index: number): number | undefined }; setSelected(index?: number): void; copy(): boolean; paste(): boolean; handleMessage(message: ToWebview): void };
		} } };
		runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, acquireVsCodeApi: () => ({ postMessage: (msg: ToExtension) => sent.push(msg) }) });
		const store = module.exports.useEditorStore;
		const text = '<html><head/><body><group tagname="td" class="w2tb_td"/><group tagname="td" class="w2tb_td"><input id="a"/><input id="b"/></group></body></html>';
		const sendDoc = (text: string, version: number) => store.getState().handleMessage({ type: 'document', version, text, root: parseXml(text), script: { text: '' } });
		const tds = (text: string) => findNode(parseXml(text)!, n => n.tag === 'body')!.children;
		const before = tds(text);
		// 두 번째 td의 input을 첫 td에 붙여넣기 → 두 번째 td 번호가 밀려도 따라감
		sendDoc(text, 1);
		store.getState().setSelected(before[1].children[1].index);
		assert.ok(store.getState().copy());
		store.getState().setSelected(before[0].index);
		assert.ok(store.getState().paste());
		const request = sent.pop()!;
		if (request.type !== 'paste') { throw new Error('paste request missing'); }
		const plan = prepareNodeEdit(text, request)!;
		if ('error' in plan) { throw new Error(plan.error); }
		const pasted = applyEdits(text, plan.changes);
		sendDoc(pasted, 2);
		assert.strictEqual(store.getState().remap?.to(before[1].index), tds(pasted)[1].index, '붙여넣기');
		// 붙여넣기가 아닌 구조 변경(삭제·Undo 등)도 바뀐 범위로 따라감
		sendDoc(text, 3);
		assert.strictEqual(store.getState().remap?.to(tds(pasted)[1].index), before[1].index, 'Undo');
		// 같은 속성 td 하나를 지우면 문자 비교 범위가 남은 td 앞부분에 걸침 → 끝 위치로 찾음
		const removed = text.replace('<group tagname="td" class="w2tb_td"/>', '');
		sendDoc(removed, 4);
		assert.strictEqual(store.getState().remap?.to(before[1].index), tds(removed)[0].index, '앞 td 삭제');
		assert.strictEqual(store.getState().remap?.to(before[0].index), undefined, '지운 td는 펼침 상태 버림');
	});
});
