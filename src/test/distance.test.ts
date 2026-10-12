import * as assert from 'assert';
import { distanceLines, type Bounds } from '../webview/design/distance';

suite('distance measurement', () => {
	const box = (left: number, top: number, width: number, height: number): Bounds => ({ left, top, right: left + width, bottom: top + height });
	const values = (a: Bounds, b: Bounds) => distanceLines(a, b).map(l => Math.abs(l.horizontal ? l.x2 - l.x1 : l.y2 - l.y1));
	test('가로·세로·대각선 간격과 역방향, 맞닿은 경계', () => {
		const a = box(10, 20, 100, 50), right = box(150, 30, 80, 20), below = box(40, 100, 50, 30);
		assert.deepStrictEqual(distanceLines(a, right), [{ horizontal: true, x1: 110, y1: 40, x2: 150, y2: 40 }]);
		assert.deepStrictEqual(distanceLines(right, a), distanceLines(a, right));
		assert.deepStrictEqual(values(a, below), [30]);
		assert.deepStrictEqual(values(below, a), [30]);
		assert.deepStrictEqual(distanceLines(a, box(150, 120, 100, 30)), [
			{ horizontal: true, x1: 110, y1: 45, x2: 150, y2: 45, guide: { x1: 150, y1: 45, x2: 150, y2: 120 } },
			{ horizontal: false, x1: 60, y1: 70, x2: 60, y2: 120, guide: { x1: 60, y1: 120, x2: 150, y2: 120 } },
		]);
		assert.deepStrictEqual(values(a, box(110, 20, 40, 50)), [0]);
		assert.strictEqual(distanceLines(a, box(10, 70, 100, 50))[0].horizontal, false, '0px도 측정 방향 유지');
	});
	test('포함·부분 겹침은 네 경계 차이, 소수 좌표 유지', () => {
		const inner = box(50, 60, 100, 40), outer = box(10, 20, 300, 200);
		assert.deepStrictEqual(values(inner, outer), [40, 160, 40, 120]);
		assert.deepStrictEqual(values(outer, inner), [40, 160, 40, 120]);
		assert.deepStrictEqual(values(box(10, 20, 100, 50), box(80, 50, 80, 50)), [70, 50, 30, 30]);
		assert.deepStrictEqual(values(box(0, 0, 10.5, 20), box(20.75, 0, 10, 20)), [10.25]);
	});
});
