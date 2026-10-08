// ERD 사용 테이블: 이 PC에 고른 폴더(작업 공간마다 기억)의 화면별 JSON을 읽고 쓴다. 화면 XML은 건드리지 않는다
import * as path from 'path';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { emptyTables, readUsedTables } from '../core/tables';
import type { ToExtension, ToWebview } from '../core/protocol';

const FOLDER_KEY = 'websquare5-editor.usedTablesFolder';
type TablesMessage = Extract<ToExtension, { type: 'loadUsedTables' | 'saveUsedTables' | 'chooseTablesFolder' | 'saveTablesImage' }>;

export class UsedTablesStore {
	/** 저장은 차례로(빠르게 연달아 고쳐도 옛 내용이 새 내용을 덮지 않게) */
	private saving: Promise<unknown> = Promise.resolve();

	constructor(private readonly screen: vscode.Uri, private readonly state: vscode.Memento, private readonly defaultFolder: vscode.Uri,
		private readonly post: (msg: ToWebview) => Thenable<unknown>) {}

	/** 처리한 메시지면 true */
	handle(msg: ToExtension): msg is TablesMessage {
		switch (msg.type) {
			case 'loadUsedTables': void this.load(); return true;
			case 'chooseTablesFolder': void this.choose(msg.pick); return true;
			case 'saveUsedTables': {
				this.saving = this.saving.then(() => this.save(msg.data)).catch(e => this.post({ type: 'usedTables', ...this.where(), error: `저장 실패: ${message(e)}` }));
				return true;
			}
			case 'saveTablesImage': void this.saveImage(msg.dataUrl).catch(e => vscode.window.showErrorMessage(`이미지 저장 실패: ${message(e)}`)); return true;
			default: return false;
		}
	}

	private where() {
		const folder = this.state.get<string>(FOLDER_KEY);
		// 작업 폴더 밖 화면이면 파일 이름만
		const relative = vscode.workspace.getWorkspaceFolder(this.screen) ? vscode.workspace.asRelativePath(this.screen, false) : path.basename(this.screen.fsPath);
		return { folder, file: folder && path.join(folder, relative.replace(/\.xml$/i, '') + '.json') };
	}

	private async load(): Promise<void> {
		const { folder, file } = this.where();
		if (!folder || !file) { await this.post({ type: 'usedTables' }); return; }
		try {
			const data = readUsedTables(JSON.parse(await fs.readFile(file, 'utf8')));
			await this.post({ type: 'usedTables', folder, file, data });
		} catch (e) {
			const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
			await this.post({ type: 'usedTables', folder, file, data: emptyTables(), ...!missing && { error: `읽기 실패(빈 목록으로 시작하며, 저장하면 덮어씁니다): ${message(e)}` } });
		}
	}

	private async choose(pick: boolean): Promise<void> {
		let folder = this.defaultFolder.fsPath;
		if (pick) {
			const [uri] = await vscode.window.showOpenDialog({ title: '사용 테이블 저장 폴더', canSelectFolders: true, canSelectFiles: false, canSelectMany: false }) ?? [];
			if (!uri) { return; }
			folder = uri.fsPath;
		}
		await this.state.update(FOLDER_KEY, folder);
		await this.load();
	}

	/** ERD 그림 PNG: 기본 위치는 JSON 옆(폴더를 안 골랐으면 화면 옆) 같은 이름 */
	private async saveImage(dataUrl: string): Promise<void> {
		if (!dataUrl.startsWith(PNG_DATA)) { throw new Error('PNG가 아닙니다.'); }
		const { file } = this.where();
		const defaultUri = vscode.Uri.file(file ? file.replace(/\.json$/i, '.png') : this.screen.fsPath.replace(/\.xml$/i, '') + '.png');
		const uri = await vscode.window.showSaveDialog({ title: 'ERD 이미지 저장', defaultUri, filters: { 'PNG 이미지': ['png'] } });
		if (!uri) { return; }
		await fs.mkdir(path.dirname(uri.fsPath), { recursive: true });
		await fs.writeFile(uri.fsPath, Buffer.from(dataUrl.slice(PNG_DATA.length), 'base64'));
		void vscode.window.showInformationMessage(`ERD 이미지를 저장했습니다: ${path.basename(uri.fsPath)}`);
	}

	private async save(data: unknown): Promise<void> {
		const { file } = this.where();
		if (!file) { return; }
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, JSON.stringify(readUsedTables(data), null, '\t') + '\n', 'utf8');
	}
}

const PNG_DATA = 'data:image/png;base64,';

const message = (e: unknown) => e instanceof Error ? e.message : String(e);
