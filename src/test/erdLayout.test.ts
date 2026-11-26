import * as assert from 'assert';
import { estimateTableSize, layoutFlat, placeNewTables } from '../core/erdLayout';
import { emptyTables, type UsedTable, type UsedTables } from '../core/tables';

const table = (id: string, name: string, x = 0, y = 0): UsedTable => ({
	id, name, desc: '', crud: ['R'], columns: [{ id: `${id}-c1`, name: 'ID', desc: '', type: 'VARCHAR', pk: true }],
	keysOnly: false, color: '', x, y,
});

suite('erdLayout (@dagrejs/dagre)', () => {
	test('layoutFlat: 연결된 노드를 LR 방향으로 겹침 없이 배치한다', () => {
		const { positions, width, height } = layoutFlat(
			[{ id: 'a', w: 200, h: 64 }, { id: 'b', w: 200, h: 64 }, { id: 'c', w: 200, h: 64 }],
			[{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
		);
		assert.ok(positions.get('a')!.x < positions.get('b')!.x && positions.get('b')!.x < positions.get('c')!.x);
		assert.ok(width >= 600 && height >= 64);
	});

	test('placeNewTables: 기존 테이블 오른쪽 빈자리에 겹치지 않게 배치한다', () => {
		const current: UsedTables = { ...emptyTables(), tables: [table('t0', 'TB_OLD', 100, 120)] };
		const placed = placeNewTables(current, [table('t1', 'TB_A'), table('t2', 'TB_B')], [{ from: 't1', to: 't2', arrow: 'none', label: '' }]);
		const oldBox = { x: 100, y: 120, ...estimateTableSize(current.tables[0]) };
		for (const t of placed) {
			assert.ok(t.x >= oldBox.x + oldBox.w + 80);
		}
		assert.ok(placed[0].x < placed[1].x);
	});
});
