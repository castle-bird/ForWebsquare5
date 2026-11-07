// 디자이너 화면 하나(웹뷰 패널 하나)의 수명: 리소스 읽기·문서 보내기·Git 기준·편집 대기열·웹뷰 메시지 처리
import * as path from 'node:path';
import * as vscode from 'vscode';
import { nodeAt, parseXml } from '../core/xmlModel';
import { editableScript } from '../core/edit';
import { errorMessage } from '../core/errors';
import type { NodeEdit } from '../core/nodeEdit';
import type { CodeTarget, SettingsMenuItem, ToExtension, ToWebview } from '../core/protocol';
import { ENGINE_PAGE, GENERATED_DIRS, fromWebPath, serial } from '../project/paths';
import { resolveSrc } from '../project/frames';
import { loadApiDocs } from '../project/apiDocs';
import { udcNames } from '../project/modules';
import type { ComponentDef } from '../project/components';
import { warmWpack } from '../project/wpack';
import { BrowserPreview } from './browserPreview';
import { openCss } from './css';
import { onDidChangeInstall, resolvePath, type SetupKey } from './setup';
import { applyCodeEdit, applyNodeEdit, formatCode } from './documentEdit';
import { LinkedFiles, type LinkMessage } from './links';
import { UsedTablesStore, type TablesMessage } from './tables';
import { saveTabOrder, tabOrder } from './linkTabs';
import { blameOn, minimapOn, onBlameToggled, panelFont, saveBlame, saveMinimap, savePanelFont, saveAnimation, saveTabPosition, animationOn, tabPosition } from './viewSettings';
import { linkIdOf } from '../core/links';
import { findPaletteDef } from '../core/palette';
import { codeTheme, saveCustomizations } from './codeTheme';
import { affectsCodeOptions, codeOptions } from './codeOptions';
import { blameFeed, blameText, onGitChange, stagedText } from './gitBase';
import { lineOfOffset, sliceBlame } from '../core/blame';
import { insertFromPalette, paletteFavorites, savePaletteFavorite, reorderPaletteFavorites } from './palette';
import { openAction } from './actionMapping';
import { documentMessage, loadDefinitions, loadStyles, loadModules } from './resources';

export const VIEW_TYPE = 'for-websquare5.designer';

/** 톱니바퀴 메뉴 → VS Code 명령. 웹뷰는 이 목록에 있는 것만 부른다 */
const SETTINGS_MENU: Record<SettingsMenuItem, [string, ...unknown[]]> = {
	codeTheme: ['for-websquare5.codeTheme'],
	importCodeTheme: ['for-websquare5.importCodeTheme'],
	themeColors: ['workbench.action.openSettingsJson', { revealSetting: { key: 'for-websquare5.codeThemeCustomizations', edit: true } }],
	sqlDialect: ['workbench.action.openSettings', '@id:for-websquare5.sqlDialect'],
	setup: ['for-websquare5.setup'],
	settings: ['workbench.action.openSettings', '@ext:castle-bird.for-websquare5'],
};

/** 웹 루트 바로 아래의 생성 폴더는 공통 JS 다시 읽기에서 제외 */
const NOT_MODULE_DIR = new RegExp(`^[\\\\/]?(${GENERATED_DIRS}|_wpack)[\\\\/_]`, 'i');

type Message<K extends ToExtension['type']> = Extract<ToExtension, { type: K }>;
/** 연결 탭·ERD 저장소가 직접 받는 메시지를 뺀 모든 메시지에 처리기가 있어야 한다(새 메시지를 추가하면 여기서 컴파일 오류) */
type Handlers = { [K in Exclude<ToExtension['type'], LinkMessage['type'] | TablesMessage['type']>]: (msg: Message<K>) => void };
type PopupEdit = Message<'editDataFields' | 'addSubmission' | 'editSubmission' | 'editChoices' | 'editGridCells' | 'createGrid'>;

/** 확장 전체가 공유하는 저장소와 다른 화면에 알리기 */
export interface SessionHost {
	globalState: vscode.Memento;
	workspaceState: vscode.Memento;
	/** ERD 사용 테이블 기본 저장 폴더(확장 전용, 이 PC) */
	tablesFolder: vscode.Uri;
	/** 모든 화면 공통 설정(탭 순서·위치 등)을 이 화면 말고 다른 화면에 */
	broadcast(msg: ToWebview): void;
}

export class ScreenSession {
	/** 닫힌 뒤 늦게 끝난 작업(문서 전송·Git 기준 등)이 보내도 오류 없이 버린다 */
	private disposed = false;
	/** 마지막으로 다 읽은 정의(아직이면 undefined). 문서는 이것으로 보내고, 첫 정의를 기다리다 먼저 보냈으면(earlySent) 빈 목록으로 보낸다 */
	private defsNow: ComponentDef[] | undefined;
	private earlySent = false;
	private definitions: ReturnType<typeof loadDefinitions>;
	private api: ReturnType<ScreenSession['loadApi']>;
	private readonly styles: ReturnType<typeof loadStyles>;
	private modules: ReturnType<typeof loadModules>;
	private readonly udcs: Promise<Set<string>>;
	/** 문서 보내기는 wframe 화면 읽기 등으로 걸리는 시간이 다르다: 늦게 끝난 옛 요청이 새 문서를 덮지 않게 마지막 요청만 보낸다 */
	private latest = 0;
	/** 변경 표시 기준(Git 스테이지 내용): Source는 화면 XML 전체, Script는 그 안의 Script 본문. 바뀐 것만 보낸다 */
	private bases: { source?: string; script?: string } = {};
	/**
	 * 편집기 변경분은 문서마다 받은 순서대로 하나씩: 버전 확인과 적용 사이에 다른 편집이 끼지 않게.
	 * 화면 XML(Source·Script)과 연결 파일은 따로 줄 세운다(느린 Java 포맷이 화면 편집을 막지 않게)
	 */
	private readonly codeQueues = new Map<string, Promise<unknown>>();
	private readonly timers: { document?: NodeJS.Timeout; git?: NodeJS.Timeout; modules?: NodeJS.Timeout } = {};
	private readonly browserPreview: BrowserPreview;
	private readonly links: LinkedFiles;
	private readonly usedTables: UsedTablesStore;
	private readonly xmlBlame: ReturnType<typeof blameFeed>;
	private readonly subs: vscode.Disposable[];

	constructor(private readonly document: vscode.TextDocument, private readonly panel: vscode.WebviewPanel,
		private readonly webRoot: string, private readonly host: SessionHost) {
		this.browserPreview = new BrowserPreview(document, panel.webview, webRoot, on => void this.post({ type: 'browserPreview', on }));
		this.definitions = this.trackDefinitions();
		this.api = this.loadApi();
		this.styles = loadStyles(document, panel.webview, webRoot);
		this.modules = loadModules(webRoot);
		this.udcs = udcNames(webRoot).catch(() => new Set<string>());
		this.links = new LinkedFiles(document, this.post);
		this.usedTables = new UsedTablesStore(document.uri, host.workspaceState, vscode.Uri.joinPath(host.tablesFolder, 'used-tables'), this.post);
		this.xmlBlame = blameFeed(() => this.sendBlame());
		// 공통 JS(config.xml engine module)·config.xml이 저장되면 다시 읽어 자동완성·설명에 반영. 어떤 .js가 공통인지는 config.xml이 정하므로 다 받고 모아서 다시 읽는다
		const moduleWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(webRoot), '{**/*.js,websquare/config.xml}'));
		const reloadModules = (uri: vscode.Uri) => {
			if (NOT_MODULE_DIR.test(path.relative(webRoot, uri.fsPath))) {
				return;
			}
			clearTimeout(this.timers.modules);
			this.timers.modules = setTimeout(() => {
				this.modules = loadModules(webRoot);
				void this.modules.then(this.post);
			}, 300);
		};
		moduleWatcher.onDidChange(reloadModules);
		moduleWatcher.onDidCreate(reloadModules);
		moduleWatcher.onDidDelete(reloadModules);
		this.subs = [
			moduleWatcher,
			vscode.workspace.onDidChangeConfiguration(e => {
				const changed = (key: SetupKey) => e.affectsConfiguration(`for-websquare5.${key}`, document.uri);
				if (affectsCodeOptions(e)) {
					void this.post({ type: 'codeOptions', ...codeOptions() });
				}
				const eclipse = changed('eclipseInstallPath');
				if (eclipse || changed('componentDefinitionFile')) {
					this.reloadDefinitions();
				}
				if (eclipse || changed('apiDocumentationPath')) {
					this.reloadApi();
				}
			}),
			// 설정 없이 설치 폴더를 자동으로 찾았거나 기억한 위치가 바뀌면: 정의·API를 다시 읽고 변환기를 미리 띄운다
			onDidChangeInstall(() => {
				this.reloadDefinitions();
				this.reloadApi();
				this.warmWpack();
			}),
			// Git 상태는 저장할 때마다도 바뀌어 자주 불린다 → 모아서
			onGitChange(() => {
				clearTimeout(this.timers.git);
				this.timers.git = setTimeout(() => void this.sendBases().then(() => this.links.sendBases()), 500);
				// 커밋·체크아웃하면 blame도 바뀐다
				this.xmlBlame.schedule();
				this.links.scheduleBlame();
			}),
			vscode.workspace.onDidChangeTextDocument(e => {
				if (e.document === document) {
					clearTimeout(this.timers.document);
					this.timers.document = setTimeout(() => void this.sendDocument(), 300);
					this.xmlBlame.schedule();
				}
			}),
			onBlameToggled(on => { if (on) { this.xmlBlame.schedule(0); this.links.scheduleBlame(0); } }),
			panel.webview.onDidReceiveMessage((msg: ToExtension) => this.receive(msg)),
		];
		panel.onDidDispose(() => this.dispose());
	}

	private readonly post = async (msg: ToWebview) => {
		try {
			return !this.disposed && await this.panel.webview.postMessage(msg);
		} catch {
			return false;
		}
	};

	private readonly toast = (message: string) => void this.post({ type: 'toast', message });

	/** 저장하자마자 변환되게 wpack 상주 변환을 미리 띄운다 */
	warmWpack(): void {
		void resolvePath('wpackExecutable', this.document.uri, this.webRoot).then(warmWpack).catch(() => undefined);
	}

	private trackDefinitions() {
		const loading = loadDefinitions(this.document.uri, this.webRoot);
		void loading.then(d => { if (this.definitions === loading) { this.defsNow = d.defs; } });
		return loading;
	}

	private loadApi() {
		return resolvePath('apiDocumentationPath', this.document.uri, this.webRoot).then(loadApiDocs);
	}

	private reloadDefinitions() {
		this.definitions = this.trackDefinitions();
		void this.definitions.then(d => this.post({ type: 'definitions', ...d })).then(() => this.sendDocument());
	}

	private reloadApi() {
		this.api = this.loadApi();
		void this.api.then(result => this.post({ type: 'scriptApi', ...result }));
	}

	private async sendDocument() {
		const request = ++this.latest;
		const defs = this.defsNow ?? (this.earlySent ? [] : (await this.definitions).defs);
		const msg = await documentMessage(this.document, this.panel.webview, this.webRoot, defs, await this.udcs);
		if (request === this.latest && msg.version === this.document.version) { await this.post(msg); }
	}

	/** 편집 직후: 디바운스 없이 바로 최신 문서를 보낸다 */
	private refresh() {
		clearTimeout(this.timers.document);
		return this.sendDocument();
	}

	private async sendBases() {
		const staged = await stagedText(this.document.uri);
		let script: string | undefined;
		try {
			script = staged === undefined ? undefined : editableScript(staged)?.text;
		} catch {
		}
		const next = { source: staged, script };
		for (const target of ['source', 'script'] as const) {
			if (next[target] !== this.bases[target]) {
				await this.post({ type: 'gitBase', target, text: next[target] });
			}
		}
		this.bases = next;
	}

	/** Git blame(켰을 때만): Source는 화면 XML 전체, Script는 그 안 Script 본문 줄만. 그 사이 문서가 바뀌었으면 보내지 않는다(다음 차례에) */
	private async sendBlame() {
		if (!blameOn()) { return; }
		const document = this.document, version = document.version, text = document.getText();
		const data = await blameText(document.uri, text);
		if (document.version !== version) { return; }
		let script: typeof data;
		try {
			const body = data && editableScript(text);
			script = body ? sliceBlame(data, lineOfOffset(text, body.start), lineOfOffset(body.text, body.text.length) + 1) : undefined;
		} catch {
		}
		await this.post({ type: 'blame', target: 'source', version, data });
		await this.post({ type: 'blame', target: 'script', version, data: script });
	}

	private queue(target: CodeTarget, job: () => Promise<void>) {
		return serial(this.codeQueues, linkIdOf(target) === undefined ? 'xml' : target, job);
	}

	private receive(msg: ToExtension) {
		if (this.usedTables.handle(msg) || this.links.handle(msg)) {
			return;
		}
		(this.handlers[msg.type] as (msg: ToExtension) => void)(msg);
	}

	/** 공통 설정 저장 후 다른 화면에도 같은 상태를 알린다 */
	private share(save: () => unknown, msg: ToWebview) {
		void save();
		this.host.broadcast(msg);
	}

	/** 웹뷰가 옛 버전을 보고 보낸 편집은 버린다. 어느 쪽이든 최신 문서를 디바운스 없이 바로 다시 보낸다 */
	private nodeEdit(msg: NodeEdit) {
		void this.queue('source', async () => {
			if (msg.version === this.document.version) { await applyNodeEdit(this.document, msg, this.toast); }
			await this.refresh();
		}).catch(e => vscode.window.showErrorMessage(`변경 실패: ${errorMessage(e)}`));
	}

	/** 팝업 편집: 실제 적용 결과를 그 팝업(popup 키)에 알린다 */
	private popupEdit(msg: PopupEdit) {
		void this.queue('source', async () => {
			const ok = msg.version === this.document.version && await applyNodeEdit(this.document, msg, this.toast);
			await this.post({ type: 'popupAck', popup: msg.popup, ok, ...!ok && { error: '문서가 바뀌었습니다. 팝업을 다시 열어 주세요.' } });
			await this.refresh();
		}).catch(e => { void this.post({ type: 'popupAck', popup: msg.popup, ok: false, error: errorMessage(e) }); });
	}

	private ready() {
		const post = this.post;
		void post({ type: 'tabOrder', order: tabOrder() ?? [] });
		void post({ type: 'tabPosition', position: tabPosition() });
		void post({ type: 'panelFont', font: panelFont() });
		void post({ type: 'minimap', on: minimapOn() });
		void post({ type: 'animation', on: animationOn() });
		void post({ type: 'codeBlame', on: blameOn() });
		this.xmlBlame.schedule(0);
		void post({ type: 'paletteFavorites', keys: paletteFavorites(this.host.globalState) });
		void post({ type: 'codeTheme', ...codeTheme() });
		void post({ type: 'codeOptions', ...codeOptions() });
		this.bases = {};
		void this.sendBases();
		void this.links.reload(undefined, true);
		void this.api.then(result => post({ type: 'scriptApi', ...result }));
		void this.modules.then(post);
		// 정의가 늦으면(설치 폴더 자동 탐색·디스크가 바쁠 때) 기다리지 않고 문서부터 보여 준다. 정의가 오면 아래에서 다시 보낸다
		const early = setTimeout(() => void this.styles.then(s => {
			if (this.defsNow) { return; }
			this.earlySent = true;
			void post(s);
			void post({ type: 'definitions', defs: [], error: 'WebSquare5 컴포넌트 정의를 불러오는 중입니다…' });
			return this.sendDocument();
		}), 1000);
		void Promise.all([this.definitions, this.styles]).then(([d, s]) => {
			clearTimeout(early);
			void post({ type: 'definitions', ...d });
			void post(s);
			return this.sendDocument();
		});
	}

	private readonly handlers: Handlers = {
		ready: () => this.ready(),
		setCode: msg => {
			const { target } = msg, linkId = linkIdOf(target), document = this.document;
			const ack = (ok: boolean, version = document.version) => this.post({ type: 'codeAck', target, ok, version });
			void this.queue(target, async () => {
				if (linkId !== undefined) {
					const result = await this.links.edit(linkId, msg.version, msg.changes);
					await ack(result.ok, result.version);
				} else {
					await ack(msg.version === document.version && await applyCodeEdit(document, target, msg.changes));
				}
			}).catch(e => {
				void ack(false, linkId !== undefined ? msg.version : document.version);
				void vscode.window.showErrorMessage(`변경 실패: ${errorMessage(e)}`);
			});
		},
		format: msg => {
			void this.queue(msg.target, async () => {
				const linkId = linkIdOf(msg.target);
				const text = linkId !== undefined ? await (msg.imports ? this.links.addImports(linkId, msg.version) : this.links.format(linkId, msg.version, msg.range))
					: msg.version === this.document.version && !msg.imports ? await formatCode(this.document, msg.target) : undefined;
				await this.post({ type: 'formatted', target: msg.target, text });
			}).catch(e => {
				void this.post({ type: 'formatted', target: msg.target });
				if (msg.imports) { return; }
				const reason = errorMessage(e).split('\n')[0];
				void vscode.window.showErrorMessage(`포맷 실패: ${reason}`);
			});
		},
		// 순서 변경은 정의가 필요 없다. 추가·해제는 이 화면 정의에 있는 컴포넌트만
		reorderPaletteFavorites: msg => this.savePalette(Array.isArray(msg.keys) && msg.keys.every(key => typeof key === 'string')
			? reorderPaletteFavorites(this.host.globalState, msg.keys) : Promise.resolve()),
		setPaletteFavorite: msg => this.savePalette(this.definitions.then(({ defs }) => {
			const def = findPaletteDef(defs, msg.component);
			return def && typeof msg.favorite === 'boolean' ? savePaletteFavorite(this.host.globalState, def, msg.favorite) : undefined;
		})),
		insertComponent: msg => {
			void this.queue('source', async () => {
				const def = findPaletteDef((await this.definitions).defs, msg.component);
				if (def && msg.version === this.document.version) {
					const id = await insertFromPalette(this.document, def, msg.index, this.webRoot, msg.position, msg.version);
					if (id) { await this.post({ type: 'select', id }); }
				} else {
					void vscode.window.showWarningMessage(def ? '문서가 바뀌었습니다. 다시 넣어 주세요.' : '팔레트 컴포넌트 정의를 찾지 못했습니다.');
				}
				await this.refresh();
			}).catch(e => { void vscode.window.showErrorMessage(`컴포넌트 넣기 실패: ${errorMessage(e)}`); });
		},
		saveThemeCustomizations: msg => {
			void saveCustomizations(msg.common, msg.own).catch(e => vscode.window.showErrorMessage(`테마 색 저장 실패: ${errorMessage(e)}`));
		},
		settingsMenu: msg => {
			const command = SETTINGS_MENU[msg.item];
			if (command) { void vscode.commands.executeCommand(...command); }
		},
		warn: msg => { void vscode.window.showWarningMessage(msg.message); },
		openCss: msg => {
			void this.styles.then(s => openCss(s.rules ?? [], msg.rules)).catch(e => vscode.window.showErrorMessage(`CSS 이동 실패: ${errorMessage(e)}`));
		},
		openInBrowser: msg => {
			void this.browserPreview.open(msg).catch(e => vscode.window.showErrorMessage(`브라우저로 열기 실패: ${errorMessage(e)}`));
		},
		updateBrowserPreview: msg => this.browserPreview.update(msg),
		openFrame: msg => void openFrame(this.document, msg.index, this.webRoot),
		openAction: msg => {
			void openAction(this.document, msg.action, (uri, range) => this.links.reveal(uri, range), this.toast)
				.catch(e => vscode.window.showErrorMessage(`Controller 열기 실패: ${errorMessage(e)}`));
		},
		// Script 정의로 이동(공통 JS): config.xml에서 읽은 공통 JS 목록에 있는 경로만 연다
		openModule: msg => {
			void this.modules.then(async ({ files }) => {
				if (!files.some(f => f.path === msg.path)) { return; }
				const range = new vscode.Range(msg.line, msg.ch, msg.endLine, msg.endCh);
				await vscode.window.showTextDocument(vscode.Uri.file(fromWebPath(this.webRoot, msg.path, ENGINE_PAGE)), { selection: range });
			}).catch(e => vscode.window.showErrorMessage(`공통 JS 열기 실패: ${errorMessage(e)}`));
		},
		setTabOrder: msg => this.share(() => saveTabOrder(msg.order), { type: 'tabOrder', order: msg.order }),
		setTabPosition: msg => this.share(() => saveTabPosition(msg.position), { type: 'tabPosition', position: msg.position }),
		setCodeBlame: msg => this.share(() => saveBlame(msg.on), { type: 'codeBlame', on: msg.on }),
		setPanelFont: msg => {
			if (msg.font === 'ui' || msg.font === 'editor') { this.share(() => savePanelFont(msg.font), { type: 'panelFont', font: msg.font }); }
		},
		setMinimap: msg => this.share(() => saveMinimap(msg.on), { type: 'minimap', on: msg.on }),
		setAnimation: msg => this.share(() => saveAnimation(msg.on), { type: 'animation', on: msg.on }),
		navigate: msg => void vscode.commands.executeCommand(msg.back ? 'workbench.action.navigateBack' : 'workbench.action.navigateForward'),
		editDataFields: msg => this.popupEdit(msg),
		addSubmission: msg => this.popupEdit(msg),
		editSubmission: msg => this.popupEdit(msg),
		editChoices: msg => this.popupEdit(msg),
		editGridCells: msg => this.popupEdit(msg),
		createGrid: msg => this.popupEdit(msg),
		setAttr: msg => this.nodeEdit(msg),
		setText: msg => this.nodeEdit(msg),
		paste: msg => this.nodeEdit(msg),
		wrap: msg => this.nodeEdit(msg),
		delete: msg => this.nodeEdit(msg),
		mergeCells: msg => this.nodeEdit(msg),
		unmergeCells: msg => this.nodeEdit(msg),
		gridColumns: msg => this.nodeEdit(msg),
		move: msg => this.nodeEdit(msg),
		addData: msg => this.nodeEdit(msg),
		editHistory: msg => this.nodeEdit(msg),
		bindGrid: msg => this.nodeEdit(msg),
		addGridPart: msg => this.nodeEdit(msg),
	};

	private savePalette(save: Promise<unknown>) {
		void save.then(async () => {
			const state: ToWebview = { type: 'paletteFavorites', keys: paletteFavorites(this.host.globalState) };
			await this.post(state);
			this.host.broadcast(state);
		}).catch(e => {
			void this.post({ type: 'paletteFavorites', keys: paletteFavorites(this.host.globalState) });
			void vscode.window.showErrorMessage(`즐겨찾기 저장 실패: ${errorMessage(e)}`);
		});
	}

	private dispose() {
		this.disposed = true;
		clearTimeout(this.timers.document);
		clearTimeout(this.timers.git);
		clearTimeout(this.timers.modules);
		this.xmlBlame.dispose();
		this.browserPreview.dispose();
		this.subs.forEach(s => s.dispose());
		void this.links.dispose();
		this.usedTables.dispose();
	}
}

export async function openFrame(document: vscode.TextDocument, index: number, webRoot?: string): Promise<void> {
	const root = parseXml(document.getText());
	const src = (root && nodeAt(root, index))?.attrs.src;
	const target = src && await resolveSrc(src, document.uri.fsPath, webRoot);
	if (target) {
		await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(target), VIEW_TYPE, { preview: false });
	} else {
		void vscode.window.showWarningMessage(src ? `연결 화면을 찾지 못했습니다: ${src}` : '연결된 화면(src)이 없습니다.');
	}
}
