import * as assert from 'assert';
import { readUsedTables } from '../core/tables';

suite('ERD 사용 테이블 저장 파일', () => {
	test('사람이 고친 JSON도 모양에 맞추고, 없는 테이블·메모를 잇는 선·겹친 선·모르는 CRUD·화살표·색은 버림', () => {
		const data = readUsedTables({
			tables: [
				{ id: 'a', name: 'TB_A', desc: 'A', crud: ['U', 'R', 'X'], x: 10, y: 'bad', keysOnly: true, color: 'orange',
					columns: [{ id: 'c1', name: 'ID', type: 'NUMBER', pk: true }, { name: 'id 없음' }, { id: 'c2', name: 'NM', pk: 'yes' }] },
				{ id: 'b', name: 'TB_B', color: 'teal' },
				{ name: 'id 없음' },
				null,
			],
			memos: [{ id: 'm', text: '설명', color: 'magenta', x: 5, w: 10 }, { text: 'id 없음' }],
			groups: [{ id: 'g', title: '조회', color: 'green', x: 1, y: 2, w: 300, h: 'bad' }],
			shapes: [{ id: 's', kind: 'triangle', color: 'magenta', x: 3, y: 4, w: 2 }, { id: 'd', kind: 'diamond', text: 1 }, { id: 'bad', kind: 'star' }, { kind: 'rect' }],
			links: [{ from: 'a', to: 'b' }, { from: 'a', to: 'gone' }, { from: 'a', to: 'a' }, 'bad', { from: 'b', to: 'a' },
				{ from: 'm', to: 'a', arrow: 'both', label: '참고' }, { from: 'b', to: 'm', arrow: 'up', label: 3 }, { from: 'g', to: 'a' }, { from: 's', to: 'a', arrow: 'end' }, { from: 'bad', to: 'a' }],
			extra: true,
		});
		assert.deepStrictEqual(data, {
			tables: [
				{ id: 'a', name: 'TB_A', desc: 'A', crud: ['R', 'U'], x: 10, y: 0, keysOnly: true, color: 'orange',
					columns: [{ id: 'c1', name: 'ID', desc: '', type: 'NUMBER', pk: true }, { id: 'c2', name: 'NM', desc: '', type: '', pk: false }] },
				{ id: 'b', name: 'TB_B', desc: '', crud: [], columns: [], keysOnly: false, color: '', x: 0, y: 0 },
			],
			// 화살표 없던 옛 파일의 선은 화살표 없음, 그룹은 선으로 잇지 않음
			links: [{ from: 'a', to: 'b', arrow: 'none', label: '' }, { from: 'm', to: 'a', arrow: 'both', label: '참고' }, { from: 'b', to: 'm', arrow: 'none', label: '' },
				{ from: 's', to: 'a', arrow: 'end', label: '' }],
			memos: [{ id: 'm', text: '설명', color: 'yellow', x: 5, y: 0, w: 40, h: 140 }],
			groups: [{ id: 'g', title: '조회', color: 'green', x: 1, y: 2, w: 300, h: 320 }],
			// 도형: 모르는 모양은 버림, 색 기본 파랑, 너무 작으면 최소 크기
			shapes: [{ id: 's', kind: 'triangle', text: '', color: 'blue', x: 3, y: 4, w: 8, h: 128 }, { id: 'd', kind: 'diamond', text: '', color: 'blue', x: 0, y: 0, w: 128, h: 128 }],
		});
		const empty = { tables: [], links: [], memos: [], groups: [], shapes: [] };
		assert.deepStrictEqual(readUsedTables(null), empty);
		assert.deepStrictEqual(readUsedTables('text'), empty);
	});
});
