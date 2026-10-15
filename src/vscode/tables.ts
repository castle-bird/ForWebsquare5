// ERD 사용 테이블: 이 PC에 고른 폴더(작업 공간마다 기억)의 화면별 JSON을 읽고 쓴다. 화면 XML은 건드리지 않는다.
// JSON을 바깥(AI·사람·공유받은 파일)에서 고치면 다시 읽어 그림에 반영한다(양방향)
import * as path from 'path';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { emptyTables, readUsedTables } from '../core/tables';
import type { ToExtension, ToWebview } from '../core/protocol';

const FOLDER_KEY = 'for-websquare5.usedTablesFolder';
type TablesMessage = Extract<ToExtension, { type: 'loadUsedTables' | 'saveUsedTables' | 'chooseTablesFolder' | 'saveTablesImage' }>;

export class UsedTablesStore {
	/** 저장은 차례로(빠르게 연달아 고쳐도 옛 내용이 새 내용을 덮지 않게) */
	private saving: Promise<unknown> = Promise.resolve();
	/** 지금 보는 JSON 파일 감시 */
	private watcher?: { file: string; watcher: vscode.FileSystemWatcher; timer?: NodeJS.Timeout };
	/** 이 저장소가 마지막으로 읽거나 쓴 JSON 글자. 감시에 걸린 내용이 이것과 같으면 우리가 쓴 것이라 다시 읽지 않는다 */
	private known?: string;

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
		this.watch(file);
		if (!folder || !file) { await this.post({ type: 'usedTables' }); return; }
		try {
			const text = await fs.readFile(file, 'utf8');
			this.known = text;
			const data = readUsedTables(JSON.parse(text));
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
		const text = JSON.stringify(readUsedTables(data), null, '\t') + '\n';
		this.known = text;
		await fs.writeFile(file, text, 'utf8');
	}

	/** file을 감시한다(저장 폴더를 바꾸면 새 파일로). 아직 없는 파일도 생기면 알린다 */
	private watch(file: string | undefined): void {
		if (this.watcher?.file === file) { return; }
		this.unwatch();
		this.known = undefined;
		if (!file) { return; }
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)), false, false, true);
		const w: { file: string; watcher: vscode.FileSystemWatcher; timer?: NodeJS.Timeout } = { file, watcher };
		// 나눠 쓰는 도구도 있어 잠깐 모았다가 읽는다. 저장과 겹치지 않게 저장 차례에 끼운다
		const changed = () => {
			clearTimeout(w.timer);
			w.timer = setTimeout(() => { this.saving = this.saving.then(() => this.reload(file)).catch(() => undefined); }, RELOAD_DELAY);
		};
		watcher.onDidChange(changed);
		watcher.onDidCreate(changed);
		this.watcher = w;
	}

	private unwatch(): void {
		clearTimeout(this.watcher?.timer);
		this.watcher?.watcher.dispose();
		this.watcher = undefined;
	}

	/** 바깥에서 고친 JSON을 다시 읽어 보낸다. 깨진 JSON(쓰는 중 등)이면 그림은 그대로 두고 알리기만 한다 */
	private async reload(file: string): Promise<void> {
		const where = this.where();
		if (where.file !== file || this.watcher?.file !== file) { return; }
		let text: string;
		try {
			text = await fs.readFile(file, 'utf8');
		} catch {
			return;
		}
		if (text === this.known) { return; }
		this.known = text;
		let data;
		try {
			data = readUsedTables(JSON.parse(text));
		} catch (e) {
			await this.post({ type: 'usedTables', ...where, error: `바뀐 JSON을 읽지 못해 그림에 반영하지 않았습니다(JSON을 고치면 다시 반영하고, 그림을 고치면 JSON을 덮어씁니다): ${message(e)}` });
			return;
		}
		await this.post({ type: 'usedTables', ...where, data, external: true });
	}

	dispose(): void {
		this.unwatch();
	}
}

/** 바깥 수정을 모으는 시간 */
const RELOAD_DELAY = 150;

const PNG_DATA = 'data:image/png;base64,';

const message = (e: unknown) => e instanceof Error ? e.message : String(e);
