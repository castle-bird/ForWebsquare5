import * as assert from 'assert';
import { projectDrop, type FlatRow } from '../core/outlineDrop';

suite('Outline 끌어 놓을 자리 (projectDrop)', () => {
	// body > g_main(펼침) > [wfm_header, g_sh(접힘), g_ly], g_tail. 줄 높이 24
	const H = 24;
	const row = (index: number, depth: number, at: number, container = false, open = false): FlatRow => ({ index, depth, container, open, top: at * H, bottom: (at + 1) * H });
	const body = row(1, 0, 0, true, true), main = row(2, 1, 1, true, true), wfm = row(3, 2, 2), sh = row(4, 2, 3, true), ly = row(5, 2, 4, true), tail = row(6, 1, 5, true);
	const yIn = (r: FlatRow, ratio: number) => r.top + (r.bottom - r.top) * ratio;

	test('마지막 자식 아래 틈: 가로로 안 움직이면 같은 단계, 왼쪽으로 한 단계 끌면 바깥 그릇 뒤', () => {
		const rows = [body, main, wfm, sh, tail]; // g_ly를 끄는 중
		assert.deepStrictEqual(projectDrop(rows, yIn(sh, 0.9), 0, 2), { target: sh.index, position: 'after', parent: main.index, line: { y: sh.bottom, depth: 2 } });
		assert.deepStrictEqual(projectDrop(rows, yIn(sh, 0.9), -20, 2), { target: main.index, position: 'after', parent: body.index, line: { y: sh.bottom, depth: 1 } });
		// 다음 줄(g_tail)이 1단계라 그보다 바깥(0단계)으로는 못 감
		assert.strictEqual(projectDrop(rows, yIn(sh, 0.9), -100, 2)?.parent, body.index);
	});

	test('펼친 그릇 바로 아래 틈은 그 안 맨 앞, 그릇 가운데는 그 안 맨 뒤', () => {
		const rows = [body, main, wfm, sh, ly]; // g_tail을 끄는 중
		assert.deepStrictEqual(projectDrop(rows, yIn(main, 0.9), 0, 1), { target: wfm.index, position: 'before', parent: main.index, line: { y: main.bottom, depth: 2 } });
		assert.deepStrictEqual(projectDrop(rows, yIn(sh, 0.5), 0, 1), { target: sh.index, position: 'inside', parent: sh.index });
		// 그릇이 아니면 가운데도 앞·뒤
		assert.strictEqual(projectDrop(rows, yIn(wfm, 0.5), 0, 1)?.position, 'after');
	});

	test('트리 아래 빈 곳은 가장 바깥 단계, body 줄은 그 안, body 위는 놓을 수 없음', () => {
		const rows = [body, main, wfm, ly, tail]; // g_sh를 끄는 중
		assert.deepStrictEqual(projectDrop(rows, tail.bottom + H * 2, 40, 2), { target: tail.index, position: 'after', parent: body.index, line: { y: tail.bottom, depth: 1 } });
		assert.deepStrictEqual(projectDrop(rows, yIn(body, 0.9), 0, 2), { target: body.index, position: 'inside', parent: body.index });
		assert.strictEqual(projectDrop(rows, -5, 0, 2), undefined);
	});
});
