import * as vscode from 'vscode';
import { isScreen, parseXml, type XmlNode } from './core/xmlModel';
import type { ToWebview } from './core/protocol';
import { findWebRoot } from './project/paths';
import { disposeBrowserPreviews } from './vscode/browserPreview';
import { disposeWpack } from './project/wpack';
import { registerSetup } from './vscode/setup';
import { registerLinks } from './vscode/links';
import { registerViewSettings } from './vscode/viewSettings';
import { registerCodeTheme } from './vscode/codeTheme';
import { createScreen } from './vscode/createScreen';
import { registerSqlCompletion } from './vscode/sqlCompletion';
import { registerScreenOpen, rememberScreenEditor } from './vscode/screenOpen';
import { registerWpack } from './vscode/wpack';
import { ScreenSession, VIEW_TYPE } from './vscode/screenSession';

export { openFrame, VIEW_TYPE } from './vscode/screenSession';

export function activate(context: vscode.ExtensionContext) {
	registerSetup(context);
	registerWpack(context);
	registerViewSettings(context);
	registerLinks(context);
	registerSqlCompletion(context);
	registerCodeTheme(context, msg => panels.forEach(p => void p.webview.postMessage(msg)));
	context.subscriptions.push(
		vscode.commands.registerCommand('for-websquare5.createFile', createScreen),
		vscode.window.registerCustomEditorProvider(VIEW_TYPE, new DesignerProvider(context.extensionUri, context.globalState, context.workspaceState, context.storageUri ?? context.globalStorageUri), {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		// 포맷 단축키(Ctrl+Alt+L): 웹뷰는 VS Code 키 바인딩으로 받아 보이는 편집기에 전달. Alt+글자 조합은 웹뷰에서 VS Code 메뉴가 열려서 피한다.
		vscode.commands.registerCommand('for-websquare5.format', () => {
			const panel = [...panels].find(p => p.active);
			void panel?.webview.postMessage({ type: 'formatKey' } satisfies ToWebview);
		}),
	);
	registerScreenOpen(context, VIEW_TYPE);
}

const panels = new Set<vscode.WebviewPanel>();

/** 모든 화면 공통 설정(탭 순서·위치)을 바꾼 화면 말고 다른 화면에 */
function broadcast(from: vscode.WebviewPanel, msg: ToWebview) {
	panels.forEach(p => p !== from && void p.webview.postMessage(msg));
}

class DesignerProvider implements vscode.CustomTextEditorProvider {
	/** tablesFolder: ERD 사용 테이블 기본 저장 폴더(확장 전용, 이 PC) */
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
			// 화면이 아니면 같은 자리에서 텍스트로 바꾼다. 탐색기 한 번 클릭처럼 미리보기로 열린 경우는 포커스를 탐색기에 남긴다(F2 이름 바꾸기 등)
			const tab = vscode.window.tabGroups.all.flatMap(g => g.tabs.map(t => ({ g, t })))
				.find(({ g, t }) => g.viewColumn === panel.viewColumn && t.input instanceof vscode.TabInputCustom && t.input.viewType === VIEW_TYPE && t.input.uri.toString() === document.uri.toString());
			await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default',
				tab ? { viewColumn: tab.g.viewColumn, preview: tab.t.isPreview, preserveFocus: tab.t.isPreview } : undefined);
			panel.dispose();
			return;
		}

		rememberScreenEditor(document);
		panels.add(panel);
		panel.onDidDispose(() => panels.delete(panel));
		const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
		panel.webview.options = { enableScripts: true, localResourceRoots: [dist, vscode.Uri.file(webRoot)] };
		panel.webview.html = html(panel.webview, dist);
		new ScreenSession(document, panel, webRoot, {
			globalState: this.globalState, workspaceState: this.workspaceState, tablesFolder: this.tablesFolder,
			broadcast: msg => broadcast(panel, msg),
		}).warmWpack();
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
<script type="module" nonce="${nonce}" src="${uri('webview.js')}"></script>
</body>
</html>`;
}

export function deactivate() {
	disposeWpack();
	disposeBrowserPreviews();
}
