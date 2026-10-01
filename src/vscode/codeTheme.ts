// 코드 편집기 테마 고르기: 웹뷰 코드 편집기 우클릭(또는 명령 팔레트) → 목록에서 위아래로 미리 보기, Enter로 적용(모든 화면 공통)
import * as vscode from 'vscode';
import { CODE_THEMES, readCodeTheme, type CodeThemeId } from '../core/codeTheme';
import type { ToWebview } from '../core/protocol';

const KEY = 'websquare5-editor.codeTheme';
let globalState: vscode.Memento;

export const codeTheme = () => readCodeTheme(globalState.get(KEY));

export function registerCodeTheme(context: vscode.ExtensionContext, broadcast: (msg: ToWebview) => void): void {
	globalState = context.globalState;
	context.subscriptions.push(vscode.commands.registerCommand('websquare5-editor.codeTheme', () => pickCodeTheme(broadcast)));
}

function pickCodeTheme(broadcast: (msg: ToWebview) => void): void {
	const current = codeTheme();
	const items = CODE_THEMES.map(t => ({ id: t.id as CodeThemeId, label: t.label, description: 'dark' in t ? t.dark ? '어두움' : '밝음' : undefined }));
	const pick = vscode.window.createQuickPick<typeof items[number]>();
	pick.title = '코드 편집기 테마';
	pick.placeholder = '위아래로 움직이면 미리 보기, Enter로 적용 (Esc: 취소)';
	pick.items = items;
	pick.activeItems = items.filter(i => i.id === current);
	let chosen: CodeThemeId | undefined;
	pick.onDidChangeActive(([item]) => item && broadcast({ type: 'codeTheme', theme: item.id }));
	pick.onDidAccept(() => {
		chosen = pick.activeItems[0]?.id;
		pick.hide();
	});
	pick.onDidHide(() => {
		const theme = chosen ?? current;
		void globalState.update(KEY, theme);
		broadcast({ type: 'codeTheme', theme });
		pick.dispose();
	});
	pick.show();
}
