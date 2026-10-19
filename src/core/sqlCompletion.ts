// MyBatis 매퍼 XML 안 SQL 자동완성: SQL 자리 판단, 키워드·함수 목록(방언별)
import type { SqlDialect } from './codeOptions';
import { SQL_DIALECT_WORDS } from './sqlDialectWords';

/** 매퍼 XML인지(DOCTYPE mapper 또는 mapper 태그) */
export const isMapper = (xml: string) => /<!DOCTYPE\s+mapper\b|<mapper[\s>]/.test(xml);

const STATEMENT = /<(\/?)(select|insert|update|delete|sql)\b[^>]*?(\/?)>/g;

const stripXmlComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, m => m.includes('\n') ? '\n' : '');

/** offset이 SQL 주석 안인지: 같은 줄의 -- 뒤(문자열·XML 주석 안 -- 는 빼고), 아직 안 닫은 /* 뒤 */
export function inSqlComment(xml: string, offset: number): boolean {
	const before = stripXmlComments(xml.slice(0, offset));
	const line = before.slice(before.lastIndexOf('\n') + 1).replace(/'[^']*'/g, '');
	return line.includes('--') || before.lastIndexOf('/*') > before.lastIndexOf('*/');
}

/** offset이 SQL 구문 태그(select·insert·update·delete·sql) 안 글자·CDATA인지. 태그·속성·XML 주석 안이면 false */
export function inSql(xml: string, offset: number): boolean {
	const before = xml.slice(0, offset);
	if (before.lastIndexOf('<![CDATA[') <= before.lastIndexOf(']]>')
		&& (before.lastIndexOf('<!--') > before.lastIndexOf('-->') || before.lastIndexOf('<') > before.lastIndexOf('>'))) {
		return false;
	}
	if (inSqlComment(xml, offset)) {
		return false;
	}
	let open = false;
	for (const m of stripXmlComments(before).matchAll(STATEMENT)) {
		open = !m[1] && !m[3];
	}
	return open;
}

const KEYWORDS = 'select from where and or not in is null like between exists as on join inner left right full outer cross union all distinct '
	+ 'group by order having asc desc case when then else end insert into values update set delete merge using matched with '
	+ 'create table alter drop index view primary key foreign references default constraint unique truncate over partition '
	+ 'intersect except any some escape nulls first last';
const FUNCTIONS = 'count sum avg min max coalesce nullif cast upper lower trim ltrim rtrim length replace substr round trunc abs mod '
	+ 'lpad rpad concat greatest least row_number rank dense_rank lag lead current_date current_timestamp';
/**
 * 방언 명세(SQL_DIALECT_WORDS, lang-sql에서 생성)에 없는 자주 쓰는 단어. lang-sql은 Oracle `nvl`·`decode`·`sysdate`,
 * PostgreSQL `now`·`to_char`, MySQL `ifnull`·`date_format`, SQLite `strftime` 같은 함수를 빼 두었다
 */
const DIALECT_WORDS: Partial<Record<SqlDialect, { keywords?: string; functions: string }>> = {
	oracle: {
		keywords: 'minus rownum rowid dual connect prior start level nocycle siblings fetch next rows only offset',
		functions: 'nvl nvl2 decode to_char to_date to_number to_timestamp instr sysdate systimestamp add_months months_between last_day '
			+ 'listagg regexp_replace regexp_substr regexp_like regexp_instr sys_guid initcap extract',
	},
	postgresql: {
		keywords: 'ilike returning limit offset fetch next rows only',
		functions: 'now to_char to_date to_number to_timestamp date_trunc extract string_agg array_agg position substring split_part '
			+ 'regexp_replace generate_series age',
	},
	mysql: {
		functions: 'ifnull now curdate curtime date_format str_to_date find_in_set concat_ws date_add date_sub datediff timestampdiff',
	},
	mariadb: {
		functions: 'ifnull now curdate curtime date_format str_to_date group_concat find_in_set concat_ws date_add date_sub datediff timestampdiff',
	},
	mssql: { keywords: 'offset', functions: '' },
	sqlite: {
		functions: 'ifnull datetime strftime group_concat random julianday instr printf',
	},
};

const words = (text: string) => text.split(' ').filter(Boolean);

/** 방언의 키워드·함수(소문자, 중복 없음): 기본 단어 + lang-sql 방언 명세 + 자주 쓰는 보충 단어 */
export function sqlWords(dialect: SqlDialect): { keywords: string[]; functions: string[] } {
	const spec = SQL_DIALECT_WORDS[dialect], extra = DIALECT_WORDS[dialect];
	return {
		keywords: [...new Set(words([KEYWORDS, spec?.keywords, extra?.keywords].filter(Boolean).join(' ')))],
		functions: [...new Set(words([FUNCTIONS, spec?.functions, extra?.functions].filter(Boolean).join(' ')))],
	};
}
