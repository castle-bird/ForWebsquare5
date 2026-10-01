// 연결 탭 편집기: 연결한 파일의 확장자로 언어·기본 자동완성(VS Code 언어 확장 결과가 없을 때)·문법 검사를 고른다
import { autoCloseTags as htmlAutoCloseTags, htmlCompletionSource, htmlLanguage } from '@codemirror/lang-html';
import { cssCompletionSource, cssLanguage } from '@codemirror/lang-css';
import { javascriptLanguage, localCompletionSource, snippets } from '@codemirror/lang-javascript';
import { completeFromList, type CompletionSource } from '@codemirror/autocomplete';
import { LanguageSupport, StreamLanguage } from '@codemirror/language';
import { completeFromSchema } from '@codemirror/lang-xml';
import type { XmlElementSpec } from '../../core/protocol';
import { javaCompletions, javaSupport } from './java';
import { mybatisCompletions } from './mybatis';
import { sqlFile, sqlOrXmlCompletion, xmlWithSql } from './sql';
import type { SqlDialect } from '../../core/codeOptions';
import { skipExistingCloseTag } from './xmlSupport';
import type { LintMode } from './lint';
import { docComments } from './docComment';

interface LinkLanguage { lang: LanguageSupport; complete: CompletionSource; lint?: LintMode }

// 기본 자동완성은 complete 하나로만(언어 지원에 자동완성을 같이 넣으면 VS Code 결과와 겹쳐 두 번 뜬다)
const JS_SNIPPETS = completeFromList(snippets);
const LANGUAGES: Record<string, LinkLanguage> = {
	java: { lang: javaSupport, complete: javaCompletions },
	xml: { lang: xmlWithSql('standard'), complete: mybatisCompletions, lint: 'xml' },
	html: { lang: new LanguageSupport(htmlLanguage, [htmlAutoCloseTags, skipExistingCloseTag]), complete: htmlCompletionSource },
	css: { lang: new LanguageSupport(cssLanguage), complete: cssCompletionSource },
	js: { lang: new LanguageSupport(javascriptLanguage, docComments('js')), complete: context => localCompletionSource(context) ?? JS_SNIPPETS(context), lint: 'jsFile' },
};
LANGUAGES.htm = LANGUAGES.html;

// 그 밖의 확장자(설정으로 더한 .jsp·.sql 등)는 일반 텍스트: 색 없음, 기본 자동완성 없음(VS Code 언어 확장 결과는 그대로)
const PLAIN: LinkLanguage = { lang: new LanguageSupport(StreamLanguage.define({ token: stream => { stream.skipToEnd(); return null; } })), complete: () => null };

/** 확장자로 편집기 언어. XML이고 DTD 스키마가 있으면 그 스키마로 자동완성(없으면 기본 MyBatis 목록). XML 안 SQL·.sql은 방언에 맞춰 */
export function linkLanguage(file: string, schema?: XmlElementSpec[], dialect: SqlDialect = 'standard'): LinkLanguage {
	const ext = /\.(\w+)$/.exec(file.toLowerCase())?.[1] ?? '';
	if (ext === 'sql') {
		return sqlFile(dialect);
	}
	const language = LANGUAGES[ext] ?? PLAIN;
	return language === LANGUAGES.xml ? { ...language, lang: xmlWithSql(dialect), complete: sqlOrXmlCompletion(dialect, schema ? completeFromSchema(schema, []) : language.complete) } : language;
}
