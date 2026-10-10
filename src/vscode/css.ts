import * as vscode from 'vscode';
import type { CssRuleSource } from '../core/protocol';

export async function openCss(sources: CssRuleSource[], indexes: number[]): Promise<void> {
	// 웹뷰가 보낸 경로를 열지 않고 이 화면에 로드한 CSS 목록의 번호만 받는다.
	if (!Array.isArray(indexes) || !indexes.every(i => Number.isInteger(i) && i >= 0 && i < sources.length)) { return; }
	const items = [...new Set(indexes)].map(i => ({
		label: sources[i].selector,
		description: `${vscode.workspace.asRelativePath(vscode.Uri.file(sources[i].file), false)}:${sources[i].line + 1}`,
		source: sources[i],
	}));
	if (!items.length) {
		void vscode.window.showInformationMessage('이 컴포넌트에 일치하는 로컬 CSS 규칙이 없습니다.');
		return;
	}
	const picked = items.length === 1 ? items[0] : await vscode.window.showQuickPick(items, {
		title: 'CSS 이동', placeHolder: '이동할 CSS 규칙을 선택하세요', matchOnDescription: true,
	});
	if (!picked) { return; }
	const { file, line } = picked.source;
	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
	await vscode.window.showTextDocument(document, { selection: document.lineAt(line).range, preview: false });
}
