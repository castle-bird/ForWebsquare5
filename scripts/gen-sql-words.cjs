// @codemirror/lang-sql의 방언 명세(키워드·자료형·내장 함수)를 src/core/sqlDialectWords.ts로 뽑는다.
// 확장 호스트에서 lang-sql을 직접 import하면 번들이 429KB 늘어서, 단어만 미리 뽑아 둔다. lang-sql을 올린 뒤 `npm run gen:sql-words`
const fs = require('node:fs');
const path = require('node:path');
const sql = require('@codemirror/lang-sql');

/** core/codeOptions의 SQL_DIALECTS 이름 → lang-sql 방언. standard는 명세에 단어가 없다(기본 단어는 core/sqlCompletion) */
const DIALECTS = { oracle: 'PLSQL', mysql: 'MySQL', mariadb: 'MariaSQL', postgresql: 'PostgreSQL', mssql: 'MSSQL', sqlite: 'SQLite' };

const words = text => [...new Set((text ?? '').split(/\s+/).map(w => w.toLowerCase()).filter(w => /^[a-z_][a-z0-9_$#]*$/.test(w)))].sort();

const body = Object.entries(DIALECTS).map(([id, name]) => {
	const spec = sql[name].spec;
	const keywords = words(`${spec.keywords ?? ''} ${spec.types ?? ''}`), functions = words(spec.builtin);
	return `\t${id}: {\n\t\tkeywords: '${keywords.join(' ')}',\n\t\tfunctions: '${functions.join(' ')}',\n\t},`;
}).join('\n');

const text = `// 자동 생성: scripts/gen-sql-words.cjs (@codemirror/lang-sql 방언 명세). 직접 고치지 않는다
import type { SqlDialect } from './codeOptions';

export const SQL_DIALECT_WORDS: Partial<Record<SqlDialect, { keywords: string; functions: string }>> = {
${body}
};
`;

fs.writeFileSync(path.join(__dirname, '..', 'src', 'core', 'sqlDialectWords.ts'), text);
console.log(`src/core/sqlDialectWords.ts 생성 (${text.length}자)`);
