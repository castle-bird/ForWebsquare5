// Beta: 사용 테이블(화면이 쓰는 DB 테이블을 직접 적고 선으로 잇는 메모). 화면 XML이 아니라 이 PC에 고른 폴더의 화면별 JSON에 둔다

/** 등록·조회·수정·삭제(CRUD 매트릭스 순서) */
export const CRUD = [['C', '등록'], ['R', '조회'], ['U', '수정'], ['D', '삭제']] as const;
export type CrudKey = typeof CRUD[number][0];

export interface UsedColumn { id: string; name: string; desc: string; type: string; pk: boolean }
/** x·y: 그림에서의 자리. keysOnly: 그림 박스에 PK 컬럼만 */
export interface UsedTable { id: string; name: string; desc: string; crud: CrudKey[]; columns: UsedColumn[]; keysOnly: boolean; x: number; y: number }
export interface TableLink { from: string; to: string }
export interface UsedTables { tables: UsedTable[]; links: TableLink[] }

export const emptyTables = (): UsedTables => ({ tables: [], links: [] });

/** 파일에서 읽은 값(사람이 고쳤을 수도 있음)을 모양에 맞춘다. 모르는 값은 버리고, 없는 테이블을 잇는 선·같은 두 테이블의 겹친 선도 버린다 */
export function readUsedTables(value: unknown): UsedTables {
	const v = value as Partial<UsedTables> | null;
	const str = (s: unknown) => typeof s === 'string' ? s : '';
	const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? n : 0;
	const list = <T>(a: unknown) => (Array.isArray(a) ? a : []) as Partial<T>[];
	const tables = list<UsedTable>(v?.tables).flatMap(t => t && str(t.id) ? [{
		id: str(t.id), name: str(t.name), desc: str(t.desc),
		crud: CRUD.map(([k]) => k).filter(k => Array.isArray(t.crud) && t.crud.includes(k)),
		columns: list<UsedColumn>(t.columns).flatMap(c => c && str(c.id) ? [{ id: str(c.id), name: str(c.name), desc: str(c.desc), type: str(c.type), pk: c.pk === true }] : []),
		keysOnly: t.keysOnly === true, x: num(t.x), y: num(t.y),
	}] : []);
	const ids = new Set(tables.map(t => t.id)), seen = new Set<string>();
	const links = list<TableLink>(v?.links).flatMap(l => {
		const from = str(l?.from), to = str(l?.to), pair = [from, to].sort().join('|');
		if (!ids.has(from) || !ids.has(to) || from === to || seen.has(pair)) { return []; }
		seen.add(pair);
		return [{ from, to }];
	});
	return { tables, links };
}
