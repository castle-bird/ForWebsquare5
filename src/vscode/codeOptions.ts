// 코드 편집기 공통 옵션을 VS Code 설정에서 읽는다(줄바꿈 = editor.wordWrap, SQL 방언 = websquare5-editor.sqlDialect)
import * as vscode from 'vscode';
import { readSqlDialect, readWordWrap, type CodeOptions } from '../core/codeOptions';

const SQL_DIALECT_SETTING = 'websquare5-editor.sqlDialect';

export const codeOptions = (): CodeOptions => ({
	wordWrap: readWordWrap(vscode.workspace.getConfiguration('editor').get('wordWrap')),
	sqlDialect: readSqlDialect(vscode.workspace.getConfiguration().get(SQL_DIALECT_SETTING)),
});

export const affectsCodeOptions = (e: vscode.ConfigurationChangeEvent) => e.affectsConfiguration('editor.wordWrap') || e.affectsConfiguration(SQL_DIALECT_SETTING);
