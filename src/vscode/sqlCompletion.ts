// MyBatis 매퍼 XML(.xml = VS Code XML 언어) 안 SQL 자동완성. 연결 탭도 VS Code 자동완성 결과를 받으므로 같이 쓴다
import * as vscode from 'vscode';
import { inSql, isMapper, sqlWords } from '../core/sqlCompletion';
import { codeOptions } from './codeOptions';

const K = vscode.CompletionItemKind;

export function registerSqlCompletion(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'xml' }, {
		provideCompletionItems(document, position) {
			const xml = document.getText();
			if (!isMapper(xml) || !inSql(xml, document.offsetAt(position))) {
				return undefined;
			}
			// 친 첫 글자가 대문자면 대문자로
			const typed = document.getText(document.getWordRangeAtPosition(position) ?? new vscode.Range(position, position));
			const upper = /^[A-Z]/.test(typed);
			const item = (label: string, kind: vscode.CompletionItemKind, detail: string) =>
				Object.assign(new vscode.CompletionItem(upper ? label.toUpperCase() : label, kind), { detail });
			const { keywords, functions } = sqlWords(codeOptions().sqlDialect);
			return [...keywords.map(k => item(k, K.Keyword, 'SQL 키워드')), ...functions.map(f => item(f, K.Function, 'SQL 함수'))];
		},
	}));
}
