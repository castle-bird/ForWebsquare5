// 화면 XML마다 연결한 서버 쪽 파일(탭 id → 경로). 연결 정보는 개인 저장소(workspaceState). 탭 목록은 linkTabs.ts
import * as path from 'node:path';
import * as vscode from 'vscode';
import { cleanPath, linkIdOf, linkProblem, linkTarget, type LinkTab } from '../core/links';
import { errorMessage } from '../core/errors';
import { serial } from '../project/paths';
import type { CodeChange, RemoteCompletions, ToExtension, ToWebview } from '../core/protocol';
import { closeAutoTabs, isOpenByUser, registerAutoTabs } from './autoTabs';
import { remoteCompletions } from './completion';
import { applyCodeEdit, formatCode } from './documentEdit';
import { stagedText } from './gitBase';
import { xmlSchemaOf } from './xmlSchema';
import { doctypeOf } from '../core/dtd';
import { addLinkTab, LINK_EXTS_SETTING, linkExts, linkTab, linkTabs, onTabsChanged, registerLinkTabs, removeLinkTab, renameLinkTab, tabOrder } from './linkTabs';

type Saved = Record<string, string>;
/** LinkedFiles.handle이 맡는 메시지 */
type LinkMessage = Extract<ToExtension, { type: 'link' | 'unlink' | 'openLink' | 'saveLink' | 'addTab' | 'renameTab' | 'removeTab' | 'complete' | 'findFiles' }>;

const KEY = 'websquare5-editor.links:';
/** 경로 입력 파일 검색: 확장자별 최대 개수 */
const MAX_FILES_PER_EXT = 10000;

let workspaceState: vscode.Memento;
/** 연결이 바뀐 화면(fsPath). undefined면 전부 */
const changed = new vscode.EventEmitter<string | undefined>();
/** 열린 디자이너들이 연결 중인 파일(uri → 개수): 다른 화면이 아직 보고 있으면 닫을 때 묻지 않는다 */
const used = new Map<string, number>();

export function registerLinks(context: vscode.ExtensionContext): void {
	workspaceState = context.workspaceState;
	registerLinkTabs(context);
	registerAutoTabs(context, uri => used.has(uri));
	context.subscriptions.push(changed, vscode.workspace.onDidRenameFiles(e => void followRenames(e.files)),
		// 없어진 탭의 연결은 이 작업 폴더의 모든 화면에서 지운다(디자이너들은 탭 변경 알림으로 다시 맞춘다)
		onTabsChanged(({ tabs }) => void forgetRemovedTabs(new Set(tabs.map(t => t.id)))));
}

async function forgetRemovedTabs(ids: Set<string>) {
	for (const key of workspaceState.keys().filter(k => k.startsWith(KEY))) {
		const saved = workspaceState.get<Saved>(key) ?? {}, kept = Object.fromEntries(Object.entries(saved).filter(([id]) => ids.has(id)));
		if (Object.keys(kept).length !== Object.keys(saved).length) {
			await workspaceState.update(key, kept);
		}
	}
}

const renamed = (file: string, from: string, to: string) =>
	file === from ? to : file.startsWith(from + path.sep) ? to + file.slice(from.length) : file;

async function followRenames(files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]) {
	const move = (file: string) => files.reduce((f, { oldUri, newUri }) => renamed(f, oldUri.fsPath, newUri.fsPath), file);
	let touched = false;
	for (const key of workspaceState.keys().filter(k => k.startsWith(KEY))) {
		const owner = move(key.slice(KEY.length)), saved = workspaceState.get<Saved>(key) ?? {};
		const next = Object.fromEntries(Object.entries(saved).map(([kind, file]) => [kind, move(file)]));
		if (KEY + owner !== key || JSON.stringify(next) !== JSON.stringify(saved)) {
			touched = true;
			await workspaceState.update(key, undefined);
			await workspaceState.update(KEY + owner, next);
		}
	}
	if (touched) {
		changed.fire(undefined);
	}
}

async function isFile(uri: vscode.Uri): Promise<boolean> {
	try {
		return (await vscode.workspace.fs.stat(uri)).type === vscode.FileType.File;
	} catch {
		return false;
	}
}

/** 디자이너에서만 보던 연결 파일(사용자가 연 VS Code 탭·다른 디자이너에 없음)의 저장 안 한 변경을 어떻게 할지 묻는다 */
async function settleChanges(uris: vscode.Uri[]): Promise<void> {
	const docs = vscode.workspace.textDocuments.filter(d => d.isDirty && uris.some(u => u.toString() === d.uri.toString())
		&& !used.get(d.uri.toString()) && !isOpenByUser(d.uri));
	if (!docs.length) {
		return;
	}
	const pick = await vscode.window.showWarningMessage(`연결 파일에 저장하지 않은 변경이 있습니다: ${docs.map(d => path.basename(d.fileName)).join(', ')}`,
		{ modal: true, detail: '취소하면 파일을 편집기로 열어 둡니다.' }, '저장', '저장 안 함');
	for (const doc of docs) {
		if (pick === '저장') {
			if (await doc.save()) {
				await closeAutoTabs(doc);
			}
		} else {
			await vscode.window.showTextDocument(doc, { preview: false });
			if (pick === '저장 안 함') {
				await vscode.commands.executeCommand('workbench.action.files.revert');
				await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
			}
		}
	}
}

interface Link {
	tab: LinkTab;
	uri: vscode.Uri;
	doc?: vscode.TextDocument;
	/** 웹뷰에 보내는 버전 = 문서 버전 + offset */
	offset: number;
	/** 웹뷰가 마지막으로 받은 버전·내용 */
	known?: { version: number; text: string };
	watcher: vscode.FileSystemWatcher;
	timer?: NodeJS.Timeout;
	/** 웹뷰에 보낸 변경 표시 기준(Git 스테이지 내용) */
	base?: string;
	/** 웹뷰에 보낸 XML 스키마의 DOCTYPE(바뀔 때만 다시 찾는다) */
	schema?: string;
}

export class LinkedFiles {
	private readonly links = new Map<string, Link>();
	private readonly subs: vscode.Disposable[];
	private disposed = false;
	/** reload는 여러 곳(웹뷰 준비·연결 변경·탭 변경·이름 변경)에서 불려 차례로 돌린다(겹치면 연결을 두 번 잡거나 놓친다) */
	private readonly reloads = new Map<string, Promise<unknown>>();

	constructor(private readonly owner: vscode.TextDocument, private readonly postToWebview: (msg: ToWebview) => Thenable<boolean>) {
		this.subs = [
			changed.event(owner => (owner === undefined || owner === this.owner.uri.fsPath) && void this.reload()),
			// 탭 이름이 바뀌면 순서(이름으로 저장)도 바뀌므로 같이 보낸다
			onTabsChanged(({ from, select }) => void this.post({ type: 'tabOrder', order: tabOrder() ?? [] }).then(() => this.reload(from === this ? select : undefined))),
			// 내용이 그대로여도 저장 안 함 표시가 바뀌면 불린다
			vscode.workspace.onDidChangeTextDocument(e => this.schedule(this.kindOf(e.document.uri))),
			vscode.workspace.onDidSaveTextDocument(d => this.schedule(this.kindOf(d.uri), 0)),
			// 연결할 수 있는 확장자가 바뀌면 웹뷰 안내·검색 목록을 다시
			vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration(LINK_EXTS_SETTING) && void this.reload()),
		];
	}

	/** 디자이너를 닫은 뒤 늦게 끝난 작업은 보내지 않는다 */
	private async post(msg: ToWebview): Promise<void> {
		if (!this.disposed) {
			await Promise.resolve(this.postToWebview(msg)).catch(() => undefined);
		}
	}

	/** 연결 탭 메시지(편집·포맷 말고)면 처리하고 true. 실패는 알림으로 */
	handle(msg: ToExtension): msg is LinkMessage {
		const run = (job: Promise<unknown>) => void job.catch(e => vscode.window.showErrorMessage(`연결 파일 작업 실패: ${errorMessage(e)}`));
		switch (msg.type) {
			case 'link': run(this.link(msg.kind, msg.path)); return true;
			case 'unlink': run(this.unlink(msg.kind)); return true;
			case 'openLink': run(this.openLink(msg.kind)); return true;
			case 'saveLink': run(this.saveLink(msg.kind)); return true;
			case 'addTab': run(addLinkTab(this)); return true;
			case 'renameTab': run(renameLinkTab(msg.kind)); return true;
			case 'removeTab': run(removeLinkTab(msg.kind)); return true;
			case 'findFiles': run(this.findFiles(msg.kind)); return true;
			case 'complete': {
				// 읽기만 하므로 편집 대기열에 넣지 않는다(느린 언어 서버가 입력 반영을 막지 않게). 버전이 다르면 결과 없음
				const id = linkIdOf(msg.target);
				const result = id === undefined ? Promise.resolve(undefined) : this.complete(id, msg.version, msg.line, msg.ch, msg.trigger);
				void result.catch(() => undefined).then(r => this.post({ type: 'completions', id: msg.id, ...r }));
				return true;
			}
			default: return false;
		}
	}

	private get key() {
		return KEY + this.owner.uri.fsPath;
	}

	private saved(): Saved {
		return workspaceState.get<Saved>(this.key) ?? {};
	}

	private get folder(): vscode.Uri | undefined {
		return vscode.workspace.getWorkspaceFolder(this.owner.uri)?.uri;
	}

	/** 웹뷰에 보이는 경로: 이 화면의 작업 폴더 기준 상대 경로(입력한 상대 경로를 푸는 기준과 같음). 그 밖이면 절대 경로 */
	private shown(file: string, folder = this.folder?.fsPath): string {
		const rel = folder && path.relative(folder, file);
		return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : file;
	}

	private kindOf(uri: vscode.Uri): string | undefined {
		return [...this.links].find(([, link]) => link.uri.toString() === uri.toString())?.[0];
	}

	/**
	 * 탭 목록·저장된 연결로 맞추고 전부 보낸다 (웹뷰 준비·연결 변경·탭 추가/삭제·파일 이름 변경 뒤).
	 * 변경 표시 기준은 새로 연결한 파일만, fresh(웹뷰를 새로 띄움)면 전부 보낸다
	 */
	reload(select?: string, fresh = false): Promise<void> {
		return serial(this.reloads, 'reload', () => this.sync(select, fresh));
	}

	private async sync(select?: string, fresh = false): Promise<void> {
		if (this.disposed) {
			return;
		}
		if (fresh) {
			// 새로 띄운 웹뷰는 스키마를 모른다
			this.links.forEach(link => { link.schema = undefined; });
		}
		const tabs = linkTabs(), saved = this.saved(), dropped: vscode.Uri[] = [], cleared: string[] = [], added = new Set<string>();
		await this.post({ type: 'linkTabs', tabs, exts: linkExts(), ...select && { select } });
		for (const [kind, link] of this.links) {
			const tab = tabs.find(t => t.id === kind);
			if (!tab || link.uri.fsPath !== saved[kind]) {
				dropped.push(link.uri);
				cleared.push(kind);
				this.drop(kind);
			} else {
				link.tab = tab;
			}
		}
		// 다른 파일로 바꾸면 새 기준이 올 때까지 옛 파일 기준으로 표시하지 않게
		for (const kind of cleared) {
			await this.post({ type: 'gitBase', target: linkTarget(kind) });
		}
		for (const tab of tabs) {
			const file = saved[tab.id];
			if (file && !this.links.has(tab.id)) {
				this.add(tab, vscode.Uri.file(file));
				added.add(tab.id);
			}
			await this.send(tab.id);
		}
		await Promise.all([...this.links.keys()].map(kind => (fresh || added.has(kind)) && this.sendBase(kind, true)));
		await settleChanges(dropped);
	}

	private add(tab: LinkTab, uri: vscode.Uri) {
		const kind = tab.id;
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(uri.fsPath)), path.basename(uri.fsPath)));
		const sync = () => this.schedule(kind);
		watcher.onDidChange(sync);
		watcher.onDidCreate(sync);
		watcher.onDidDelete(sync);
		this.links.set(kind, { tab, uri, offset: 0, watcher });
		used.set(uri.toString(), (used.get(uri.toString()) ?? 0) + 1);
	}

	/** 변경 표시 기준을 보낸다. force가 아니면 바뀐 것만 */
	private async sendBase(kind: string, force = false): Promise<void> {
		const link = this.links.get(kind), text = link && await stagedText(link.uri);
		if (link && this.links.get(kind) === link && (force || text !== link.base)) {
			link.base = text;
			await this.post({ type: 'gitBase', target: linkTarget(kind), text });
		}
	}

	/** Git 상태가 바뀌었을 때: 기준이 바뀐 파일만 다시 보낸다 */
	async sendBases(): Promise<void> {
		await Promise.all([...this.links.keys()].map(kind => this.sendBase(kind)));
	}

	private drop(kind: string) {
		const link = this.links.get(kind);
		if (!link) {
			return;
		}
		clearTimeout(link.timer);
		link.watcher.dispose();
		this.links.delete(kind);
		const key = link.uri.toString(), count = (used.get(key) ?? 1) - 1;
		if (count > 0) {
			used.set(key, count);
		} else {
			used.delete(key);
		}
	}

	private schedule(kind: string | undefined, delay = 300) {
		const link = kind && this.links.get(kind);
		if (link) {
			clearTimeout(link.timer);
			link.timer = setTimeout(() => void this.send(kind), delay);
		}
	}

	/**
	 * 편집기에 안 보이는 문서는 확장 호스트가 닫았다 다시 열 수 있다(버전이 1부터). 웹뷰가 아는 버전에 이어지게 offset을 맞추고,
	 * 그사이 디스크 내용이 바뀌었으면 버전을 하나 올려(웹뷰의 옛 편집은 거부) 새 내용을 보낸다
	 */
	private async open(kind: string, link: Link): Promise<vscode.TextDocument | undefined> {
		if (link.doc && !link.doc.isClosed) {
			return link.doc;
		}
		let doc: vscode.TextDocument;
		try {
			doc = await vscode.workspace.openTextDocument(link.uri);
		} catch {
			return undefined;
		}
		const changedOnDisk = !!link.known && link.known.text !== doc.getText();
		link.offset = link.known ? link.known.version - doc.version + (changedOnDisk ? 1 : 0) : 0;
		link.doc = doc;
		if (changedOnDisk) {
			this.schedule(kind, 0);
		}
		return doc;
	}

	private versionOf(link: Link, doc: vscode.TextDocument) {
		const version = doc.version + link.offset;
		link.known = { version, text: doc.getText() };
		return version;
	}

	private async send(kind: string): Promise<void> {
		const link = this.links.get(kind);
		if (!link) {
			await this.post({ type: 'linked', kind });
			return;
		}
		const shown = this.shown(link.uri.fsPath);
		const doc = await this.open(kind, link);
		// 지워진 파일: 저장 안 한 변경이 있으면 그 내용을 계속 보여 준다
		if (!doc || !doc.isDirty && !await isFile(link.uri)) {
			await this.post({ type: 'linked', kind, path: shown });
			return;
		}
		const text = doc.getText();
		await this.post({ type: 'linked', kind, path: shown, text, version: this.versionOf(link, doc), dirty: doc.isDirty });
		await this.sendSchema(kind, link, text);
	}

	/** XML이면 DOCTYPE의 DTD로 자동완성 스키마(DOCTYPE이 바뀔 때만). 못 찾으면 elements 없이 보내 웹뷰가 기본 목록을 쓴다 */
	private async sendSchema(kind: string, link: Link, text: string): Promise<void> {
		const doctype = link.uri.fsPath.toLowerCase().endsWith('.xml') ? doctypeOf(text) : undefined;
		const key = doctype ? `${doctype.root} ${doctype.system}` : '';
		if (link.schema === key) {
			return;
		}
		link.schema = key;
		const schema = doctype && await xmlSchemaOf(link.uri.fsPath, text).catch(() => undefined);
		if (this.links.get(kind) === link && link.schema === key) {
			await this.post({ type: 'xmlSchema', kind, ...schema });
		}
	}

	/** 웹뷰가 본 버전(version)이 지금 문서와 같을 때만 그 문서(다르면 위치가 어긋나므로 undefined) */
	private async docAt(kind: string, version: number): Promise<vscode.TextDocument | undefined> {
		const link = this.links.get(kind), doc = link && await this.open(kind, link);
		return link && doc && version === doc.version + link.offset ? doc : undefined;
	}

	/** 웹뷰가 본 버전(version)에서 연결 파일을 고친다 */
	async edit(kind: string, version: number, changes: CodeChange[]): Promise<{ ok: boolean; version: number }> {
		const link = this.links.get(kind), doc = link && await this.open(kind, link);
		if (!link || !doc) {
			return { ok: false, version };
		}
		// 버전이 다르면 거부하고 지금 버전을 알려 준다
		const ok = version === doc.version + link.offset && await applyCodeEdit(doc, linkTarget(kind), changes);
		return { ok, version: this.versionOf(link, doc) };
	}

	async format(kind: string, version: number): Promise<string | undefined> {
		const doc = await this.docAt(kind, version);
		return doc && formatCode(doc, linkTarget(kind));
	}

	/** VS Code 언어 확장의 자동완성 */
	async complete(kind: string, version: number, line: number, ch: number, trigger?: string): Promise<RemoteCompletions | undefined> {
		const doc = await this.docAt(kind, version);
		return doc && remoteCompletions(doc, line, ch, trigger);
	}

	/**
	 * 경로 입력의 파일 검색 목록: 작업 폴더에서 이 탭이 받는 확장자 파일(VS Code 파일 검색, 사용자의 files.exclude·search.exclude 제외).
	 * 경로는 입력칸과 같은 기준(이 화면의 작업 폴더). 다른 작업 폴더 파일은 절대 경로
	 */
	private async findFiles(kind: string): Promise<void> {
		const tab = linkTab(kind);
		if (!tab) {
			return;
		}
		const excluded = (section: string) => Object.entries(vscode.workspace.getConfiguration(section).get<Record<string, unknown>>('exclude') ?? {})
			.filter(([, on]) => on === true).map(([glob]) => glob);
		const globs = [...excluded('files'), ...excluded('search')];
		// 확장자마다 따로 찾는다: 한 번에 찾으면 엔진·라이브러리의 많은 .js가 최대 개수를 채워 .java가 빠질 수 있다
		const exclude = globs.length ? `{${globs.join(',')}}` : undefined;
		const found = await Promise.all(linkExts().map(ext => vscode.workspace.findFiles(`**/*${ext}`, exclude, MAX_FILES_PER_EXT)));
		const folder = this.folder?.fsPath;
		await this.post({ type: 'files', kind, files: found.flat().map(u => this.shown(u.fsPath, folder)).sort() });
	}

	/** path 없으면 파일 선택 창. 상대 경로는 작업 폴더 기준 */
	async link(kind: string, input?: string): Promise<void> {
		const tab = linkTab(kind);
		if (!tab) {
			return;
		}
		const { folder } = this;
		let uri: vscode.Uri | undefined;
		if (input === undefined) {
			[uri] = await vscode.window.showOpenDialog({
				title: `${tab.label} 파일 연결`, openLabel: '연결', canSelectMany: false, defaultUri: this.links.get(kind)?.uri ?? folder,
				filters: { [linkExts().join(' ')]: linkExts().map(e => e.slice(1)) },
			}) ?? [];
		} else if (cleanPath(input)) {
			uri = vscode.Uri.file(path.resolve(folder?.fsPath ?? path.dirname(this.owner.uri.fsPath), cleanPath(input)));
		}
		if (!uri) {
			return;
		}
		// 한 파일은 한 탭에만: 변경 알림·버전을 탭 하나가 맡는다
		const other = linkTabs().find(t => t.id !== kind && this.saved()[t.id] === uri.fsPath);
		const problem = uri.toString() === this.owner.uri.toString() ? '지금 화면 파일은 연결할 수 없습니다.'
			: other ? `이미 ${other.label} 탭에 연결된 파일입니다.`
			: linkProblem(uri.fsPath, !!vscode.workspace.getWorkspaceFolder(uri), linkExts())
				?? (await isFile(uri) ? undefined : `파일을 찾지 못했습니다: ${uri.fsPath}`);
		if (problem) {
			void vscode.window.showWarningMessage(problem);
			return;
		}
		await workspaceState.update(this.key, { ...this.saved(), [kind]: uri.fsPath });
		changed.fire(this.owner.uri.fsPath);
	}

	async unlink(kind: string): Promise<void> {
		const { [kind]: _, ...rest } = this.saved();
		await workspaceState.update(this.key, rest);
		changed.fire(this.owner.uri.fsPath);
	}

	async openLink(kind: string): Promise<void> {
		const link = this.links.get(kind);
		if (!link) {
			const label = linkTab(kind)?.label ?? kind;
			void vscode.window.showWarningMessage(`${label} 파일이 연결되지 않았습니다. ${label} 탭에서 먼저 파일을 연결해 주세요.`);
			return;
		}
		const doc = await this.open(kind, link);
		if (!doc) {
			void vscode.window.showWarningMessage(`파일을 찾지 못했습니다: ${link.uri.fsPath}`);
			return;
		}
		await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
	}

	async saveLink(kind: string): Promise<void> {
		const link = this.links.get(kind), doc = link && await this.open(kind, link);
		if (!doc) {
			return;
		}
		if (await doc.save()) {
			await closeAutoTabs(doc);
		} else {
			void vscode.window.showErrorMessage(`저장 실패: ${doc.fileName}`);
		}
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		this.subs.forEach(s => s.dispose());
		const uris = [...this.links.values()].map(l => l.uri);
		[...this.links.keys()].forEach(kind => this.drop(kind));
		await settleChanges(uris);
	}
}
