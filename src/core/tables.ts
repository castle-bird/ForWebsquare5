// ERD: 사용 테이블(화면이 쓰는 DB 테이블을 직접 적고 선으로 잇는 메모). 화면 XML이 아니라 이 PC에 고른 폴더의 화면별 JSON에 둔다

/** 등록·조회·수정·삭제(CRUD 매트릭스 순서) */
export const CRUD = [['C', '등록'], ['R', '조회'], ['U', '수정'], ['D', '삭제']] as const;
type CrudKey =typeof CRUD[number][0];
/** 테이블·메모·그룹·도형 색(이름만 저장하고 실제 색은 VS Code 테마 색) */
export const NOTE_COLORS = [['yellow', '노랑'], ['orange', '주황'], ['red', '빨강'], ['pink', '분홍'], ['purple', '보라'], ['blue', '파랑'], ['cyan', '청록'],
	['green', '초록'], ['gray', '회색']] as const;
export type NoteColor = typeof NOTE_COLORS[number][0];
/** 테이블 색: ''면 테마 기본 */
export type TableColor = NoteColor | '';
/** 선 끝 화살표: 없음·to 쪽·from 쪽·양쪽 */
export const ARROWS = ['none', 'end', 'start', 'both'] as const;
export type Arrow = typeof ARROWS[number];
/** 도형 모양 */
export const SHAPES = [['rect', '네모'], ['ellipse', '동그라미'], ['triangle', '삼각형'], ['diamond', '다이아몬드'], ['trapezoid', '사다리꼴']] as const;
export type ShapeKind = typeof SHAPES[number][0];

export interface UsedColumn { id: string; name: string; desc: string; type: string; pk: boolean }
/** x·y: 그림에서의 자리. keysOnly: 그림 박스에 PK 컬럼만 */
export interface UsedTable { id: string; name: string; desc: string; crud: CrudKey[]; columns: UsedColumn[]; keysOnly: boolean; color: TableColor; x: number; y: number }
/** 그림 위 메모지(w·h: 크기) */
export interface UsedMemo { id: string; text: string; color: NoteColor; x: number; y: number; w: number; h: number }
/** 기능별 묶음 틀. 안에 든 것(자리 기준)을 같이 옮길 뿐 소속은 저장하지 않는다 */
export interface UsedGroup { id: string; title: string; color: NoteColor; x: number; y: number; w: number; h: number }
/** 그림 위 도형(text: 가운데 글자, w·h: 크기) */
export interface UsedShape { id: string; kind: ShapeKind; text: string; color: NoteColor; x: number; y: number; w: number; h: number }
/** 테이블·메모·도형끼리 잇는 선. label: 선 가운데 글자 */
export interface TableLink { from: string; to: string; arrow: Arrow; label: string }
export interface UsedTables { tables: UsedTable[]; links: TableLink[]; memos: UsedMemo[]; groups: UsedGroup[]; shapes: UsedShape[] }

export const emptyTables = (): UsedTables => ({ tables: [], links: [], memos: [], groups: [], shapes: [] });
export const MEMO_SIZE = { w: 220, h: 140 };
export const GROUP_SIZE = { w: 480, h: 320 };
export const SHAPE_SIZE = { w: 128, h: 128 };

/**
 * 같은 id가 또 나오면(사람이 JSON 블록을 복사) 버리지 않고 `id-2`처럼 새 id를 붙인다. 처음 것이 원래 id를 갖는다(선도 그것에 잇는다).
 * taken: 파일에 적힌 모든 id(새 id가 뒤에 나올 원래 id와 겹치지 않게)
 */
function uniqueIds<T extends { id: string }>(items: T[], seen = new Set<string>(), taken = new Set(items.map(item => item.id))): T[] {
	return items.map(item => {
		if (!seen.has(item.id)) {
			seen.add(item.id);
			return item;
		}
		let n = 2;
		while (taken.has(`${item.id}-${n}`)) { n++; }
		const id = `${item.id}-${n}`;
		taken.add(id);
		seen.add(id);
		return { ...item, id };
	});
}

/** 파일에서 읽은 값(사람이 고쳤을 수도 있음)을 모양에 맞춘다. 모르는 값은 버리고, 없는 테이블·메모·도형을 잇는 선·같은 두 끝의 겹친 선도 버린다. 겹친 id는 새 id로 살린다 */
export function readUsedTables(value: unknown): UsedTables {
	const v = value as Partial<UsedTables> | null;
	const str = (s: unknown) => typeof s === 'string' ? s : '';
	const num = (n: unknown, fallback = 0) => typeof n === 'number' && Number.isFinite(n) ? n : fallback;
	const size = (n: unknown, fallback: number) => Math.max(40, num(n, fallback));
	const color = (c: unknown, fallback: NoteColor = 'yellow'): NoteColor => NOTE_COLORS.find(([k]) => k === c)?.[0] ?? fallback;
	const list = <T>(a: unknown) => (Array.isArray(a) ? a : []) as Partial<T>[];
	// 노드 id는 종류와 상관없이 하나씩(그림에서 같은 id면 서로 섞인다)
	const ids = new Set<string>(), taken = new Set([v?.tables, v?.memos, v?.groups, v?.shapes].flatMap(a => list<{ id: string }>(a).map(n => str(n?.id))));
	const tables = uniqueIds(list<UsedTable>(v?.tables).flatMap(t => t && str(t.id) ? [{
		id: str(t.id), name: str(t.name), desc: str(t.desc),
		crud: CRUD.map(([k]) => k).filter(k => Array.isArray(t.crud) && t.crud.includes(k)),
		columns: uniqueIds(list<UsedColumn>(t.columns).flatMap(c => c && str(c.id) ? [{ id: str(c.id), name: str(c.name), desc: str(c.desc), type: str(c.type), pk: c.pk === true }] : [])),
		keysOnly: t.keysOnly === true, color: NOTE_COLORS.find(([k]) => k === t.color)?.[0] ?? '' as TableColor, x: num(t.x), y: num(t.y),
	}] : []), ids, taken);
	const memos = uniqueIds(list<UsedMemo>(v?.memos).flatMap(m => m && str(m.id) ? [{
		id: str(m.id), text: str(m.text), color: color(m.color), x: num(m.x), y: num(m.y), w: size(m.w, MEMO_SIZE.w), h: size(m.h, MEMO_SIZE.h),
	}] : []), ids, taken);
	const groups = uniqueIds(list<UsedGroup>(v?.groups).flatMap(g => g && str(g.id) ? [{
		id: str(g.id), title: str(g.title), color: color(g.color), x: num(g.x), y: num(g.y), w: size(g.w, GROUP_SIZE.w), h: size(g.h, GROUP_SIZE.h),
	}] : []), ids, taken);
	// 도형은 작게도(선·점 대신) 쓰니 최소 크기를 낮게. 모양을 모르면 버린다
	const shapes = uniqueIds(list<UsedShape>(v?.shapes).flatMap(s => {
		const kind = SHAPES.find(([k]) => k === s?.kind)?.[0];
		return s && str(s.id) && kind ? [{
			id: str(s.id), kind, text: str(s.text), color: color(s.color, 'blue'), x: num(s.x), y: num(s.y), w: Math.max(8, num(s.w, SHAPE_SIZE.w)), h: Math.max(8, num(s.h, SHAPE_SIZE.h)),
		}] : [];
	}), ids, taken);
	const ends = new Set([...tables, ...memos, ...shapes].map(n => n.id)), seen = new Set<string>();
	const links = list<TableLink>(v?.links).flatMap(l => {
		const from = str(l?.from), to = str(l?.to), pair = JSON.stringify([from, to].sort());
		if (!ends.has(from) || !ends.has(to) || from === to || seen.has(pair)) { return []; }
		seen.add(pair);
		// 화살표 없던 옛 파일은 없음 그대로
		return [{ from, to, arrow: ARROWS.find(a => a === l?.arrow) ?? 'none', label: str(l?.label) }];
	});
	return { tables, links, memos, groups, shapes };
}
