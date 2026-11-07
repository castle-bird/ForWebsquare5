import * as vscode from 'vscode';
import type { SqlDialect } from '../core/codeOptions';
import { formatMapperSql, hasXmlTag } from '../core/sqlFormat';

/** 매퍼 XML에서 선택한 부분(편집기 글자 위치, 줄바꿈은 \n 한 글자)만 SQL로 정리한 문서 글. 정리할 수 없으면 알리고 undefined */
export function formatMapperRange(text: string, range: { from: number; to: number }, dialect: SqlDialect): string | undefined {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const lf = text.replace(/\r\n/g, '\n');
	const selected = lf.slice(range.from, range.to);
	if (!selected.trim()) { return undefined; }
	if (hasXmlTag(selected)) {
		void vscode.window.showInformationMessage('선택한 부분에 XML 태그가 있어 SQL 포맷을 하지 않았습니다. 태그를 뺀 SQL만 선택해 주세요.');
		return undefined;
	}
	try {
		const formatted = formatMapperSql(selected, { tabWidth: 4, useTabs: false, dialect }).trim();
		const lineStart = lf.lastIndexOf('\n', range.from - 1) + 1;
		const base = /^[ \t]*/.exec(lf.slice(lineStart, range.from))![0];
		const indented = formatted.split('\n').map((line, index) => index && line ? base + line : line).join('\n');
		return (lf.slice(0, range.from) + indented + lf.slice(range.to)).replace(/\n/g, eol);
	} catch {
		void vscode.window.showWarningMessage('선택한 SQL을 정리하지 못했습니다. 문법을 확인해 주세요.');
		return undefined;
	}
}
