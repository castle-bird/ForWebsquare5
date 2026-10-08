import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ToWebview } from '../../core/protocol';
import { UsedTablesStore } from '../../vscode/tables';

suite('ERD 사용 테이블 저장소 (VS Code)', () => {
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
		assert.deepStrictEqual(sent[1], { type: 'usedTables', folder, file, data: { tables: [], links: [], memos: [], groups: [], shapes: [] } });
		const data = {
			tables: [{ id: 'a', name: 'TB_A', desc: '', crud: ['R' as const], columns: [{ id: 'c', name: 'ID', desc: '', type: '', pk: true }], keysOnly: false, color: 'green' as const, x: 1, y: 2 }],
			memos: [{ id: 'm', text: '메모', color: 'blue' as const, x: 0, y: 0, w: 200, h: 100 }],
			groups: [{ id: 'g', title: '묶음', color: 'gray' as const, x: -10, y: -10, w: 500, h: 400 }],
			shapes: [{ id: 's', kind: 'ellipse' as const, text: '시작', color: 'red' as const, x: 5, y: 6, w: 64, h: 32 }],
			links: [{ from: 'm', to: 'a', arrow: 'end' as const, label: '' }, { from: 's', to: 'a', arrow: 'both' as const, label: '' }],
		};
		store.handle({ type: 'saveUsedTables', data });
		await waitFor(() => fs.existsSync(file));
		await waitFor(() => JSON.parse(fs.readFileSync(file, 'utf8')).tables?.[0]?.name === 'TB_A');
		store.handle({ type: 'loadUsedTables' });
		await waitFor(() => sent.length === 3);
		assert.deepStrictEqual((sent[2] as Extract<ToWebview, { type: 'usedTables' }>).data, data);
	});
});
