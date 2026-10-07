import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { readUsedTables } from '../core/tables';
import type { ToWebview } from '../core/protocol';
import { UsedTablesStore } from '../vscode/tables';

suite('ERD 사용 테이블 저장 파일', () => {
	test('사람이 고친 JSON도 모양에 맞추고, 없는 테이블·메모를 잇는 선·겹친 선·모르는 CRUD·화살표·색은 버림', () => {
		const data = readUsedTables({
			tables: [
				{ id: 'a', name: 'TB_A', desc: 'A', crud: ['U', 'R', 'X'], x: 10, y: 'bad', keysOnly: true,
					columns: [{ id: 'c1', name: 'ID', type: 'NUMBER', pk: true }, { name: 'id 없음' }, { id: 'c2', name: 'NM', pk: 'yes' }] },
				{ id: 'b', name: 'TB_B' },
				{ name: 'id 없음' },
				null,
			],
			memos: [{ id: 'm', text: '설명', color: 'pink', x: 5, w: 10 }, { text: 'id 없음' }],
			groups: [{ id: 'g', title: '조회', color: 'green', x: 1, y: 2, w: 300, h: 'bad' }],
			links: [{ from: 'a', to: 'b' }, { from: 'a', to: 'gone' }, { from: 'a', to: 'a' }, 'bad', { from: 'b', to: 'a' },
				{ from: 'm', to: 'a', arrow: 'both', label: '참고' }, { from: 'b', to: 'm', arrow: 'up', label: 3 }, { from: 'g', to: 'a' }],
			extra: true,
		});
		assert.deepStrictEqual(data, {
			tables: [
				{ id: 'a', name: 'TB_A', desc: 'A', crud: ['R', 'U'], x: 10, y: 0, keysOnly: true,
					columns: [{ id: 'c1', name: 'ID', desc: '', type: 'NUMBER', pk: true }, { id: 'c2', name: 'NM', desc: '', type: '', pk: false }] },
				{ id: 'b', name: 'TB_B', desc: '', crud: [], columns: [], keysOnly: false, x: 0, y: 0 },
			],
			// 화살표 없던 옛 파일의 선은 화살표 없음, 그룹은 선으로 잇지 않음
			links: [{ from: 'a', to: 'b', arrow: 'none', label: '' }, { from: 'm', to: 'a', arrow: 'both', label: '참고' }, { from: 'b', to: 'm', arrow: 'none', label: '' }],
			memos: [{ id: 'm', text: '설명', color: 'yellow', x: 5, y: 0, w: 40, h: 140 }],
			groups: [{ id: 'g', title: '조회', color: 'green', x: 1, y: 2, w: 300, h: 320 }],
		});
		const empty = { tables: [], links: [], memos: [], groups: [] };
		assert.deepStrictEqual(readUsedTables(null), empty);
		assert.deepStrictEqual(readUsedTables('text'), empty);
	});
});

suite('ERD 사용 테이블 저장소', () => {
	test('저장 폴더를 안 골랐으면 folder 없이, 고르면 화면 경로별 JSON으로 읽고 쓴다', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-tables-'));
		const values = new Map<string, unknown>();
		const memento = { get: (k: string) => values.get(k), update: async (k: string, v: unknown) => { values.set(k, v); }, keys: () => [...values.keys()] } as unknown as vscode.Memento;
		const sent: ToWebview[] = [];
		const waitFor = async (test: () => boolean) => { for (let i = 0; i < 100 && !test(); i++) { await new Promise(r => setTimeout(r, 20)); } assert.ok(test(), JSON.stringify(sent)); };
		const store = new UsedTablesStore(vscode.Uri.file(path.join(dir, 'BM003M01.xml')), memento, vscode.Uri.file(path.join(dir, 'store')), async m => { sent.push(m); });
		store.handle({ type: 'loadUsedTables' });
		await waitFor(() => sent.length === 1);
		assert.deepStrictEqual(sent[0], { type: 'usedTables' });
		store.handle({ type: 'chooseTablesFolder', pick: false });
		await waitFor(() => sent.length === 2);
		// VS Code 경로 표기(드라이브 글자 소문자)
		const folder = vscode.Uri.file(path.join(dir, 'store')).fsPath, file = path.join(folder, 'BM003M01.json');
		assert.deepStrictEqual(sent[1], { type: 'usedTables', folder, file, data: { tables: [], links: [], memos: [], groups: [] } });
		const data = {
			tables: [{ id: 'a', name: 'TB_A', desc: '', crud: ['R' as const], columns: [{ id: 'c', name: 'ID', desc: '', type: '', pk: true }], keysOnly: false, x: 1, y: 2 }],
			memos: [{ id: 'm', text: '메모', color: 'blue' as const, x: 0, y: 0, w: 200, h: 100 }],
			groups: [{ id: 'g', title: '묶음', color: 'gray' as const, x: -10, y: -10, w: 500, h: 400 }],
			links: [{ from: 'm', to: 'a', arrow: 'end' as const, label: '' }],
		};
		store.handle({ type: 'saveUsedTables', data });
		await waitFor(() => fs.existsSync(file));
		await waitFor(() => JSON.parse(fs.readFileSync(file, 'utf8')).tables?.[0]?.name === 'TB_A');
		store.handle({ type: 'loadUsedTables' });
		await waitFor(() => sent.length === 3);
		assert.deepStrictEqual((sent[2] as Extract<ToWebview, { type: 'usedTables' }>).data, data);
	});
});
