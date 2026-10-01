// SQL 언어(@codemirror/lang-sql, MIT): `.sql` 연결 파일, MyBatis 매퍼 XML 안의 SQL(태그 사이 글자·CDATA)
import { keywordCompletionSource, MariaSQL, MSSQL, MySQL, PLSQL, PostgreSQL, SQLite, StandardSQL, type SQLDialect } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { highlightingFor, LanguageSupport, syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type EditorState } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { highlightTree } from '@lezer/highlight';
import type { CompletionSource } from '@codemirror/autocomplete';
import type { SqlDialect } from '../../core/codeOptions';
import { skipExistingCloseTag } from './xmlSupport';

const DIALECTS: Record<SqlDialect, SQLDialect> = {
	standard: StandardSQL, oracle: PLSQL, mysql: MySQL, mariadb: MariaSQL, postgresql: PostgreSQL, mssql: MSSQL, sqlite: SQLite,
};

const CDATA_OPEN = '<![CDATA[', CDATA_CLOSE = ']]>';
const MAX_CACHED = 2000;

const memo = <T>(make: (dialect: SqlDialect) => T) => {
	const cache = new Map<SqlDialect, T>();
	return (dialect: SqlDialect): T => cache.get(dialect) ?? (cache.set(dialect, make(dialect)), cache.get(dialect)!);
};

/** `.sql` 파일 편집기 언어와 키워드 자동완성 */
export const sqlFile = memo((id): { lang: LanguageSupport; complete: CompletionSource } => {
	const dialect = DIALECTS[id];
	return { lang: new LanguageSupport(dialect.language), complete: keywordCompletionSource(dialect) };
});

/** 매퍼 XML에서 SQL로 읽는 자리: 태그 사이 글자와 CDATA 안쪽. 공백뿐인 조각은 제외 */
function sqlRange(state: EditorState, node: { name: string; from: number; to: number }): { from: number; to: number } | undefined {
	let { from, to } = node;
	if (node.name === 'Cdata') {
		from += CDATA_OPEN.length;
		to -= state.sliceDoc(to - CDATA_CLOSE.length, to) === CDATA_CLOSE ? CDATA_CLOSE.length : 0;
	} else if (node.name !== 'Text') {
		return undefined;
	}
	return from < to && /\S/.test(state.sliceDoc(from, to)) ? { from, to } : undefined;
}

/**
 * 화면에 보이는 SQL 자리만 SQL 파서로 읽어 색을 칠한다(색은 편집기 테마). XML 파서에 SQL 파서를 겹쳐 물리면(parseMixed)
 * 편집할 때마다 문서 안 모든 조각을 다시 읽어 큰 매퍼에서 느려진다. 보이는 부분만 하면 파일 크기와 상관없이 일정하다
 */
const sqlColors = (dialect: SQLDialect) => ViewPlugin.fromClass(class {
	decorations: DecorationSet;
	marks = new Map<string, Decoration>();
	// 글자 → 색 조각(글자 안 위치). 스크롤하면 같은 조각을 다시 읽지 않는다. 테마가 바뀌면 비운다
	tokens = new Map<string, [number, number, Decoration][]>();
	constructor(view: EditorView) {
		this.decorations = this.build(view);
	}
	update(u: ViewUpdate) {
		const reconfigured = u.transactions.some(tr => tr.reconfigured);
		if (reconfigured) {
			this.marks.clear();
			this.tokens.clear();
		}
		if (u.docChanged || u.viewportChanged || reconfigured || syntaxTree(u.startState) !== syntaxTree(u.state)) {
			this.decorations = this.build(u.view);
		}
	}
	build(view: EditorView): DecorationSet {
		const { state } = view, builder = new RangeSetBuilder<Decoration>();
		const style = { style: (tags: Parameters<typeof highlightingFor>[1]) => highlightingFor(state, tags) };
		let done = 0;
		for (const visible of view.visibleRanges) {
			syntaxTree(state).iterate({ from: visible.from, to: visible.to, enter: node => {
				const range = node.from >= done ? sqlRange(state, node) : undefined;
				if (!range) {
					return;
				}
				done = range.to;
				const text = state.sliceDoc(range.from, range.to);
				let found = this.tokens.get(text);
				if (!found) {
					const list: [number, number, Decoration][] = found = [];
					highlightTree(dialect.language.parser.parse(text), style, (from, to, classes) => {
						list.push([from, to, this.marks.get(classes) ?? this.marks.set(classes, Decoration.mark({ class: classes })).get(classes)!]);
					});
					this.tokens.size > MAX_CACHED && this.tokens.clear();
					this.tokens.set(text, found);
				}
				for (const [from, to, mark] of found) {
					builder.add(range.from + from, range.from + to, mark);
				}
				return false;
			} });
		}
		return builder.finish();
	}
}, { decorations: plugin => plugin.decorations });

/** XML 편집기 언어 + 그 안의 SQL 색 */
export const xmlWithSql = memo(id => {
	const base = xml();
	return new LanguageSupport(base.language, [base.support, skipExistingCloseTag, sqlColors(DIALECTS[id])]);
});

/** 태그 사이 글자·CDATA 안이면 SQL 키워드, 아니면(태그·속성 자리) xml 자동완성 */
export const sqlOrXmlCompletion = (id: SqlDialect, xmlSource: CompletionSource): CompletionSource => {
	const sqlSource = keywordCompletionSource(DIALECTS[id]);
	return context => {
		const node = syntaxTree(context.state).resolveInner(context.pos, -1);
		return sqlRange(context.state, { name: node.name, from: node.from, to: node.to }) ? sqlSource(context) : xmlSource(context);
	};
};
