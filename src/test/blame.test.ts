import * as assert from 'assert';
import { lineOfOffset, parseBlame, sliceBlame } from '../core/blame';

suite('Git blame', () => {
	test('porcelain 출력(--contents로 저장 안 한 새 줄 포함)을 줄별 작성자·시각으로, 같은 커밋은 처음 한 번만 정보가 온다', () => {
		const out = "a21a5b81914dd3ff36c4071acd202b99c64508e1 1 1 1\nauthor 홍길동\nauthor-time 1791162000\n\ta\n364609cd8f06a81a89e3ad63762a7ba543aa4634 2 2 1\nauthor Kim Lee\nauthor-time 1791443909\n\tB\n0000000000000000000000000000000000000000 3 3 1\nauthor External file (--contents)\nauthor-time 1791443909\n\tnew\na21a5b81914dd3ff36c4071acd202b99c64508e1 3 4 1\n\tc";
		const b = parseBlame(out);
		assert.deepStrictEqual(b, { authors: ['홍길동', 'Kim Lee'], author: [0, 1, -1, 0], time: [1791162000, 1791443909, 1791443909, 1791162000] });
		// Script 본문처럼 일부 줄만
		assert.deepStrictEqual(sliceBlame(b, 1, 2), { authors: ['홍길동', 'Kim Lee'], author: [1, -1], time: [1791443909, 1791443909] });
		assert.strictEqual(lineOfOffset('x\r\ny\nz', 5), 2);
		assert.strictEqual(lineOfOffset('xyz', 2), 0);
	});
});
