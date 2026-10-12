// ERD 박스와 입력칸: 렌더링·칸 이동·박스별 편집. 화면 전체 선택·끌기·클립보드는 usedTablesDiagram이 맡는다.
import { createContext, useContext, useEffect, useRef, useState, type RefObject, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type SetStateAction } from 'react';
import { Handle, NodeResizer, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { clsx } from 'clsx';
import { CRUD, SHAPES, type NoteColor, type ShapeKind, type UsedColumn, type UsedGroup, type UsedMemo, type UsedShape, type UsedTable, type UsedTables } from '../../core/tables';
import { ComboInput } from './combo';
import type { Edit } from './usedTablesPane';

export type TableNode = Node<{ table: UsedTable; dim?: boolean }, 'table'>;
export type MemoNode = Node<{ memo: UsedMemo; dim?: boolean }, 'memo'>;
export type GroupNode = Node<{ group: UsedGroup }, 'group-frame'>;
export type ShapeNode = Node<{ shape: UsedShape; dim?: boolean }, 'shape'>;
export type FlowNode = TableNode | MemoNode | GroupNode | ShapeNode;
export type MenuItem = { label: string; run(): void; kbd?: string; checked?: boolean; disabled?: boolean; swatch?: NoteColor } | 'separator';

/** 박스 네 면의 연결점 */
const SIDES = [['t', Position.Top], ['r', Position.Right], ['b', Position.Bottom], ['l', Position.Left]] as const;
const newId = () => crypto.randomUUID();
/** 그림 박스에 보이는 컬럼: PK 먼저. PK만 보기면 PK만(PK가 없으면 다) */
const shownColumns = (t: UsedTable) => [...t.columns.filter(c => c.pk), ...t.keysOnly && t.columns.some(c => c.pk) ? [] : t.columns.filter(c => !c.pk)];
/** PK와 일반 컬럼이 다 있음(그때만 PK만 보기 ↔ 전체) */
export const mixedKeys = (t: UsedTable) => t.columns.some(c => c.pk) && t.columns.some(c => !c.pk);
/** NodeResizer가 끝낸 크기·자리 → 저장값 */
const boxOf = (p: { x: number; y: number; width: number; height: number }) => ({ x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) });

/** 노드·선 안의 편집칸이 함께 쓰는 것: 지금 편집 중인 칸(key), 데이터 고치기, 우클릭 메뉴 열기 */
export const DiagramContext = createContext<{ editing?: string; setEditing: Dispatch<SetStateAction<string | undefined>>; edit: Edit; openMenu(e: ReactMouseEvent, items: MenuItem[]): void }>(null!);
export const useDiagram = () => useContext(DiagramContext);

/** el이 든 박스가 골라져 있고, 골라진 박스가 그것 하나뿐 */
function onlySelected(el: Element) {
	const node = el.closest('.react-flow__node');
	return !!node?.classList.contains('selected') && node.parentElement?.querySelectorAll(':scope > .react-flow__node.selected').length === 1;
}

/**
 * 그림 안 글자 칸: 평소엔 글자. 더블클릭, 또는 이미 (혼자) 골라 둔 박스의 글자를 한 번 클릭하면 입력칸(VS Code 탐색기 이름 바꾸기처럼: 첫 클릭은 고르기만).
 * 누른 채 끌면 박스를 옮기고 입력칸은 안 열린다(끈 뒤의 click은 React Flow(d3-drag)가 막는다).
 * Enter·바깥 클릭은 반영하고 빠져나옴, Esc는 취소, Tab·Shift+Tab은 반영하고 같은 박스의 다음·이전 칸으로.
 * fields: 이 박스의 칸 순서(Tab 이동), onTabEnd: 마지막 칸에서 Tab(예: 컬럼 하나 더)
 */
export function Field({ k, value, placeholder, className, fields, onCommit, onTabEnd, label, options }: {
	k: string; value: string; placeholder: string; className?: string; fields?: string[]; onCommit(value: string): void; onTabEnd?(): void; label: string;
	/** 있으면 입력 + 고를 값 목록 */
	options?: string[];
}) {
	const { editing, setEditing } = useDiagram();
	// 누를 때 이미 이 박스만 골라져 있었는지(누르는 순간 기준: 클릭으로 막 고른 경우는 제외)
	const armed = useRef(false);
	if (editing !== k) {
		// 공백뿐인 값은 폭이 0이 되어 다시 더블클릭할 수 없으니 빈 값처럼 자리 표시 글자
		const shown = value.trim() ? value : '';
		return <span className={clsx('field', className, !shown && 'placeholder')} data-field={k}
			onPointerDown={e => { armed.current = e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && onlySelected(e.currentTarget); }}
			onClick={() => { if (armed.current) { armed.current = false; setEditing(k); } }}
			onDoubleClick={e => { e.stopPropagation(); setEditing(k); }}>{shown || placeholder}</span>;
	}
	return <FieldInput k={k} value={value} className={className} fields={fields} onCommit={onCommit} onTabEnd={onTabEnd} label={label} placeholder={placeholder} options={options} />;
}

/**
 * 편집칸이 열리면 포커스. 막 추가한 박스는 React Flow가 크기를 재기 전까지 숨겨 둬서(visibility) 포커스가 안 간다 → 들어갈 때까지 몇 프레임 다시.
 * done: 이미 닫혔으면 그만, onFocus: 들어간 뒤(전체 선택·끝으로 등)
 */
function useAutoFocus<T extends HTMLElement>(ref: RefObject<T | null>, done: RefObject<boolean>, onFocus: (el: T) => void) {
	useEffect(() => {
		let tries = 0, frame = 0;
		const focus = () => {
			const el = ref.current;
			if (!el || done.current) { return; }
			el.focus();
			if (document.activeElement === el) { onFocus(el); } else if (tries++ < 20) { frame = requestAnimationFrame(focus); }
		};
		focus();
		return () => cancelAnimationFrame(frame);
	}, []); // 열릴 때 한 번
}

/** 넓은 글자(한글 자모·CJK·한글 음절·전각) 범위 */
const WIDE = [[0x1100, 0x11ff], [0x3000, 0x9fff], [0xac00, 0xd7af], [0xff00, 0xffef]];
/** 글자 폭: 한글 등 넓은 글자는 2칸 */
const widthOf = (s: string) => [...s].reduce((n, ch) => { const c = ch.codePointAt(0)!; return n + (WIDE.some(([a, b]) => c >= a && c <= b) ? 2 : 1); }, 0);

function FieldInput({ k, value, className, fields = [], onCommit, onTabEnd, label, placeholder, options }: {
	k: string; value: string; className?: string; fields?: string[]; onCommit(value: string): void; onTabEnd?(): void; label: string; placeholder: string; options?: string[];
}) {
	const { setEditing } = useDiagram();
	const input = useRef<HTMLInputElement>(null);
	const done = useRef(false);
	const [text, setText] = useState(value);
	const [width, setWidth] = useState(Math.max(widthOf(value), widthOf(placeholder), 4));
	useAutoFocus(input, done, el => el.select());
	const finish = (save: boolean, move?: 1 | -1) => {
		if (done.current) { return; }
		done.current = true;
		const next = input.current?.value ?? value;
		if (save && next !== value) { onCommit(next); }
		const target = move && fields[fields.indexOf(k) + move];
		if (target) { setEditing(target); } else if (move === 1 && onTabEnd) { onTabEnd(); } else { setEditing(cur => cur === k ? undefined : cur); }
	};
	/** 입력칸 폭을 글자에 맞춤 */
	const fit = (v: string) => setWidth(Math.max(widthOf(v), widthOf(placeholder), 4));
	// 목록에서 골라도(↑↓ Enter·클릭) 입력칸에 머문다: 이어서 Tab으로 다음 칸, Enter·바깥 클릭으로 반영(직접 입력과 같게)
	const pick = (v: string) => { setText(v); fit(v); };
	const props = {
		className: clsx('field-input nodrag nopan', className), placeholder, 'aria-label': label, spellCheck: false, style: { width: `calc(${width + 1}ch + 8px)` },
		onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
			if (e.nativeEvent.isComposing) { return; }
			if (e.key === 'Enter') { e.preventDefault(); finish(true); }
			else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
			else if (e.key === 'Tab') { e.preventDefault(); finish(true, e.shiftKey ? -1 : 1); }
		},
		onBlur: () => finish(true),
	};
	return options
		? <ComboInput {...props} inputRef={input} portal value={text} options={options} onValue={pick} onPick={pick} />
		: <input ref={input} {...props} defaultValue={value} onChange={e => fit(e.target.value)} />;
}

/** 전체 보기(처음 그릴 때·버튼·우클릭): 100%보다 크게 키우지 않음 */
export const fieldKey = (id: string, field: string) => `${id}:${field}`;
/** 컬럼 타입 칸에서 고를 값(PostgreSQL 자주 쓰는 것). 목록에 없는 것도 그대로 입력 가능 */
const PG_TYPES = ['VARCHAR(20)', 'VARCHAR(50)', 'VARCHAR(100)', 'VARCHAR(255)', 'CHAR(1)', 'TEXT', 'SMALLINT', 'INTEGER', 'BIGINT', 'NUMERIC', 'NUMERIC(10,2)',
	'SERIAL', 'BIGSERIAL', 'BOOLEAN', 'DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ', 'UUID', 'JSONB', 'BYTEA'];
/** 테이블 박스의 Tab 순서: 이름 → 설명 → 보이는 컬럼마다 이름·설명·타입 */
const tableFields = (t: UsedTable) => [fieldKey(t.id, 'name'), fieldKey(t.id, 'desc'), ...shownColumns(t).flatMap(c => ['name', 'desc', 'type'].map(f => fieldKey(t.id, `${c.id}.${f}`)))];

type Items = Pick<UsedTables, 'tables' | 'memos' | 'groups' | 'shapes'>;
/** data의 테이블·메모·그룹 하나 고치기 */
export const editItem = <K extends keyof Items>(edit: Edit, key: K, id: string, fn: (item: Items[K][number]) => Items[K][number]) =>
	edit(d => ({ ...d, [key]: (d[key] as Items[K][number][]).map(x => x.id === id ? fn(x) : x) }));
export const editTable = (edit: Edit, id: string, fn: (t: UsedTable) => UsedTable) => editItem(edit, 'tables', id, fn);
/** 컬럼 추가(after 뒤, 없으면 끝). PK만 보기면 풀어서 보이게. 새 컬럼 이름 칸 key를 돌려준다 */
export function insertColumn(edit: Edit, id: string, after?: string) {
	const c: UsedColumn = { id: newId(), name: '', desc: '', type: '', pk: false };
	editTable(edit, id, x => { const at = after ? x.columns.findIndex(o => o.id === after) + 1 : x.columns.length; return { ...x, keysOnly: false, columns: [...x.columns.slice(0, at), c, ...x.columns.slice(at)] }; });
	return fieldKey(id, `${c.id}.name`);
}

function TableBox({ id, data, selected }: NodeProps<TableNode>) {
	const { edit, editing, setEditing, openMenu } = useDiagram();
	const t = data.table, columns = shownColumns(t), hidden = t.columns.length - columns.length, fields = tableFields(t);
	const set = (patch: Partial<UsedTable>) => editTable(edit, id, x => ({ ...x, ...patch }));
	const setColumn = (cid: string, patch: Partial<UsedColumn>) => editTable(edit, id, x => ({ ...x, columns: x.columns.map(c => c.id === cid ? { ...c, ...patch } : c) }));
	/** 컬럼 추가: 바로 이름 입력 */
	const addColumn = (after?: string) => setEditing(insertColumn(edit, id, after));
	const moveColumn = (cid: string, by: -1 | 1) => editTable(edit, id, x => {
		const list = [...x.columns], i = list.findIndex(c => c.id === cid), j = i + by;
		if (i < 0 || j < 0 || j >= list.length) { return x; }
		[list[i], list[j]] = [list[j], list[i]];
		return { ...x, columns: list };
	});
	const removeColumn = (cid: string) => editTable(edit, id, x => ({ ...x, columns: x.columns.filter(c => c.id !== cid) }));
	const toggleCrud = (k: typeof CRUD[number][0]) => set({ crud: CRUD.map(([c]) => c).filter(c => c === k ? !t.crud.includes(k) : t.crud.includes(c)) });
	const columnMenu = (e: ReactMouseEvent, c: UsedColumn, i: number) => {
		e.stopPropagation();
		openMenu(e, [
			{ label: '아래에 컬럼 추가', run: () => addColumn(c.id) },
			{ label: c.pk ? 'PK 해제' : 'PK로', run: () => setColumn(c.id, { pk: !c.pk }) },
			'separator',
			{ label: '위로', run: () => moveColumn(c.id, -1), disabled: t.columns[0]?.id === c.id },
			{ label: '아래로', run: () => moveColumn(c.id, 1), disabled: t.columns.at(-1)?.id === c.id },
			'separator',
			{ label: `컬럼 삭제${c.name ? ` (${c.name})` : ` ${i + 1}`}`, run: () => removeColumn(c.id) },
		]);
	};
	const name = t.name || '테이블', mixed = mixedKeys(t);
	return <div className={clsx('used-table-node', t.color && `colored note-${t.color}`, { selected, dim: data.dim })}>
		{SIDES.map(([side, position]) => <Handle key={side} type="source" position={position} id={side} />)}
		<div className="head">
			<Field k={fieldKey(id, 'name')} value={t.name} placeholder="TABLE_NAME" className="name" fields={fields} onCommit={v => set({ name: v })} label={`${name} 테이블 이름`} />
			{(t.desc || selected || editing === fieldKey(id, 'desc')) && <Field k={fieldKey(id, 'desc')} value={t.desc} placeholder="설명" className="desc" fields={fields} onCommit={v => set({ desc: v })} label={`${name} 설명`} />}
			{(selected || t.crud.length > 0) && <div className="crud">{CRUD.filter(([k]) => selected || t.crud.includes(k)).map(([k, label]) => selected
				? <button key={k} type="button" className={`nodrag crud-${k}`} aria-pressed={t.crud.includes(k)} aria-label={`${name} ${label}`} onClick={() => toggleCrud(k)}>{label}</button>
				: <span key={k} className={`crud-${k}`}>{label}</span>)}</div>}
		</div>
		{columns.length > 0 && <ul className="columns">
			{columns.map((c, i) => <li key={c.id} className={clsx({ pk: c.pk, last: c.pk && columns[i + 1] && !columns[i + 1].pk })} onContextMenu={e => columnMenu(e, c, i)}>
				<button type="button" className="key nodrag" title={c.pk ? 'PK 해제' : 'PK로'} aria-label={`${c.name || `${i + 1}번`} 컬럼 PK`} aria-pressed={c.pk} onClick={() => setColumn(c.id, { pk: !c.pk })}>PK</button>
				<Field k={fieldKey(id, `${c.id}.name`)} value={c.name} placeholder="column" className="col-name" fields={fields} onCommit={v => setColumn(c.id, { name: v })} label={`${i + 1}번 컬럼`} />
				<Field k={fieldKey(id, `${c.id}.desc`)} value={c.desc} placeholder="설명" className="col-desc" fields={fields} onCommit={v => setColumn(c.id, { desc: v })} label={`${i + 1}번 컬럼 설명`} />
				<Field k={fieldKey(id, `${c.id}.type`)} value={c.type} placeholder="TYPE" className="col-type" fields={fields} onCommit={v => setColumn(c.id, { type: v })} label={`${i + 1}번 컬럼 타입`} options={PG_TYPES}
					onTabEnd={i === columns.length - 1 ? () => addColumn() : undefined} />
				<button type="button" className="col-remove nodrag codicon codicon-close" title="컬럼 삭제" aria-label={`${i + 1}번 컬럼 삭제`} onClick={() => removeColumn(c.id)} />
			</li>)}
		</ul>}
		{(selected || mixed) && <div className="foot">
			{selected && <button type="button" className="nodrag add-column" onClick={() => addColumn()}><span className="codicon codicon-add" />컬럼 추가</button>}
			{/* PK와 일반 컬럼이 다 있을 때만: PK만 보기 ↔ 전체 */}
			{mixed && <button type="button" className="nodrag columns-toggle" onClick={() => set({ keysOnly: !t.keysOnly })}>
				{t.keysOnly ? `컬럼 ${hidden}개 더 보기` : 'PK만 보기'}</button>}
		</div>}
	</div>;
}

/** 메모지: 더블클릭하면 여러 줄 입력(Enter는 줄바꿈, Esc·Ctrl+Enter·바깥 클릭으로 반영). 끝 손잡이로 크기 */
function MemoBox({ id, data, selected }: NodeProps<MemoNode>) {
	const { edit, editing, setEditing } = useDiagram();
	const m = data.memo, k = fieldKey(id, 'text');
	const set = (patch: Partial<UsedMemo>) => editItem(edit, 'memos', id, x => ({ ...x, ...patch }));
	return <>
		<NodeResizer isVisible={selected} minWidth={100} minHeight={48} onResizeEnd={(_, p) => set(boxOf(p))} />
		{SIDES.map(([side, position]) => <Handle key={side} type="source" position={position} id={side} />)}
		<div className={clsx('used-memo', `note-${m.color}`, { selected, dim: data.dim })} onDoubleClick={() => setEditing(k)}>
			{editing === k ? <MemoInput k={k} value={m.text} onCommit={text => set({ text })} />
				: <div className={clsx('memo-text', !m.text && 'placeholder')}>{m.text || '더블클릭해 메모 입력'}</div>}
		</div>
	</>;
}

function MemoInput({ k, value, onCommit, label = '메모' }: { k: string; value: string; onCommit(value: string): void; label?: string }) {
	const { setEditing } = useDiagram();
	const area = useRef<HTMLTextAreaElement>(null);
	const done = useRef(false);
	useAutoFocus(area, done, a => a.setSelectionRange(a.value.length, a.value.length));
	const finish = () => {
		if (done.current) { return; }
		done.current = true;
		const next = area.current?.value ?? value;
		if (next !== value) { onCommit(next); }
		setEditing(cur => cur === k ? undefined : cur);
	};
	return <textarea ref={area} className="memo-input nodrag nopan nowheel" defaultValue={value} aria-label={label} spellCheck={false}
		onKeyDown={e => { if (!e.nativeEvent.isComposing && (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey)))) { e.preventDefault(); e.stopPropagation(); finish(); } }}
		onBlur={finish} />;
}

/** 그룹 틀: 왼쪽 위(제목과 그 둘레)를 잡고 끌면 안에 든 것도 같이 움직인다. 틀 안 빈 곳은 그림 바닥처럼(끌어서 고르기·선 클릭) */
function GroupBox({ id, data, selected }: NodeProps<GroupNode>) {
	const { edit } = useDiagram();
	const g = data.group;
	const set = (patch: Partial<UsedGroup>) => editItem(edit, 'groups', id, x => ({ ...x, ...patch }));
	return <>
		<NodeResizer isVisible={selected} minWidth={160} minHeight={96} onResizeEnd={(_, p) => set(boxOf(p))} />
		<div className={clsx('used-group', `note-${g.color}`, { selected })}>
			<div className="group-handle"><div className="group-title"><span className="codicon codicon-layers" />
				<Field k={fieldKey(id, 'title')} value={g.title} placeholder="그룹 이름" onCommit={title => set({ title })} label="그룹 이름" />
			</div></div>
		</div>
	</>;
}
/** 도형 SVG(100×100 칸을 박스 크기로 늘림, 선 굵기는 그대로). 도구 줄 아이콘도 이것 */
const SHAPE_SVG: Record<ShapeKind, ReactNode> = {
	rect: <rect x="0" y="0" width="100" height="100" rx="2" />,
	ellipse: <ellipse cx="50" cy="50" rx="50" ry="50" />,
	triangle: <polygon points="50,0 100,100 0,100" />,
	diamond: <polygon points="50,0 100,50 50,100 0,50" />,
	trapezoid: <polygon points="20,0 80,0 100,100 0,100" />,
};
/** 연결점: 도형 둘레의 위·오른쪽·아래·왼쪽 점(박스 비율, 선이 도형에 붙게). 기울어진 변은 그 변 가운데 */
const SHAPE_POINTS: Record<ShapeKind, [number, number][]> = {
	rect: [[.5, 0], [1, .5], [.5, 1], [0, .5]], ellipse: [[.5, 0], [1, .5], [.5, 1], [0, .5]], diamond: [[.5, 0], [1, .5], [.5, 1], [0, .5]],
	triangle: [[.5, 0], [.75, .5], [.5, 1], [.25, .5]], trapezoid: [[.5, 0], [.9, .5], [.5, 1], [.1, .5]],
};
export const shapeIcon = (kind: ShapeKind) => <svg className="shape-icon" viewBox="-6 -6 112 112" aria-hidden="true">{SHAPE_SVG[kind]}</svg>;

/** 도형: 끝 손잡이로 크기, 더블클릭으로 가운데 글자. 연결점은 도형 둘레 위 */
function ShapeBox({ id, data, selected }: NodeProps<ShapeNode>) {
	const { edit, editing, setEditing } = useDiagram();
	const s = data.shape, k = fieldKey(id, 'text');
	const set = (patch: Partial<UsedShape>) => editItem(edit, 'shapes', id, x => ({ ...x, ...patch }));
	// 모양이 바뀌면 연결점 자리가 바뀌니 React Flow가 다시 재야 선이 따라온다(크기는 % 자리라 그대로)
	const updateInternals = useUpdateNodeInternals();
	useEffect(() => updateInternals(id), [s.kind]);
	return <>
		<NodeResizer isVisible={selected} minWidth={8} minHeight={8} onResizeEnd={(_, p) => set(boxOf(p))} />
		<div className={clsx('used-shape', `note-${s.color}`, { selected, dim: data.dim })} onDoubleClick={() => setEditing(k)}>
			<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={SHAPES.find(([kind]) => kind === s.kind)?.[1]}>{SHAPE_SVG[s.kind]}</svg>
			{editing === k ? <div className="shape-text"><MemoInput k={k} value={s.text} onCommit={text => set({ text })} label="도형 글자" /></div>
				: s.text && <div className="shape-text">{s.text}</div>}
		</div>
		{/* 연결점은 도형 그림 위에(뒤에 그려야 안 가려진다) */}
		{SIDES.map(([side, position], i) => { const [fx, fy] = SHAPE_POINTS[s.kind][i]; return <Handle key={side} type="source" position={position} id={side}
			style={{ left: `${fx * 100}%`, top: `${fy * 100}%`, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' }} />; })}
	</>;
}
export const NODE_TYPES = { table: TableBox, memo: MemoBox, 'group-frame': GroupBox, shape: ShapeBox };
