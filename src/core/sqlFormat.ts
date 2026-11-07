import { formatDialect, mariadb, mysql, plsql, postgresql, sql, sqlite, transactsql, type DialectOptions } from 'sql-formatter';
import type { SqlDialect } from './codeOptions';

export interface SqlFormatOptions { tabWidth: number; useTabs: boolean; dialect: SqlDialect }

/** 설정 `for-websquare5.sqlDialect` → sql-formatter 방언(쓰는 방언만 가져와 번들 크기를 줄인다) */
const DIALECTS: Record<SqlDialect, DialectOptions> = { standard: sql, oracle: plsql, mysql, mariadb, postgresql, mssql: transactsql, sqlite };

/** SQL 글을 정리한다. MyBatis `#{}`·`${}`는 파라미터로 보고 그대로 둔다. 문법을 못 읽으면 예외 */
export function formatSqlText(text: string, options: SqlFormatOptions): string {
	return formatDialect(text, { dialect: DIALECTS[options.dialect], tabWidth: options.tabWidth, useTabs: options.useTabs, keywordCase: 'upper', linesBetweenQueries: 1, paramTypes: { custom: [{ regex: '[#$]\\{[^}]*\\}' }] } });
}

const xmlComment = /<!--[\s\S]*?-->/g;

/** 선택한 매퍼 글에 XML 태그(주석 제외)가 있는지 */
export function hasXmlTag(text: string): boolean {
	return /<(?:\/?[A-Za-z?]|!(?!--))/.test(text.replace(xmlComment, ''));
}

/** 매퍼 XML 글자에서 SQL로 바꾸고(XML 주석은 자리표시자로 보호, 엔티티는 풀기), 정리한 뒤 되돌린다 */
export function formatMapperSql(text: string, options: SqlFormatOptions): string {
	const comments: string[] = [];
	const sql = text.replace(xmlComment, found => `/*XMLC${comments.push(found) - 1}*/`)
		.replace(/&(lt|gt|amp);/g, (_, name: string) => ({ lt: '<', gt: '>', amp: '&' })[name] as string);
	return formatSqlText(sql, options).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\/\*XMLC(\d+)\*\//g, (_, index: string) => comments[Number(index)]);
}
