// MyBatis 매퍼 XML의 SQL을 node-sql-parser로 분석해 ERD 사용 테이블·CRUD·컬럼·조인 관계를 추출한다.
// 방언별 파서(node-sql-parser/build/*)는 실제 실행할 때만 동적 import로 불러 초기 번들 크기를 늘리지 않는다
import { parseDocument } from 'htmlparser2';
import { isTag, isText, isCDATA, type ChildNode, type Element } from 'domhandler';
import type { Parser as SqlParser } from 'node-sql-parser';
import type { SqlDialect } from './codeOptions';
import { placeNewTables } from './erdLayout';
import { CRUD, type CrudKey, type TableLink, type UsedColumn, type UsedTable, type UsedTables } from './tables';

interface ExtractedTable {
	name: string;
	crud: CrudKey[];
	columns: string[];
}

interface ExtractedJoin {
	from: string;
	to: string;
	label: string;
}

export interface MapperExtractResult {
	tables: ExtractedTable[];
	joins: ExtractedJoin[];
	/** 분석한 SQL 구문 수 */
	parsed: number;
	/** 파싱에 실패해 건너뛴 구문 수 */
	failed: number;
}

const STATEMENT_CRUD: Record<string, CrudKey> = {
	select: 'R',
	insert: 'C',
	update: 'U',
	delete: 'D',
};

const OP_CRUD: Record<string, CrudKey> = {
	select: 'R',
	insert: 'C',
	replace: 'C',
	update: 'U',
	delete: 'D',
};

/** 실제 DB 테이블이 아닌 가상 테이블·의사 컬럼 제외 목록 */
const IGNORED_TABLES = new Set(['dual', 'sysibm.sysdummy1']);
const IGNORED_COLUMNS = new Set([
	'sysdate', 'systimestamp', 'rownum', 'rowid', 'level',
	'current_date', 'current_timestamp', 'current_time', 'nextval', 'currval',
]);

type DialectBuild = 'postgresql' | 'mysql' | 'mariadb' | 'transactsql' | 'sqlite';

function dialectBuilds(dialect: SqlDialect): DialectBuild[] {
	switch (dialect) {
		case 'mysql': return ['mysql', 'postgresql'];
		case 'mariadb': return ['mariadb', 'mysql'];
		case 'mssql': return ['transactsql', 'postgresql'];
		case 'sqlite': return ['sqlite', 'postgresql'];
		case 'oracle':
		case 'postgresql':
		case 'standard':
		default:
			return ['postgresql', 'mysql'];
	}
}

type ParserCtor = new () => SqlParser;
type ParserModule = { Parser?: unknown; default?: { Parser?: unknown } };

function resolveParser(mod: ParserModule): SqlParser {
	const Ctor = (mod.Parser ?? mod.default?.Parser) as ParserCtor | undefined;
	if (!Ctor) { throw new Error('SQL 파서를 불러오지 못했습니다.'); }
	return new Ctor();
}

const parserCache = new Map<DialectBuild, Promise<SqlParser>>();

function loadParser(build: DialectBuild): Promise<SqlParser> {
	let cached = parserCache.get(build);
	if (!cached) {
		cached = (async () => {
			switch (build) {
				case 'mysql': return resolveParser(await import('node-sql-parser/build/mysql.js') as ParserModule);
				case 'mariadb': return resolveParser(await import('node-sql-parser/build/mariadb.js') as ParserModule);
				case 'transactsql': return resolveParser(await import('node-sql-parser/build/transactsql.js') as ParserModule);
				case 'sqlite': return resolveParser(await import('node-sql-parser/build/sqlite.js') as ParserModule);
				case 'postgresql': return resolveParser(await import('node-sql-parser/build/postgresql.js') as ParserModule);
			}
		})();
		parserCache.set(build, cached);
	}
	return cached;
}

const MAX_INCLUDE_DEPTH = 8;

/** MyBatis 동적 태그를 SQL 파서가 읽을 수 있는 유효한 SQL 본문으로 펼친다 */
function flattenMyBatisNode(node: ChildNode, fragments: Map<string, Element>, depth: number): string {
	if (isText(node)) { return node.data; }
	if (isCDATA(node)) { return node.children.map(c => isText(c) ? c.data : '').join(''); }
	if (!isTag(node)) { return ''; }
	const tag = node.name.toLowerCase();
	if (tag === 'selectkey' || tag === 'bind') { return ''; }
	if (tag === 'include') {
		const refId = node.attribs.refid?.trim();
		const target = refId && depth < MAX_INCLUDE_DEPTH ? fragments.get(refId) : undefined;
		return target ? target.children.map(c => flattenMyBatisNode(c, fragments, depth + 1)).join('') : '';
	}
	if (tag === 'choose') {
		const branch = node.children.find(c => isTag(c) && (c.name.toLowerCase() === 'when' || c.name.toLowerCase() === 'otherwise'));
		return branch && isTag(branch) ? branch.children.map(c => flattenMyBatisNode(c, fragments, depth)).join('') : '';
	}
	const inner = node.children.map(c => flattenMyBatisNode(c, fragments, depth)).join('');
	if (tag === 'where') {
		const cleaned = inner.trim().replace(/^(?:AND|OR)\b\s*/i, '');
		return cleaned ? ` WHERE ${cleaned} ` : ' ';
	}
	if (tag === 'set') {
		const cleaned = inner.trim().replace(/,\s*$/, '');
		return cleaned ? ` SET ${cleaned} ` : ' ';
	}
	if (tag === 'trim') {
		let body = inner.trim();
		const prefixOver = node.attribs.prefixoverrides?.split('|').map(s => s.trim()).filter(Boolean) ?? [];
		const suffixOver = node.attribs.suffixoverrides?.split('|').map(s => s.trim()).filter(Boolean) ?? [];
		for (const p of prefixOver) {
			const re = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
			if (re.test(body)) { body = body.replace(re, '').trimStart(); break; }
		}
		for (const s of suffixOver) {
			const re = new RegExp(`${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
			if (re.test(body)) { body = body.replace(re, '').trimEnd(); break; }
		}
		if (!body) { return ' '; }
		return ` ${node.attribs.prefix ?? ''} ${body} ${node.attribs.suffix ?? ''} `;
	}
	if (tag === 'foreach') {
		const open = node.attribs.open ?? '';
		const close = node.attribs.close ?? '';
		const body = inner.trim() || `'1'`;
		return ` ${open}${body}${close} `;
	}
	return inner;
}

/** MyBatis 파라미터(#{}, ${})와 Oracle 특유 구문을 표준 파서가 이해할 수 있게 전처리한다 */
function sanitizeSql(raw: string): string {
	let sql = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ');
	// 문자열 리터럴 안의 #{...}·${...}는 일반 글자로 바꾸고, 밖의 파라미터는 위치에 맞는 안전한 토큰으로 치환
	let out = '';
	let inQuote = false;
	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];
		if (ch === '\'') {
			inQuote = !inQuote;
			out += ch;
			continue;
		}
		if ((ch === '#' || ch === '$') && sql[i + 1] === '{') {
			const end = sql.indexOf('}', i + 2);
			if (end > i) {
				if (inQuote) {
					out += 'p';
				} else if (ch === '$') {
					const before = out.trimEnd();
					const after = sql.slice(end + 1).trimStart();
					// FROM/JOIN/테이블 접두사나 ORDER/GROUP BY 자리면 식별자로, 아니면 리터럴로
					out += /(?:FROM|JOIN|INTO|UPDATE|ORDER\s+BY|GROUP\s+BY)\s*$/i.test(before) || after.startsWith('.') ? '_param' : `'1'`;
				} else {
					out += `'1'`;
				}
				i = end;
				continue;
			}
		}
		out += ch;
	}
	sql = out
		// Oracle 구식 외부 조인 기호 (+) 제거
		.replace(/\(\s*\+\s*\)/g, '')
		// Oracle 계층 쿼리 절 제거(앞쪽 SELECT·FROM·JOIN·WHERE만 파싱)
		.replace(/\bSTART\s+WITH\b[\s\S]*?(?=\bORDER\b|\bGROUP\b|\bUNION\b|$)/gi, ' ')
		.replace(/\bCONNECT\s+BY\b[\s\S]*?(?=\bORDER\b|\bGROUP\b|\bUNION\b|$)/gi, ' ')
		.replace(/\bORDER\s+SIBLINGS\s+BY\b/gi, 'ORDER BY')
		// 빈 쉼표·연속 AND/OR 정리
		.replace(/,\s*(?=(?:FROM|WHERE|SET|GROUP|ORDER|HAVING|LIMIT|\)|$))/gi, ' ')
		.replace(/\bWHERE\s+(?:AND|OR)\b/gi, 'WHERE')
		.trim()
		.replace(/;+$/, '');
	return sql;
}

interface AstNode {
	type?: string;
	with?: { name?: string | { value?: string }; stmt?: { ast?: AstNode } }[] | null;
	from?: FromItem[] | null;
	where?: AstNode | null;
	left?: AstNode | null;
	right?: AstNode | null;
	operator?: string;
	table?: string | null;
	column?: string | { expr?: { value?: string } } | null;
	expr?: { ast?: AstNode } | AstNode | null;
	[key: string]: unknown;
}

interface FromItem {
	db?: string | null;
	schema?: string | null;
	table?: string | null;
	as?: string | null;
	join?: string | null;
	on?: AstNode | null;
	using?: string[] | null;
	expr?: { ast?: AstNode } | null;
}

function tableNameOf(db: string | null | undefined, table: string | null | undefined): string | undefined {
	const clean = table?.replace(/^[`"\[]|[`"\]]$/g, '').trim();
	if (!clean || clean === 'null' || clean.startsWith('_param')) { return undefined; }
	const cleanDb = db?.replace(/^[`"\[]|[`"\]]$/g, '').trim();
	const full = cleanDb && cleanDb !== 'null' && !cleanDb.startsWith('_param') ? `${cleanDb}.${clean}` : clean;
	return IGNORED_TABLES.has(full.toLowerCase()) || IGNORED_TABLES.has(clean.toLowerCase()) ? undefined : full;
}

function columnNameOf(col: AstNode['column']): string | undefined {
	if (typeof col === 'string') { return col; }
	const val = col?.expr?.value;
	return typeof val === 'string' ? val : undefined;
}

/** AST 전체에서 CTE(WITH 절) 이름을 수집한다(실제 DB 테이블에서 제외하기 위해) */
function collectCtes(node: unknown, out: Set<string>): void {
	if (!node || typeof node !== 'object') { return; }
	if (Array.isArray(node)) { node.forEach(item => collectCtes(item, out)); return; }
	const a = node as AstNode;
	if (Array.isArray(a.with)) {
		for (const w of a.with) {
			const name = typeof w?.name === 'string' ? w.name : w?.name?.value;
			if (name) { out.add(name.toLowerCase()); }
		}
	}
	for (const v of Object.values(a)) {
		if (v && typeof v === 'object') { collectCtes(v, out); }
	}
}

/** ON·WHERE 식 안의 `a.col1 = b.col2` 동등 조건에서 서로 다른 두 테이블 간 조인을 수집한다 */
function collectEquiJoins(expr: AstNode | null | undefined, aliases: Map<string, string>, addJoin: (a: string, b: string, label: string) => void): void {
	if (!expr || typeof expr !== 'object') { return; }
	if (expr.type === 'binary_expr') {
		if (expr.operator === '=' && expr.left?.type === 'column_ref' && expr.right?.type === 'column_ref') {
			const lt = expr.left.table ? aliases.get(expr.left.table.toLowerCase()) : undefined;
			const rt = expr.right.table ? aliases.get(expr.right.table.toLowerCase()) : undefined;
			const lc = columnNameOf(expr.left.column);
			const rc = columnNameOf(expr.right.column);
			if (lt && rt && lt.toLowerCase() !== rt.toLowerCase()) {
				const label = lc && rc ? (lc.toLowerCase() === rc.toLowerCase() ? lc : `${lc} = ${rc}`) : '';
				addJoin(lt, rt, label);
			}
			return;
		}
		collectEquiJoins(expr.left, aliases, addJoin);
		collectEquiJoins(expr.right, aliases, addJoin);
	}
}

/** AST에서 명시적 JOIN(ON/USING)과 쉼표 조인(WHERE a.k = b.k) 관계를 추출한다 */
function collectJoins(node: unknown, ctes: Set<string>, addJoin: (a: string, b: string, label: string) => void): void {
	if (!node || typeof node !== 'object') { return; }
	if (Array.isArray(node)) { node.forEach(item => collectJoins(item, ctes, addJoin)); return; }
	const a = node as AstNode;
	if (Array.isArray(a.from) && a.from.length > 1) {
		const aliases = new Map<string, string>();
		const realTables: string[] = [];
		for (const f of a.from) {
			const t = tableNameOf(f.db ?? f.schema, f.table);
			if (!t || ctes.has(t.toLowerCase())) { continue; }
			realTables.push(t);
			aliases.set(t.toLowerCase(), t);
			const short = t.includes('.') ? t.slice(t.lastIndexOf('.') + 1) : t;
			aliases.set(short.toLowerCase(), t);
			if (f.as) { aliases.set(f.as.toLowerCase(), t); }
		}
		for (let i = 0; i < a.from.length; i++) {
			const f = a.from[i];
			if (f.on) { collectEquiJoins(f.on, aliases, addJoin); }
			if (Array.isArray(f.using) && f.using.length && i > 0) {
				const cur = tableNameOf(f.db ?? f.schema, f.table);
				const prev = realTables[0];
				if (cur && prev && cur.toLowerCase() !== prev.toLowerCase()) {
					addJoin(prev, cur, f.using.join(', '));
				}
			}
		}
		if (a.where) { collectEquiJoins(a.where, aliases, addJoin); }
	}
	for (const v of Object.values(a)) {
		if (v && typeof v === 'object') { collectJoins(v, ctes, addJoin); }
	}
}

/** Oracle MERGE INTO target USING source 구문 분해(node-sql-parser가 MERGE를 직접 지원하지 않는 경우 보조) */
function extractMerge(sql: string): { target: string; ops: CrudKey[]; usingSql?: string; usingTable?: string } | undefined {
	const m = /^\s*MERGE\s+INTO\s+([A-Za-z_][\w.$]*)\b/i.exec(sql);
	if (!m) { return undefined; }
	const target = tableNameOf(undefined, m[1]);
	if (!target) { return undefined; }
	const ops: CrudKey[] = [];
	if (/\bTHEN\s+INSERT\b/i.test(sql)) { ops.push('C'); }
	if (/\bTHEN\s+UPDATE\b/i.test(sql)) { ops.push('U'); }
	if (/\bDELETE\s+WHERE\b/i.test(sql)) { ops.push('D'); }
	if (!ops.length) { ops.push('U'); }
	const usingIdx = /\bUSING\b/i.exec(sql);
	let usingSql: string | undefined;
	let usingTable: string | undefined;
	if (usingIdx) {
		const rest = sql.slice(usingIdx.index + usingIdx[0].length).trimStart();
		if (rest.startsWith('(')) {
			let depth = 0, end = -1;
			for (let i = 0; i < rest.length; i++) {
				if (rest[i] === '(') { depth++; }
				else if (rest[i] === ')' && --depth === 0) { end = i; break; }
			}
			if (end > 1) { usingSql = rest.slice(1, end).trim(); }
		} else {
			const tm = /^([A-Za-z_][\w.$]*)/.exec(rest);
			usingTable = tm ? tableNameOf(undefined, tm[1]) : undefined;
		}
	}
	return { target, ops, usingSql, usingTable };
}

/**
 * 하나 이상의 MyBatis 매퍼 XML 문자열에서 사용 테이블·CRUD·컬럼·조인 관계를 추출한다.
 * 방언 파서는 설정(sqlDialect)에 맞춰 지연 로드한다
 */
export async function extractMapperTables(xmls: string[], dialect: SqlDialect = 'standard'): Promise<MapperExtractResult> {
	const tableMap = new Map<string, { name: string; crud: Set<CrudKey>; columns: Map<string, string> }>();
	const joinMap = new Map<string, ExtractedJoin>();
	let parsed = 0;
	let failed = 0;

	const ensureTable = (name: string) => {
		const key = name.toLowerCase();
		let entry = tableMap.get(key);
		if (!entry) {
			entry = { name, crud: new Set(), columns: new Map() };
			tableMap.set(key, entry);
		}
		return entry;
	};
	const addColumn = (table: string, col: string) => {
		const clean = col.replace(/^[`"\[]|[`"\]]$/g, '').trim();
		if (!clean || clean === '(.*)' || clean === '*' || clean.startsWith('_param') || IGNORED_COLUMNS.has(clean.toLowerCase())) { return; }
		const entry = ensureTable(table);
		const key = clean.toLowerCase();
		if (!entry.columns.has(key)) { entry.columns.set(key, clean); }
	};
	const addJoin = (a: string, b: string, label: string) => {
		const ka = a.toLowerCase(), kb = b.toLowerCase();
		if (ka === kb) { return; }
		const key = ka < kb ? `${ka}\0${kb}` : `${kb}\0${ka}`;
		const existing = joinMap.get(key);
		if (!existing) {
			joinMap.set(key, { from: ensureTable(a).name, to: ensureTable(b).name, label });
		} else if (!existing.label && label) {
			existing.label = label;
		}
	};

	const builds = dialectBuilds(dialect);
	const parseSql = async (sql: string) => {
		for (const build of builds) {
			try {
				const parser = await loadParser(build);
				return parser.parse(sql);
			} catch {
				// 다음 호환 방언으로 재시도
			}
		}
		return undefined;
	};

	const ingestParsed = (res: ReturnType<SqlParser['parse']>, fallbackCrud: CrudKey) => {
		const ctes = new Set<string>();
		collectCtes(res.ast, ctes);
		const stmtTables = new Map<string, string>();
		for (const entry of res.tableList) {
			const [op = '', db = '', rawTable = ''] = entry.split('::');
			const name = tableNameOf(db, rawTable);
			if (!name || ctes.has(name.toLowerCase())) { continue; }
			const t = ensureTable(name);
			t.crud.add(OP_CRUD[op.toLowerCase()] ?? fallbackCrud);
			stmtTables.set(name.toLowerCase(), t.name);
			const short = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
			stmtTables.set(short.toLowerCase(), t.name);
		}
		const distinctTables = [...new Set(stmtTables.values())];
		for (const entry of res.columnList) {
			const [, rawTable = '', col = ''] = entry.split('::');
			if (!col || col === '(.*)') { continue; }
			const table = rawTable && rawTable !== 'null'
				? stmtTables.get(rawTable.toLowerCase())
				: distinctTables.length === 1 ? distinctTables[0] : undefined;
			if (table) { addColumn(table, col); }
		}
		collectJoins(res.ast, ctes, addJoin);
	};

	for (const xml of xmls) {
		const doc = parseDocument(xml, { xmlMode: true });
		const fragments = new Map<string, Element>();
		const statements: { tag: string; el: Element }[] = [];
		const walkXml = (nodes: ChildNode[]) => {
			for (const n of nodes) {
				if (!isTag(n)) { continue; }
				const name = n.name.toLowerCase();
				if (name === 'sql' && n.attribs.id) {
					fragments.set(n.attribs.id.trim(), n);
				} else if (name in STATEMENT_CRUD) {
					statements.push({ tag: name, el: n });
				} else {
					walkXml(n.children);
				}
			}
		};
		walkXml(doc.children);

		for (const { tag, el } of statements) {
			const rawSql = el.children.map(c => flattenMyBatisNode(c, fragments, 0)).join('');
			const sql = sanitizeSql(rawSql);
			if (!sql) { continue; }
			const crud = STATEMENT_CRUD[tag];
			const res = await parseSql(sql);
			if (res) {
				ingestParsed(res, crud);
				parsed++;
				continue;
			}
			const merge = extractMerge(sql);
			if (merge) {
				const t = ensureTable(merge.target);
				merge.ops.forEach(op => t.crud.add(op));
				if (merge.usingTable) { ensureTable(merge.usingTable).crud.add('R'); }
				if (merge.usingSql) {
					const sub = await parseSql(merge.usingSql);
					if (sub) { ingestParsed(sub, 'R'); }
				}
				parsed++;
				continue;
			}
			failed++;
		}
	}

	const tables: ExtractedTable[] = [...tableMap.values()].map(t => ({
		name: t.name,
		crud: CRUD.map(([k]) => k).filter(k => t.crud.has(k)),
		columns: [...t.columns.values()],
	}));
	return { tables, joins: [...joinMap.values()], parsed, failed };
}

/**
 * 추출한 테이블·CRUD·컬럼·조인을 기존 ERD(UsedTables)에 병합한다.
 * 이미 있는 테이블(대소문자 무시)은 자리·설명·기존 컬럼을 유지하고 CRUD와 빠진 컬럼만 추가하며,
 * 새 테이블은 기존 그림과 겹치지 않는 오른쪽 빈자리에 배치한다
 */
export function applyMapperTables(
	current: UsedTables,
	extracted: MapperExtractResult,
	makeId: () => string = () => crypto.randomUUID(),
): { data: UsedTables; added: number; updated: number; linksAdded: number; ids: string[] } {
	if (!extracted.tables.length) {
		return { data: current, added: 0, updated: 0, linksAdded: 0, ids: [] };
	}
	const existingByName = new Map(current.tables.map(t => [t.name.trim().toLowerCase(), t]));
	const updatedTables = new Map<string, UsedTable>();
	const newTables: UsedTable[] = [];
	const idByName = new Map<string, string>();
	const ids: string[] = [];
	let updated = 0;

	for (const item of extracted.tables) {
		const key = item.name.trim().toLowerCase();
		const prev = existingByName.get(key);
		if (prev) {
			idByName.set(key, prev.id);
			const nextCrud = CRUD.map(([k]) => k).filter(k => prev.crud.includes(k) || item.crud.includes(k));
			const existingCols = new Set(prev.columns.map(c => c.name.trim().toLowerCase()));
			const extraCols: UsedColumn[] = item.columns
				.filter(col => !existingCols.has(col.toLowerCase()))
				.map(name => ({ id: makeId(), name, desc: '', type: '', pk: false }));
			const crudChanged = nextCrud.length !== prev.crud.length || nextCrud.some((k, i) => k !== prev.crud[i]);
			if (crudChanged || extraCols.length) {
				updatedTables.set(prev.id, { ...prev, crud: nextCrud, columns: [...prev.columns, ...extraCols] });
				updated++;
				ids.push(prev.id);
			}
		} else {
			const id = makeId();
			idByName.set(key, id);
			ids.push(id);
			newTables.push({
				id,
				name: item.name,
				desc: '',
				crud: item.crud,
				columns: item.columns.map(name => ({ id: makeId(), name, desc: '', type: '', pk: false })),
				keysOnly: false,
				color: '',
				x: 0,
				y: 0,
			});
		}
	}

	const pairKey = (a: string, b: string) => a < b ? `${a}\0${b}` : `${b}\0${a}`;
	const existingPairs = new Set(current.links.map(l => pairKey(l.from, l.to)));
	const newLinks: TableLink[] = [];
	for (const j of extracted.joins) {
		const from = idByName.get(j.from.toLowerCase());
		const to = idByName.get(j.to.toLowerCase());
		if (!from || !to || from === to) { continue; }
		const pk = pairKey(from, to);
		if (existingPairs.has(pk)) { continue; }
		existingPairs.add(pk);
		newLinks.push({ from, to, arrow: 'none', label: j.label });
	}

	const placedNew = placeNewTables(current, newTables, newLinks);
	const tables = [...current.tables.map(t => updatedTables.get(t.id) ?? t), ...placedNew];
	const links = [...current.links, ...newLinks];

	return {
		data: newTables.length || updated || newLinks.length ? { ...current, tables, links } : current,
		added: newTables.length,
		updated,
		linksAdded: newLinks.length,
		ids,
	};
}
