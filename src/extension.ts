import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { defOf, isScreen, nodeAt, parseXml, type XmlNode } from './core/xmlModel';
import { editableScript, scriptBody } from './core/edit';
import { errorMessage } from './core/errors';
import type { CodeTarget, SettingsMenuItem, ToExtension, ToWebview } from './core/protocol';
import { ENGINE_PAGE, findWebRoot, fromWebPath, serial } from './project/paths';
import { scopeCss, stylesheetFiles } from './project/styles';
import { attachFrames, resolveSrc } from './project/frames';
import { loadApiDocs } from './project/apiDocs';
import { engineModules, udcNames } from './project/modules';
import { annotate, loadComponents, type ComponentDef } from './project/components';
import { convert, publish, readWpackConfig } from './project/wpack';
import { offerSetup, registerSetup, resolvePath, type SetupKey } from './vscode/setup';
import { applyCodeEdit, applyNodeEdit, formatCode } from './vscode/documentEdit';
import { LinkedFiles, registerLinks } from './vscode/links';
import { UsedTablesStore } from './vscode/tables';
import { saveTabOrder, saveTabPosition, tabOrder, tabPosition } from './vscode/linkTabs';
import { linkIdOf } from './core/links';
import { findPaletteDef } from './core/palette';
import { codeTheme, registerCodeTheme, saveCustomizations } from './vscode/codeTheme';
import { affectsCodeOptions, codeOptions } from './vscode/codeOptions';
import { onGitChange, stagedText } from './vscode/gitBase';
import { insertFromPalette, paletteFavorites, savePaletteFavorite, reorderPaletteFavorites } from './vscode/palette';

export const VIEW_TYPE = 'websquare5-editor.designer';

export function activate(context: vscode.ExtensionContext) {
	registerSetup(context);
	registerLinks(context);
	registerCodeTheme(context, msg => panels.forEach(p => void p.webview.postMessage(msg)));
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(VIEW_TYPE, new DesignerProvider(context.extensionUri, context.globalState, context.workspaceState, context.storageUri ?? context.globalStorageUri), {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.workspace.onDidSaveTextDocument(doc => void wpackOnSave(doc)),
		// 포맷 단축키(Ctrl+Alt+L): 웹뷰는 VS Code 키 바인딩으로 받아 보이는 편집기에 전달. Alt+글자 조합은 웹뷰에서 VS Code 메뉴가 열려서 피한다.
		vscode.commands.registerCommand('websquare5-editor.format', () => {
			const panel = [...panels].find(p => p.active);
			void panel?.webview.postMessage({ type: 'formatKey' } satisfies ToWebview);
		}),
	);
}

const panels = new Set<vscode.WebviewPanel>();

/** 톱니바퀴 메뉴 → VS Code 명령. 웹뷰는 이 목록에 있는 것만 부른다 */
const SETTINGS_MENU: Record<SettingsMenuItem, [string, ...unknown[]]> = {
	codeTheme: ['websquare5-editor.codeTheme'],
	importCodeTheme: ['websquare5-editor.importCodeTheme'],
	themeColors: ['workbench.action.openSettingsJson', { revealSetting: { key: 'websquare5-editor.codeThemeCustomizations', edit: true } }],
	sqlDialect: ['workbench.action.openSettings', '@id:websquare5-editor.sqlDialect'],
	setup: ['websquare5-editor.setup'],
	settings: ['workbench.action.openSettings', '@ext:castle-bird.websquare5-editor'],
};

const wpackQueues = new Map<string, Promise<unknown>>();
let warnedNoWpack = false, warnedNoDefs = false;

async function wpackOnSave(doc: vscode.TextDocument): Promise<void> {
	if (doc.uri.scheme !== 'file' || !/\.xml$/i.test(doc.fileName)) {
		return;
	}
	const webRoot = await findWebRoot(doc.fileName);
	const config = webRoot && await readWpackConfig(webRoot).catch(() => undefined);
	if (!webRoot || !config) {
		return;
	}
	const rel = path.relative(webRoot, doc.fileName);
	const top = rel.split(path.sep)[0];
	const xml = doc.getText();
	if (rel.startsWith('..') || ['WEB-INF', 'META-INF', config.destRoot, '_wpackbabel_'].includes(top)) {
		return;
	}
	try {
		if (!isScreen(parseXml(xml))) {
			return;
		}
	} catch (e) {
		void vscode.window.showWarningMessage(`wpack 변환 건너뜀 (${path.basename(doc.fileName)}): ${errorMessage(e)}`);
		return;
	}
	const exe = await resolvePath('wpackExecutable', doc.uri, webRoot);
	if (!exe) {
		if (!warnedNoWpack) {
			warnedNoWpack = true;
			void offerSetup('wpackExecutable', 'wpack 변환기를 찾지 못해 저장 시 변환을 건너뜁니다.');
		}
		return;
	}
	const name = path.basename(doc.fileName);
	await serial(wpackQueues, doc.fileName, async () => {
		await publish(webRoot, config, rel, xml, await convert(exe, config, rel, xml));
		vscode.window.setStatusBarMessage(`$(check) wpack: ${name}`, 3000);
	}).catch(e => void vscode.window.showErrorMessage(`wpack 변환 실패 (${name}): ${errorMessage(e)}`));
}

/** 모든 화면 공통 설정(탭 순서·위치)을 바꾼 화면 말고 다른 화면에 */
function broadcast(from: vscode.WebviewPanel, msg: ToWebview) {
	panels.forEach(p => p !== from && void p.webview.postMessage(msg));
}

/** 웹뷰로 보낼 화면 XML: 노드 트리(정의 표시·연결 화면·이미지 주소)와 Script 본문. 읽지 못하면 이유를 담는다 */
async function documentMessage(document: vscode.TextDocument, webview: vscode.Webview, webRoot: string, defs: ComponentDef[], udcs: Set<string>): Promise<ToWebview> {
	const base = { type: 'document', version: document.version, text: document.getText() } as const;
	try {
		const root = parseXml(base.text);
		const body = root ? scriptBody(base.text, root) : 'XML을 읽지 못했습니다.';
		const script = typeof body === 'string' ? { text: '', note: body } : { text: body.text };
		if (root) {
			annotate(root, defs, udcs);
			await attachFrames(root, document.uri.fsPath, webRoot, defs, udcs);
			const images = (n: XmlNode) => {
				if (defOf(n, defs)?.realType === 'image' && n.attrs.src && !/^[a-z]+:/i.test(n.attrs.src)) {
					n.url = webview.asWebviewUri(vscode.Uri.file(fromWebPath(webRoot, n.attrs.src, ENGINE_PAGE))).toString();
				}
				[...n.children, ...n.frame ? [n.frame] : []].forEach(images);
			};
			images(root);
		}
		return { ...base, root, script };
	} catch (e) {
		return { ...base, error: String(e), script: { text: '', note: String(e) } };
	}
}

class DesignerProvider implements vscode.CustomTextEditorProvider {
	/** tablesFolder: Beta 사용 테이블 기본 저장 폴더(확장 전용, 이 PC) */
	constructor(private readonly extensionUri: vscode.Uri, private readonly globalState: vscode.Memento,
		private readonly workspaceState: vscode.Memento, private readonly tablesFolder: vscode.Uri) {}

	async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
		const webRoot = await findWebRoot(document.uri.fsPath);
		let parsed: XmlNode | undefined;
		try {
			parsed = parseXml(document.getText());
		} catch {
		}
		if (!webRoot || !parsed || !isScreen(parsed)) {
			await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
			panel.dispose();
			return;
		}

		panels.add(panel);
		const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
		panel.webview.options = { enableScripts: true, localResourceRoots: [dist, vscode.Uri.file(webRoot)] };
		panel.webview.html = html(panel.webview, dist);

		// 닫힌 뒤 늦게 끝난 작업(문서 전송·Git 기준 등)이 보내도 오류 없이 버린다
		let disposed = false;
		const post = async (msg: ToWebview) => {
			try {
				return !disposed && await panel.webview.postMessage(msg);
			} catch {
				return false;
			}
		};
		const toast = (message: string) => void post({ type: 'toast', message });
		let definitions =loadDefinitions(document.uri, webRoot);
		const loadApi = () => resolvePath('apiDocumentationPath', document.uri, webRoot).then(loadApiDocs);
		let api = loadApi();
		const styles = loadStyles(document, panel.webview, webRoot);
		let modules = loadModules(webRoot);
		// 공통 JS(config.xml engine module)·config.xml이 저장되면 다시 읽어 자동완성·설명에 반영. 어떤 .js가 공통인지는 config.xml이 정하므로 다 받고 모아서 다시 읽는다
		const moduleWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(webRoot), '{**/*.js,websquare/config.xml}'));
		let moduleTimer: NodeJS.Timeout | undefined;
		const reloadModules = () => {
			clearTimeout(moduleTimer);
			moduleTimer = setTimeout(() => {
				modules = loadModules(webRoot);
				void modules.then(post);
			}, 300);
		};
		moduleWatcher.onDidChange(reloadModules);
		moduleWatcher.onDidCreate(reloadModules);
		moduleWatcher.onDidDelete(reloadModules);
		const udcs = udcNames(webRoot).catch(() => new Set<string>());
		// 문서 보내기는 wframe 화면 읽기 등으로 걸리는 시간이 다르다: 늦게 끝난 옛 요청이 새 문서를 덮지 않게 마지막 요청만 보낸다
		let latest = 0;
		const sendDocument = async () => {
			const request = ++latest;
			const msg = await documentMessage(document, panel.webview, webRoot, (await definitions).defs, await udcs);
			if (request === latest) { await post(msg); }
		};

		let timer: NodeJS.Timeout | undefined;
		const refresh = () => {
			clearTimeout(timer);
			return sendDocument();
		};
		const links = new LinkedFiles(document, post);
		const usedTables = new UsedTablesStore(document.uri, this.workspaceState, vscode.Uri.joinPath(this.tablesFolder, 'used-tables'), post);
		// 변경 표시 기준(Git 스테이지 내용): Source는 화면 XML 전체, Script는 그 안의 Script 본문. 바뀐 것만 보낸다
		let bases: { source?: string; script?: string } = {};
		const sendBases = async () => {
			const staged = await stagedText(document.uri);
			let script: string | undefined;
			try {
				script = staged === undefined ? undefined : editableScript(staged)?.text;
			} catch {
			}
			const next = { source: staged, script };
			for (const target of ['source', 'script'] as const) {
				if (next[target] !== bases[target]) {
					await post({ type: 'gitBase', target, text: next[target] });
				}
			}
			bases = next;
		};
		let gitTimer: NodeJS.Timeout | undefined;
		// 편집기 변경분은 문서마다 받은 순서대로 하나씩: 버전 확인과 적용 사이에 다른 편집이 끼지 않게.
		// 화면 XML(Source·Script)과 연결 파일은 따로 줄 세운다(느린 Java 포맷이 화면 편집을 막지 않게)
		const codeQueues = new Map<string, Promise<unknown>>();
		const queue = (target: CodeTarget, job: () => Promise<void>) => serial(codeQueues, linkIdOf(target) === undefined ? 'xml' : target, job);
		const subs = [
			moduleWatcher,
			vscode.workspace.onDidChangeConfiguration(e => {
				const changed = (key: SetupKey) => e.affectsConfiguration(`websquare5-editor.${key}`, document.uri);
				if (affectsCodeOptions(e)) {
					void post({ type: 'codeOptions', ...codeOptions() });
				}
				const eclipse = changed('eclipseInstallPath');
				if (eclipse || changed('componentDefinitionFile')) {
					definitions = loadDefinitions(document.uri, webRoot);
					void definitions.then(d => post({ type: 'definitions', ...d })).then(sendDocument);
				}
				if (eclipse || changed('apiDocumentationPath')) {
					api = loadApi();
					void api.then(result => post({ type: 'scriptApi', ...result }));
				}
			}),
			// Git 상태는 저장할 때마다도 바뀌어 자주 불린다 → 모아서
			onGitChange(() => {
				clearTimeout(gitTimer);
				gitTimer = setTimeout(() => void sendBases().then(() => links.sendBases()), 500);
			}),
			vscode.workspace.onDidChangeTextDocument(e => {
				if (e.document === document) {
					clearTimeout(timer);
					timer = setTimeout(sendDocument, 300);
				}
			}),
			panel.webview.onDidReceiveMessage((msg: ToExtension) => {
				if (msg.type === 'ready') {
					void post({ type: 'tabOrder', order: tabOrder() ?? [] });
					void post({ type: 'tabPosition', position: tabPosition() });
					void post({ type: 'paletteFavorites', keys: paletteFavorites(this.globalState) });
					void post({ type: 'codeTheme', ...codeTheme() });
					void post({ type: 'codeOptions', ...codeOptions() });
					bases = {};
					void sendBases();
					void links.reload(undefined, true);
					void api.then(result => post({ type: 'scriptApi', ...result }));
					void modules.then(post);
					void Promise.all([definitions, styles]).then(([d, s]) => {
						void post({ type: 'definitions', ...d });
						void post(s);
						return sendDocument();
					});
				} else if (msg.type === 'setCode') {
					const { target } = msg, linkId = linkIdOf(target);
					const ack = (ok: boolean, version = document.version) => post({ type: 'codeAck', target, ok, version });
					void queue(target, async () => {
						if (linkId !== undefined) {
							const result = await links.edit(linkId, msg.version, msg.changes);
							await ack(result.ok, result.version);
						} else {
							await ack(msg.version === document.version && await applyCodeEdit(document, target, msg.changes));
						}
					}).catch(e => {
						void ack(false, linkId !== undefined ? msg.version : document.version);
						void vscode.window.showErrorMessage(`변경 실패: ${errorMessage(e)}`);
					});
				} else if (msg.type === 'setPaletteFavorite' || msg.type === 'reorderPaletteFavorites') {
					// 순서 변경은 정의가 필요 없다. 추가·해제는 이 화면 정의에 있는 컴포넌트만
					const save = msg.type === 'reorderPaletteFavorites'
						? Array.isArray(msg.keys) && msg.keys.every(key => typeof key === 'string') ? reorderPaletteFavorites(this.globalState, msg.keys) : Promise.resolve()
						: definitions.then(({ defs }) => {
							const def = findPaletteDef(defs, msg.component);
							return def && typeof msg.favorite === 'boolean' ? savePaletteFavorite(this.globalState, def, msg.favorite) : undefined;
						});
					void save.then(async () => {
						const state: ToWebview = { type: 'paletteFavorites', keys: paletteFavorites(this.globalState) };
						await post(state);
						broadcast(panel, state);
					}).catch(e => {
						void post({ type: 'paletteFavorites', keys: paletteFavorites(this.globalState) });
						void vscode.window.showErrorMessage(`즐겨찾기 저장 실패: ${errorMessage(e)}`);
					});
				} else if (msg.type === 'insertComponent') {
					void queue('source', async () => {
						const def = findPaletteDef((await definitions).defs, msg.component);
						if (def && msg.version === document.version) {
							const id = await insertFromPalette(document, def, msg.index, webRoot, msg.position, msg.version);
							if (id) { await post({ type: 'select', id }); }
						} else {
							void vscode.window.showWarningMessage(def ? '문서가 바뀌었습니다. 다시 넣어 주세요.' : '팔레트 컴포넌트 정의를 찾지 못했습니다.');
						}
						await refresh();
					}).catch(e => { void vscode.window.showErrorMessage(`컴포넌트 넣기 실패: ${errorMessage(e)}`); });
				} else if (msg.type === 'saveThemeCustomizations') {
					void saveCustomizations(msg.common, msg.own).catch(e => vscode.window.showErrorMessage(`테마 색 저장 실패: ${errorMessage(e)}`));
				} else if (msg.type === 'settingsMenu') {
					const command = SETTINGS_MENU[msg.item];
					if (command) { void vscode.commands.executeCommand(...command); }
				} else if (msg.type === 'warn') {
					void vscode.window.showWarningMessage(msg.message);
				} else if (msg.type === 'openFrame') {
					void openFrame(document, msg.index, webRoot);
				} else if (msg.type === 'openModule') {
					// Script 정의로 이동(공통 JS): config.xml에서 읽은 공통 JS 목록에 있는 경로만 연다
					void modules.then(async ({ files }) => {
						if (!files.some(f => f.path === msg.path)) { return; }
						const range = new vscode.Range(msg.line, msg.ch, msg.endLine, msg.endCh);
						await vscode.window.showTextDocument(vscode.Uri.file(fromWebPath(webRoot, msg.path, ENGINE_PAGE)), { selection: range });
					}).catch(e => vscode.window.showErrorMessage(`공통 JS 열기 실패: ${errorMessage(e)}`));
				} else if (usedTables.handle(msg)) {
					// Beta 사용 테이블(읽기·저장·저장 폴더 고르기)
				} else if (links.handle(msg)) {
					// 연결 탭(연결·해제·열기·저장·탭 추가/이름/삭제·자동완성)
				} else if (msg.type === 'setTabOrder') {
					void saveTabOrder(msg.order);
					broadcast(panel, { type: 'tabOrder', order: msg.order });
				} else if (msg.type === 'setTabPosition') {
					void saveTabPosition(msg.position);
					broadcast(panel, { type: 'tabPosition', position: msg.position });
				} else if (msg.type === 'editDataFields' || msg.type === 'addSubmission' || msg.type === 'editSubmission' || msg.type === 'editChoices' || msg.type === 'editGridCells') {
					const apply = msg.version === document.version ? applyNodeEdit(document, msg, toast) : Promise.resolve(false);
					void apply.then(async ok => {
						await post({ type: 'popupAck', popup: msg.popup, ok, ...!ok && { error: '문서가 바뀌었습니다. 팝업을 다시 열어 주세요.' } });
						await refresh();
					}, e => { void post({ type: 'popupAck', popup: msg.popup, ok: false, error: errorMessage(e) }); });
				} else if (msg.type === 'format') {
					void queue(msg.target, async () => {
						const linkId = linkIdOf(msg.target);
						const text = linkId !== undefined ? await links.format(linkId, msg.version)
							: msg.version === document.version ? await formatCode(document, msg.target) : undefined;
						await post({ type: 'formatted', target: msg.target, text });
					}).catch(e => {
						void post({ type: 'formatted', target: msg.target });
						const reason = errorMessage(e).split('\n')[0];
						void vscode.window.showErrorMessage(`포맷 실패: ${reason}`);
					});
				} else {
					// 웹뷰가 옛 버전을 보고 보낸 편집은 버린다. 어느 쪽이든 최신 문서를 디바운스 없이 바로 다시 보낸다.
					const apply = msg.version === document.version ? applyNodeEdit(document, msg, toast) : Promise.resolve(false);
					void apply.then(refresh, e => vscode.window.showErrorMessage(`변경 실패: ${errorMessage(e)}`));
				}
			}),
		];
		panel.onDidDispose(() => {
			disposed = true;
			panels.delete(panel);
			clearTimeout(timer);
			clearTimeout(gitTimer);
			clearTimeout(moduleTimer);
			subs.forEach(s => s.dispose());
			void links.dispose();
		});
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

async function loadDefinitions(uri: vscode.Uri, webRoot?: string): Promise<{ defs: ComponentDef[]; error?: string }> {
	try {
		const source = await resolvePath('componentDefinitionFile', uri, webRoot);
		if (!source) {
			if (!warnedNoDefs) {
				warnedNoDefs = true;
				void offerSetup('componentDefinitionFile', '컴포넌트 정의 파일(WebSquareConfig.xml)을 찾지 못해 Property·Event 목록이 비어 있습니다.');
			}
			return { defs: [], error: '컴포넌트 정의(WebSquareConfig.xml)를 찾지 못했습니다. (F1 → WebSquare5: 환경 설정)' };
		}
		return { defs: await loadComponents(source) };
	} catch (e) {
		return { defs: [], error: `컴포넌트 정의 읽기 실패: ${errorMessage(e)}` };
	}
}

async function loadStyles(document: vscode.TextDocument, webview: vscode.Webview, webRoot: string): Promise<Extract<ToWebview, { type: 'styles' }>> {
	const css: string[] = [], imports: string[] = [], failed: string[] = [], broken: string[] = [];
	try {
		for (const file of await stylesheetFiles(webRoot, document.uri.fsPath, document.getText())) {
			const errors: string[] = [];
			try {
				css.push(scopeCss(await readFile(file, 'utf8'), file, webRoot, p => webview.asWebviewUri(vscode.Uri.file(p)).toString(), imports, errors));
			} catch {
				failed.push(path.relative(webRoot, file));
			}
			broken.push(...errors.map(e => `${path.relative(webRoot, file)} ${e}`));
		}
	} catch (e) {
		return { type: 'styles', css, imports, error: `websquare/config.xml 읽기 실패: ${errorMessage(e)}` };
	}
	const error = [
		failed.length && `CSS를 읽지 못함: ${failed.join(', ')}`,
		broken.length && `CSS 문법 오류(그 부분만 빼고 적용): ${broken.join(', ')}`,
	].filter(Boolean).join(' / ');
	return { type: 'styles', css, imports, ...error && { error } };
}

async function loadModules(webRoot: string): Promise<Extract<ToWebview, { type: 'modules' }>> {
	try {
		const { files, failed } = await engineModules(webRoot);
		return { type: 'modules', files, ...failed.length && { error: `공통 JS를 읽지 못함: ${failed.join(', ')}` } };
	} catch (e) {
		return { type: 'modules', files: [], error: `공통 JS 목록(websquare/config.xml) 읽기 실패: ${errorMessage(e)}` };
	}
}

function html(webview: vscode.Webview, dist: vscode.Uri): string {
	const nonce = crypto.randomUUID().replaceAll('-', '');
	const uri = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(dist, f));
	// style·font의 https:는 프로젝트 CSS가 @import하는 외부 웹 폰트용. 스크립트는 nonce만
	return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} https: 'nonce-${nonce}'; font-src ${webview.cspSource} https:; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('webview.css')}">
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${uri('webview.js')}"></script>
</body>
</html>`;
}

export function deactivate() {}
