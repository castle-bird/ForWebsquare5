import * as vscode from 'vscode';
import { isScreen, parseXml } from '../core/xmlModel';
import { findWebRoot } from '../project/paths';

// 디자이너를 거친 문서는 사용자가 텍스트로 다시 열어도 되돌리지 않는다.
const designerDocuments = new WeakSet<vscode.TextDocument>();
export const rememberScreenEditor = (document: vscode.TextDocument) => designerDocuments.add(document);

export function registerScreenOpen(context: vscode.ExtensionContext, viewType: string): void {
	const pending = new WeakSet<vscode.TextDocument>();
	const nonScreenVersion = new WeakMap<vscode.TextDocument, number>();
	let disposed = false;
	const open = async () => {
		const editor = vscode.window.activeTextEditor;
		const group = vscode.window.tabGroups.activeTabGroup;
		const tab = group.activeTab;
		if (disposed || !vscode.workspace.isTrusted || !editor || !(tab?.input instanceof vscode.TabInputText)) { return; }
		const document = editor.document;
		const version = document.version;
		if (document.uri.scheme !== 'file' || !/\.xml$/i.test(document.uri.path) || document.isDirty || document.isClosed
			|| tab.input.uri.toString() !== document.uri.toString() || designerDocuments.has(document) || pending.has(document)
			|| nonScreenVersion.get(document) === version) { return; }
		pending.add(document);
		try {
			if (!isScreen(parseXml(document.getText())) || !await findWebRoot(document.uri.fsPath)) {
				nonScreenVersion.set(document, version);
				return;
			}
			// 파일을 찾는 동안 사용자가 다른 탭으로 이동하거나 편집했으면 포커스를 빼앗지 않는다.
			if (disposed || document.isClosed || document.isDirty || document.version !== version || designerDocuments.has(document)
				|| vscode.window.activeTextEditor !== editor || vscode.window.tabGroups.activeTabGroup !== group || group.activeTab !== tab) { return; }
			await vscode.commands.executeCommand('vscode.openWith', document.uri, viewType, {
				viewColumn: group.viewColumn, preview: tab.isPreview, preserveFocus: false,
			});
			const opened = group.tabs.some(t => t.input instanceof vscode.TabInputCustom
				&& t.input.viewType === viewType && t.input.uri.toString() === document.uri.toString());
			if (opened) {
				rememberScreenEditor(document);
				if (group.tabs.includes(tab) && tab.input instanceof vscode.TabInputText && !tab.isDirty && !document.isDirty) { await vscode.window.tabGroups.close(tab, true); }
			}
		} catch {
			// 잘못된 XML·읽기 실패·열기 실패는 원래 텍스트 탭을 유지한다.
		} finally {
			pending.delete(document);
		}
	};
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => void open()),
		vscode.window.tabGroups.onDidChangeTabs(() => void open()),
		{ dispose: () => { disposed = true; } },
	);
	void open();
}
