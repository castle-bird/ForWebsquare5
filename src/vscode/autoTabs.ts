// VS Code는 저장 안 한 파일을 잃지 않게 배경 탭(비활성)으로 연다. 연결 탭에서 고친 파일이 그렇게 열리면 기억했다가
// 연결 탭에서 저장하면 닫는다. 사용자가 그 탭을 한 번이라도 보면(활성) 사용자 탭으로 보고 닫지 않는다
import * as vscode from 'vscode';

const autoTabs = new Set<string>();

const tabUri = (tab: vscode.Tab) => tab.input instanceof vscode.TabInputText ? tab.input.uri.toString() : undefined;
const tabsOf = (uri: string) => vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => tabUri(t) === uri);

/** isLinked: 열린 디자이너가 연결 중인 파일인지 */
export function registerAutoTabs(context: vscode.ExtensionContext, isLinked: (uri: string) => boolean): void {
	context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(e => {
		for (const tab of e.opened) {
			const uri = tabUri(tab);
			if (uri && isLinked(uri) && !tab.isActive && vscode.workspace.textDocuments.some(d => d.uri.toString() === uri && d.isDirty)) {
				autoTabs.add(uri);
			}
		}
		for (const tab of [...e.changed, ...e.opened]) {
			const uri = tabUri(tab);
			if (uri && tab.isActive) {
				autoTabs.delete(uri);
			}
		}
		for (const tab of e.closed) {
			const uri = tabUri(tab);
			if (uri && !tabsOf(uri).length) {
				autoTabs.delete(uri);
			}
		}
	}));
}

export const isAutoTab = (uri: vscode.Uri) => autoTabs.has(uri.toString());

/** 사용자가 VS Code 탭으로 열어 둔 파일인지(배경 탭은 빼고) */
export const isOpenByUser = (uri: vscode.Uri) => !isAutoTab(uri) && tabsOf(uri.toString()).length > 0;

/** 저장한 뒤: VS Code가 배경으로 열어 둔 탭을 닫는다(저장돼 있어 확인 창 없음) */
export async function closeAutoTabs(doc: vscode.TextDocument): Promise<void> {
	const uri = doc.uri.toString();
	if (!autoTabs.delete(uri) || doc.isDirty) {
		return;
	}
	const tabs = tabsOf(uri).filter(t => !t.isActive && !t.isDirty);
	if (tabs.length) {
		await vscode.window.tabGroups.close(tabs, true);
	}
}
