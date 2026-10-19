import * as vscode from 'vscode';
import { applyEdits, type TextEdit } from '../core/edit';
import { missingImportsEdit } from '../core/javaImports';

/**
 * Java 언어 서버(Language Support for Java)의 Organize imports 결과 중 빠진 import 추가분(빈 범위 삽입, 문서 기준 위치).
 * 서버가 없거나 준비 전이거나 Java 문서가 아니면 undefined. 여러 후보라 서버가 고르게 하는 import는 건너뛴다
 */
export async function missingImports(document: vscode.TextDocument): Promise<TextEdit | undefined> {
	if (document.languageId !== 'java') { return undefined; }
	const version = document.version, text = document.getText();
	const actions = await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[] | undefined>('vscode.executeCodeActionProvider',
		document.uri, new vscode.Range(0, 0, document.lineCount, 0), vscode.CodeActionKind.SourceOrganizeImports.value, 5);
	const edits = actions?.flatMap(a => 'edit' in a && a.edit ? a.edit.get(document.uri) : []);
	if (!edits?.length || document.version !== version) { return undefined; }
	const organized = applyEdits(text, edits.map(e => ({ start: document.offsetAt(e.range.start), end: document.offsetAt(e.range.end), replacement: e.newText })));
	return missingImportsEdit(text, organized);
}

/** 문서 글에 빠진 import를 넣은 글(넣을 게 없으면 undefined) */
export async function addMissingImports(document: vscode.TextDocument): Promise<string | undefined> {
	const edit = await missingImports(document);
	return edit && applyEdits(document.getText(), [edit]);
}
