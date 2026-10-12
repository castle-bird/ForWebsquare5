import * as assert from 'assert';
import * as path from 'path';
import { runInNewContext } from 'vm';
import { buildSync } from 'esbuild';
import { EditorState } from '@codemirror/state';
const { defaultHighlightStyle, syntaxHighlighting, syntaxTree } = require('@codemirror/language');
const { javascript } = require('@codemirror/lang-javascript');

suite('Minimap initial colors', () => {
	test('스크롤 없이 아래쪽 색칠, 스크롤 프레임 파싱 없음·유휴 예산·그림 캐시 유지', () => {
		const idle: (() => void)[] = [];
		let scheduled = 0;
		const copies: number[] = [];
		const fills: { color: string; y: number; width: number }[] = [];
		const context = { fillStyle: '', globalAlpha: 1, setTransform() {}, drawImage(_image: unknown, _x: number, y: number) { copies.push(y); }, fillRect(_x: number, y: number, width: number) { fills.push({ color: this.fillStyle, y, width }); } };
		const bundle = buildSync({ entryPoints: [path.resolve(__dirname, '../../src/webview/editor/minimap.ts')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false });
		interface Plugin {
			view: { state: EditorState; dom: { offsetParent: boolean } };
			paintTile(first: number, last: number, width: number, ratio: number): void;
			parse(to: number): void;
			parsedTo: number; parseTo: number; idle: number; typingUntil: number;
			stale: boolean; tileRows: number; tileStart: number; tile: unknown;
			schedule(): void; color(classes: string): string;
		}
		const module = { exports: {} as { minimap: [{ prototype: Plugin }] } };
		const budgets: number[] = [];
		runInNewContext(bundle.outputFiles[0].text, {
			module, exports: module.exports, performance,
			requestIdleCallback: (callback: (deadline: { timeRemaining(): number }) => void) => { idle.push(() => callback({ timeRemaining: () => 10 })); return idle.length; },
			cancelIdleCallback() {},
			document: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) },
			require: (name: string) => {
				const actual = require(name);
				if (name === '@codemirror/view') { return { ...actual, ViewPlugin: { fromClass: (value: unknown) => value } }; }
				if (name === '@codemirror/language') { return { ...actual, ensureSyntaxTree: (state: EditorState, to: number, budget: number) => { budgets.push(budget); return actual.ensureSyntaxTree(state, to, budget); } }; }
				return actual;
			},
		});
		const state = EditorState.create({ doc: Array.from({ length: 6000 }, (_, i) => 'const value' + i + ' = "color";').join('\n'), extensions: [javascript(), syntaxHighlighting(defaultHighlightStyle)] });
		const plugin = Object.assign(Object.create(module.exports.minimap[0].prototype) as Plugin, {
			view: { state, dom: { offsetParent: true } }, idle: 0, parseTo: 0, parsedTo: 0, typingUntil: 0,
			stale: true, tileRows: 0, tileStart: 0, tile: { width: 72 }, textColor: 'gray', changeColors: {},
			schedule: () => { scheduled++; }, color: () => 'syntax',
		});
		const last = 800, to = state.doc.line(last).to;
		assert.ok(syntaxTree(state).length < to, '초기 부분 파싱 상태 재현');
		plugin.paintTile(1, last, 72, 1);
		assert.strictEqual(budgets.length, 0, '스크롤·그리기 프레임에서는 파싱하지 않음');
		assert.ok(!fills.some(f => f.y === (last - 1) * 2 && f.color === 'syntax'), '부분 트리의 아래쪽은 처음엔 기본색');
		for (let count = 0; idle.length && count < 1000; count++) { idle.shift()!(); }
		assert.ok(plugin.parsedTo >= to, '유휴 작업으로 그릴 범위 파싱 완료');
		assert.ok(budgets.length && budgets.every(b => b === 4), '유휴 파싱 예산 4ms');
		assert.strictEqual(scheduled, 1, '완료될 때 한 번만 다시 그림');
		fills.length = 0;
		plugin.paintTile(1, last, 72, 1);
		assert.ok(fills.some(f => f.y === (last - 1) * 2 && f.color === 'syntax'), '스크롤 없이 아래쪽 색칠');
		fills.length = 0;
		plugin.paintTile(1, last, 72, 1);
		assert.strictEqual(fills.length, 0, '같은 범위는 그림 캐시 재사용');
		assert.strictEqual(idle.length, 0, '파싱 완료 범위는 추가 작업 없음');
		copies.length = 0;
		plugin.paintTile(2, last + 1, 72, 1);
		assert.strictEqual(copies[0], -2, '아래로 스크롤하면 캐시의 겹친 줄은 위로 이동');
		copies.length = 0;
		plugin.paintTile(1, last, 72, 1);
		assert.strictEqual(copies[0], 2, '위로 스크롤하면 캐시의 겹친 줄은 아래로 이동');
		plugin.view.state = EditorState.create({ doc: 'x'.repeat(20000) });
		plugin.stale = true;
		fills.length = 0;
		plugin.paintTile(1, 1, 72, 1);
		assert.ok(fills.some(f => f.color === 'gray' && f.width === 64), '폭을 넘는 긴 단어도 보이는 구간은 그린다');
	});
});
