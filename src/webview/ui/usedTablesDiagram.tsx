// ERD 사용 테이블의 그림(React Flow): 테이블(머리 + 컬럼 줄)·메모·그룹 틀을 그림 안에서 바로 만들고 고친다(ERD Cloud·Excalidraw처럼).
// 내용·자리·선은 data(저장 대상)가 기준이고, 선택·잰 크기·끄는 중 자리 같은 그림 상태만 React Flow 것을 둔다
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type RefObject, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type SetStateAction } from 'react';
import { applyEdgeChanges, applyNodeChanges, Background, BackgroundVariant, BaseEdge, ConnectionLineType, ConnectionMode, ControlButton, Controls, EdgeLabelRenderer, getSmoothStepPath, Handle, MarkerType, MiniMap,
	NodeResizer, Panel, Position, ReactFlow, ReactFlowProvider, useInternalNode, useReactFlow, useStore,
	type Connection, type Edge, type EdgeChange, type EdgeProps, type InternalNode, type Node, type NodeChange, type NodeProps, type XYPosition } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { clsx } from 'clsx';
import { ARROWS, CRUD, GROUP_SIZE, MEMO_SIZE, NOTE_COLORS, type Arrow, type NoteColor, type TableLink, type UsedColumn, type UsedGroup, type UsedMemo, type UsedTable, type UsedTables } from '../../core/tables';
import { isModKey } from '../keys';
import { ComboInput } from './combo';
import { Menu } from './menu';
import type { Edit } from './usedTablesPane';

type TableNode = Node<{ table: UsedTable; dim?: boolean }, 'table'>;
type MemoNode = Node<{ memo: UsedMemo; dim?: boolean }, 'memo'>;
type GroupNode = Node<{ group: UsedGroup }, 'group-frame'>;
type FlowNode = TableNode | MemoNode | GroupNode;
type LinkEdge = Edge<{ link: TableLink }, 'link'>;
type MenuItem = { label: string; run(): void; kbd?: string; checked?: boolean; disabled?: boolean; swatch?: NoteColor } | 'separator';

/** 박스 끌기는 격자에 맞춘다(배경 점 간격과 같게) */
const GRID = 16;
const snap = (n: number) => Math.round(n / GRID) * GRID;
/** 박스 네 면의 연결점 */
const SIDES = [['t', Position.Top], ['r', Position.Right], ['b', Position.Bottom], ['l', Position.Left]] as const;
const ARROW_LABELS: Record<Arrow, string> = { none: '화살표 없음', end: '→ 끝에', start: '← 시작에', both: '↔ 양쪽' };
const MARKER = { type: MarkerType.ArrowClosed, width: 18, height: 18 };
/** 붙여넣기 때 원래 자리에서 비키는 거리 */
const PASTE_OFFSET = GRID * 2;

const linkId = (l: TableLink) => `${l.from}>${l.to}`;
const editLink = (edit: Edit, id: string, patch: Partial<TableLink>) => edit(d => ({ ...d, links: d.links.map(l => linkId(l) === id ? { ...l, ...patch } : l) }));
const newId = () => crypto.randomUUID();
/** 그림 박스에 보이는 컬럼: PK 먼저. PK만 보기면 PK만(PK가 없으면 다) */
const shownColumns = (t: UsedTable) => [...t.columns.filter(c => c.pk), ...t.keysOnly && t.columns.some(c => c.pk) ? [] : t.columns.filter(c => !c.pk)];
const sizeOf = (n: FlowNode) => ({ w: n.measured?.width ?? n.width ?? 0, h: n.measured?.height ?? n.height ?? 0 });
const centerOf = (n: FlowNode) => { const { w, h } = sizeOf(n); return { x: n.position.x + w / 2, y: n.position.y + h / 2 }; };
/** 선이 붙을 점: 두 박스가 마주 보는 면(가로로 더 떨어져 있으면 좌우, 아니면 위아래). 박스를 옮기면 따라 바뀐다 */
function facingSides(a: FlowNode, b: FlowNode): [string, string] {
	const p = centerOf(a), q = centerOf(b), dx = q.x - p.x, dy = q.y - p.y;
	return Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? ['r', 'l'] : ['l', 'r'] : dy >= 0 ? ['b', 't'] : ['t', 'b'];
}
/** 그룹 틀 안에 든 것: 테이블·메모는 가운데가, 다른 틀은 통째로 안에 있으면 */
function inside(frame: FlowNode, n: FlowNode) {
	const { w, h } = sizeOf(frame), x0 = frame.position.x, y0 = frame.position.y;
	const within = (p: XYPosition) => p.x >= x0 && p.x <= x0 + w && p.y >= y0 && p.y <= y0 + h;
	if (n.type !== 'group-frame') { return within(centerOf(n)); }
	const s = sizeOf(n);
	return within(n.position) && within({ x: n.position.x + s.w, y: n.position.y + s.h });
}

/** PK와 일반 컬럼이 다 있음(그때만 PK만 보기 ↔ 전체) */
const mixedKeys = (t: UsedTable) => t.columns.some(c => c.pk) && t.columns.some(c => !c.pk);
/** NodeResizer가 끝낸 크기·자리 → 저장값 */
const boxOf = (p: { x: number; y: number; width: number; height: number }) => ({ x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) });

/** 노드·선 안의 편집칸이 함께 쓰는 것: 지금 편집 중인 칸(key), 데이터 고치기, 우클릭 메뉴 열기 */
const DiagramContext = createContext<{ editing?: string; setEditing: Dispatch<SetStateAction<string | undefined>>; edit: Edit; openMenu(e: ReactMouseEvent, items: MenuItem[]): void }>(null!);
const useDiagram = () => useContext(DiagramContext);

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
function Field({ k, value, placeholder, className, fields, onCommit, onTabEnd, label, options }: {
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
const FIT = { maxZoom: 1, padding: 0.2 };

const fieldKey = (id: string, field: string) => `${id}:${field}`;
/** 컬럼 타입 칸에서 고를 값(PostgreSQL 자주 쓰는 것). 목록에 없는 것도 그대로 입력 가능 */
const PG_TYPES = ['VARCHAR(20)', 'VARCHAR(50)', 'VARCHAR(100)', 'VARCHAR(255)', 'CHAR(1)', 'TEXT', 'SMALLINT', 'INTEGER', 'BIGINT', 'NUMERIC', 'NUMERIC(10,2)',
	'SERIAL', 'BIGSERIAL', 'BOOLEAN', 'DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ', 'UUID', 'JSONB', 'BYTEA'];
/** 테이블 박스의 Tab 순서: 이름 → 설명 → 보이는 컬럼마다 이름·설명·타입 */
const tableFields = (t: UsedTable) => [fieldKey(t.id, 'name'), fieldKey(t.id, 'desc'), ...shownColumns(t).flatMap(c => ['name', 'desc', 'type'].map(f => fieldKey(t.id, `${c.id}.${f}`)))];

type Items = Pick<UsedTables, 'tables' | 'memos' | 'groups'>;
/** data의 테이블·메모·그룹 하나 고치기 */
const editItem = <K extends keyof Items>(edit: Edit, key: K, id: string, fn: (item: Items[K][number]) => Items[K][number]) =>
	edit(d => ({ ...d, [key]: (d[key] as Items[K][number][]).map(x => x.id === id ? fn(x) : x) }));
const editTable = (edit: Edit, id: string, fn: (t: UsedTable) => UsedTable) => editItem(edit, 'tables', id, fn);
/** 컬럼 추가(after 뒤, 없으면 끝). PK만 보기면 풀어서 보이게. 새 컬럼 이름 칸 key를 돌려준다 */
function insertColumn(edit: Edit, id: string, after?: string) {
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
	return <div className={clsx('used-table-node', { selected, dim: data.dim })}>
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

function MemoInput({ k, value, onCommit }: { k: string; value: string; onCommit(value: string): void }) {
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
	return <textarea ref={area} className="memo-input nodrag nopan nowheel" defaultValue={value} aria-label="메모" spellCheck={false}
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
const NODE_TYPES = { table: TableBox, memo: MemoBox, 'group-frame': GroupBox };

/** 곧은 선이 지날 자리: 마주 보는 두 박스가 선과 수직인 방향으로 겹치면(위아래로 이을 때 가로 범위 등) 겹친 범위의 가운데. 덜 겹치면 없음 */
function straightAt(a: InternalNode | undefined, b: InternalNode | undefined, vertical: boolean) {
	if (!a || !b) { return undefined; }
	const span = (n: InternalNode) => { const p = n.internals.positionAbsolute, s = vertical ? n.measured.width ?? 0 : n.measured.height ?? 0, at = vertical ? p.x : p.y; return [at, at + s]; };
	const [a0, a1] = span(a), [b0, b1] = span(b), lo = Math.max(a0, b0), hi = Math.min(a1, b1);
	return hi - lo >= 16 ? Math.round((lo + hi) / 2) : undefined;
}

/** 선: 두 박스가 겹쳐 마주 보면 곧은 선, 아니면 둥글게 꺾인 직각선 + 화살표(선택) + 가운데 글자(더블클릭으로 편집) */
function LinkLine({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerStart, markerEnd, data, style }: EdgeProps<LinkEdge>) {
	const { editing, edit } = useDiagram();
	const vertical = sourcePosition === Position.Top || sourcePosition === Position.Bottom;
	const at = straightAt(useInternalNode(source), useInternalNode(target), vertical);
	const [path, x, y] = at === undefined ? getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12 })
		: vertical ? [`M ${at},${sourceY} L ${at},${targetY}`, at, (sourceY + targetY) / 2] : [`M ${sourceX},${at} L ${targetX},${at}`, (sourceX + targetX) / 2, at];
	const link = data!.link, k = fieldKey(id, 'label');
	return <>
		<BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} style={style} interactionWidth={16} />
		{(link.label || editing === k) && <EdgeLabelRenderer>
			<div className="link-label nopan" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>
				<Field k={k} value={link.label} placeholder="관계" onCommit={label => editLink(edit, id, { label })} label="선 글자" />
			</div>
		</EdgeLabelRenderer>}
	</>;
}
const EDGE_TYPES = { link: LinkLine };

/** 왼쪽 아래 확대·축소 버튼 밑 지금 배율(%). 누르면 100%로. 배율만 구독해 이것만 다시 그린다 */
function ZoomLevel() {
	const zoom = useStore(s => s.transform[2]), flow = useReactFlow();
	const percent = Math.round(zoom * 100);
	return <ControlButton className="zoom-level" title="100%로" aria-label={`배율 ${percent}%, 누르면 100%로`} onClick={() => void flow.zoomTo(1, { duration: 200 })}>{percent}%</ControlButton>;
}

/** 클립보드(이 웹뷰 안): 고른 테이블·메모·그룹과 그 사이 선 */
let clipboard: Pick<UsedTables, 'tables' | 'memos' | 'groups' | 'links'> | undefined;
let pasteCount = 0;

function toNodes(d: UsedTables, current: FlowNode[], select?: Set<string>): FlowNode[] {
	const old = new Map(current.map(n => [n.id, n]));
	const keep = <T extends FlowNode>(fresh: T): T => {
		const o = old.get(fresh.id);
		return { ...o, ...fresh, position: o?.dragging ? o.position : fresh.position, selected: select ? select.has(fresh.id) : o?.selected ?? false } as T;
	};
	// 큰 틀이 먼저(아래), 안에 든 작은 틀이 위로
	const groups = [...d.groups].sort((a, b) => b.w * b.h - a.w * a.h).map(group => keep<GroupNode>({
		id: group.id, type: 'group-frame', position: { x: group.x, y: group.y }, width: group.w, height: group.h, data: { group },
		dragHandle: '.group-handle', zIndex: -1, style: { pointerEvents: 'none' },
	}));
	return [...groups,
		...d.tables.map(table => keep<TableNode>({ id: table.id, type: 'table', position: { x: table.x, y: table.y }, data: { table } })),
		...d.memos.map(memo => keep<MemoNode>({ id: memo.id, type: 'memo', position: { x: memo.x, y: memo.y }, width: memo.w, height: memo.h, data: { memo } }))];
}
function toEdges(d: UsedTables, current: LinkEdge[], select?: Set<string>): LinkEdge[] {
	const old = new Map(current.map(e => [e.id, e]));
	return d.links.map(link => {
		const id = linkId(link), o = old.get(id);
		return { ...o, id, type: 'link', source: link.from, target: link.to, data: { link }, selected: select ? select.has(id) : o?.selected ?? false,
			markerEnd: link.arrow === 'end' || link.arrow === 'both' ? MARKER : undefined, markerStart: link.arrow === 'start' || link.arrow === 'both' ? MARKER : undefined };
	});
}

export function UsedTablesDiagram(props: { data: UsedTables; onChange: Edit; onUndo(): void; onRedo(): void; canUndo: boolean; canRedo: boolean }) {
	return <ReactFlowProvider><Diagram {...props} /></ReactFlowProvider>;
}

function Diagram({ data, onChange, onUndo, onRedo, canUndo, canRedo }: { data: UsedTables; onChange: Edit; onUndo(): void; onRedo(): void; canUndo: boolean; canRedo: boolean }) {
	const flow = useReactFlow<FlowNode, LinkEdge>();
	// 처음 그릴 때부터 노드가 있어야 fitView가 그 노드에 맞춘다(그 뒤로는 추가해도 확대 비율 그대로)
	const [nodes, setNodes] = useState<FlowNode[]>(() => toNodes(data, []));
	const [edges, setEdges] = useState<LinkEdge[]>(() => toEdges(data, []));
	const [editing, setEditing] = useState<string>();
	const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] }>();
	const [help, setHelp] = useState(false);
	// 그림만 웹뷰 전체로(Esc나 같은 버튼으로 돌아옴)
	const [full, setFull] = useState(false);
	const wrapper = useRef<HTMLDivElement>(null);
	/** 다음 data 반영 때 고를 것(추가·붙여넣기·복제한 것) */
	const selectNext = useRef<Set<string>>(undefined);
	/** 그룹 틀을 끄는 동안 같이 옮길 것: 시작 자리 */
	const carry = useRef<{ anchor: XYPosition; start: Map<string, XYPosition> }>(undefined);
	const latest = useRef({ nodes, edges });
	latest.current = { nodes, edges };

	useEffect(() => {
		const select = selectNext.current;
		selectNext.current = undefined;
		setNodes(current => toNodes(data, current, select));
		setEdges(current => toEdges(data, current, select));
	}, [data]);

	const selectedIds = () => new Set([...latest.current.nodes.filter(n => n.selected).map(n => n.id), ...latest.current.edges.filter(e => e.selected).map(e => e.id)]);
	/** 그림 가운데(화면 좌표 → 그림 좌표) */
	const viewCenter = () => {
		const r = wrapper.current!.getBoundingClientRect();
		return flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
	};
	/** 놓을 자리: at, 없으면 w×h 박스가 그림 가운데 오게. 같은 자리에 이미 있으면 비켜서(대각선으로) */
	const freeSpot = (at: XYPosition | undefined, w: number, h: number) => {
		const p = at ?? (c => ({ x: c.x - w / 2, y: c.y - h / 2 }))(viewCenter());
		let x = snap(p.x), y = snap(p.y);
		while (latest.current.nodes.some(n => n.type !== 'group-frame' && Math.abs(n.position.x - x) < GRID && Math.abs(n.position.y - y) < GRID)) { x += GRID * 2; y += GRID * 2; }
		return { x, y };
	};
	/** 새 것 추가: 고르고 바로 field 칸 입력 */
	const addItem = (id: string, field: string, add: (d: UsedTables) => UsedTables) => {
		selectNext.current = new Set([id]);
		onChange(add);
		setEditing(fieldKey(id, field));
	};
	const addTable = (at?: XYPosition) => {
		const id = newId(), p = freeSpot(at, 200, 80);
		addItem(id, 'name', d => ({ ...d, tables: [...d.tables, { id, name: '', desc: '', crud: [], columns: [], keysOnly: false, ...p }] }));
	};
	const addMemo = (at?: XYPosition) => {
		const id = newId(), p = freeSpot(at, MEMO_SIZE.w, MEMO_SIZE.h);
		addItem(id, 'text', d => ({ ...d, memos: [...d.memos, { id, text: '', color: 'yellow', ...p, ...MEMO_SIZE }] }));
	};
	/** 그룹: 고른 것이 있으면 그것을 감싸는 크기로, 없으면 기본 크기 */
	const addGroup = (at?: XYPosition, around: FlowNode[] = []) => {
		const id = newId();
		let box = { ...GROUP_SIZE, ...freeSpot(at, GROUP_SIZE.w, GROUP_SIZE.h) };
		if (around.length) {
			const x0 = Math.min(...around.map(n => n.position.x)), y0 = Math.min(...around.map(n => n.position.y));
			const x1 = Math.max(...around.map(n => n.position.x + sizeOf(n).w)), y1 = Math.max(...around.map(n => n.position.y + sizeOf(n).h));
			box = { x: snap(x0 - GRID * 2), y: snap(y0 - GRID * 4), w: snap(x1 - x0 + GRID * 4), h: snap(y1 - y0 + GRID * 6) };
		}
		addItem(id, 'title', d => ({ ...d, groups: [...d.groups, { id, title: '', color: 'blue', ...box }] }));
	};
	const remove = (ids: Set<string>) => {
		if (!ids.size) { return; }
		onChange(d => ({
			tables: d.tables.filter(t => !ids.has(t.id)), memos: d.memos.filter(m => !ids.has(m.id)), groups: d.groups.filter(g => !ids.has(g.id)),
			links: d.links.filter(l => !ids.has(linkId(l)) && !ids.has(l.from) && !ids.has(l.to)),
		}));
	};
	const copy = (ids = selectedIds()) => {
		const d = data;
		const tables = d.tables.filter(t => ids.has(t.id)), memos = d.memos.filter(m => ids.has(m.id)), groups = d.groups.filter(g => ids.has(g.id));
		if (!tables.length && !memos.length && !groups.length) { return false; }
		const ends = new Set([...tables, ...memos].map(n => n.id));
		clipboard = structuredClone({ tables, memos, groups, links: d.links.filter(l => ends.has(l.from) && ends.has(l.to)) });
		pasteCount = 0;
		return true;
	};
	/** 붙여넣기: 새 id로, at이 있으면 묶음의 왼쪽 위를 거기에, 없으면 원래 자리에서 조금씩 비켜서 */
	const paste = (at?: XYPosition) => {
		if (!clipboard) { return; }
		const c = clipboard, ids = new Map<string, string>(), fresh = (id: string) => { const n = newId(); ids.set(id, n); return n; };
		const all = [...c.tables, ...c.memos, ...c.groups];
		pasteCount++;
		const dx = at ? snap(at.x - Math.min(...all.map(n => n.x))) : PASTE_OFFSET * pasteCount, dy = at ? snap(at.y - Math.min(...all.map(n => n.y))) : PASTE_OFFSET * pasteCount;
		const tables = c.tables.map(t => ({ ...t, id: fresh(t.id), x: t.x + dx, y: t.y + dy, columns: t.columns.map(col => ({ ...col, id: newId() })) }));
		const memos = c.memos.map(m => ({ ...m, id: fresh(m.id), x: m.x + dx, y: m.y + dy }));
		const groups = c.groups.map(g => ({ ...g, id: fresh(g.id), x: g.x + dx, y: g.y + dy }));
		const links = c.links.map(l => ({ ...l, from: ids.get(l.from)!, to: ids.get(l.to)! }));
		selectNext.current = new Set([...ids.values(), ...links.map(linkId)]);
		onChange(d => ({ tables: [...d.tables, ...tables], memos: [...d.memos, ...memos], groups: [...d.groups, ...groups], links: [...d.links, ...links] }));
	};
	/** 복제: 붙여넣기와 같되 클립보드는 그대로 */
	const duplicate = (ids = selectedIds()) => {
		const saved = [clipboard, pasteCount] as const;
		if (copy(ids)) { paste(); }
		if (saved[0]) { [clipboard, pasteCount] = saved; }
	};
	const selectAll = () => {
		setNodes(ns => ns.map(n => ({ ...n, selected: true })));
		setEdges(es => es.map(e => ({ ...e, selected: true })));
	};
	/** F2·Enter: 고른 것 하나의 이름(메모는 내용) 편집 */
	const editSelected = () => {
		const [n, ...rest] = latest.current.nodes.filter(x => x.selected);
		if (!n || rest.length) { return false; }
		setEditing(fieldKey(n.id, n.type === 'memo' ? 'text' : n.type === 'group-frame' ? 'title' : 'name'));
		return true;
	};
	const setLink = (id: string, patch: Partial<TableLink>) => editLink(onChange, id, patch);

	// 단축키: 입력칸 밖에서(그림이 포커스를 가졌거나 아무것도 안 가졌을 때). VS Code(화면 XML Undo)·Design 단축키로 넘기지 않는다
	const keys = useRef<(e: KeyboardEvent) => void>(undefined);
	keys.current = e => {
		const el = e.target as HTMLElement;
		// ERD 탭은 다른 탭으로 가도 숨겨 둔 채 남는다(확대·되돌리기 기록 유지) → 숨어 있으면 단축키 안 받음
		if (!wrapper.current?.getClientRects().length) { return; }
		if (menu || el.closest?.('input, textarea, select, [contenteditable], dialog') || (el !== document.body && !wrapper.current?.contains(el))) { return; }
		// 도구 줄 버튼의 Enter·Space는 버튼 것
		if ((e.key === 'Enter' || e.key === ' ') && el.closest?.('button')) { return; }
		const mod = (key: string) => isModKey(e, key);
		// false를 돌려주면 처리 안 함(이벤트를 그대로 둔다)
		const run: (() => unknown) | undefined = mod('z') ? (e.shiftKey ? onRedo : onUndo) : mod('y') ? onRedo
			: mod('c') ? () => copy() : mod('x') ? () => { if (copy()) { remove(selectedIds()); } } : mod('v') ? () => paste() : mod('d') ? () => duplicate() : mod('a') ? selectAll
				: e.key === 'Delete' || e.key === 'Backspace' ? () => remove(selectedIds())
					: e.key === 'F2' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) ? editSelected
						: e.key === 'Escape' && full ? () => setFull(false) : undefined;
		if (!run || run() === false) { return; }
		e.preventDefault();
		e.stopPropagation();
	};
	useEffect(() => {
		const on = (e: KeyboardEvent) => keys.current?.(e);
		window.addEventListener('keydown', on, true);
		return () => window.removeEventListener('keydown', on, true);
	}, []);

	// 안 바뀌게(노드들이 받는 context가 끄는 프레임마다 바뀌어 모든 노드를 다시 그리지 않게)
	const openMenu = useCallback((e: ReactMouseEvent | MouseEvent, items: MenuItem[]) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items }); }, []);
	const context = useMemo(() => ({ editing, setEditing, edit: onChange, openMenu }), [editing, onChange, openMenu]);
	const at = (e: ReactMouseEvent | MouseEvent) => flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
	const colorItems = (current: NoteColor, apply: (color: NoteColor) => void): MenuItem[] => NOTE_COLORS.map(([color, label]) => ({ label, swatch: color, checked: current === color, run: () => apply(color) }));
	/** 우클릭한 것이 안 골라져 있으면 그것만 고른다 */
	const focusOn = (id: string) => {
		if (latest.current.nodes.find(n => n.id === id)?.selected || latest.current.edges.find(e => e.id === id)?.selected) { return; }
		setNodes(ns => ns.map(n => ({ ...n, selected: n.id === id })));
		setEdges(es => es.map(e => ({ ...e, selected: e.id === id })));
	};
	const onPaneMenu = (e: ReactMouseEvent | MouseEvent) => {
		const p = at(e);
		openMenu(e, [
			{ label: '테이블 추가', run: () => addTable(p) },
			{ label: '메모 추가', run: () => addMemo(p) },
			{ label: '그룹 추가', run: () => addGroup(p) },
			'separator',
			{ label: '붙여넣기', kbd: 'Ctrl+V', run: () => paste(p), disabled: !clipboard },
			{ label: '모두 선택', kbd: 'Ctrl+A', run: selectAll, disabled: !nodes.length },
			{ label: '전체 보기', run: () => void flow.fitView({ ...FIT, duration: 200 }), disabled: !nodes.length },
		]);
	};
	const clipItems = (ids: Set<string>): MenuItem[] => [
		{ label: '복사', kbd: 'Ctrl+C', run: () => copy(ids) },
		{ label: '복제', kbd: 'Ctrl+D', run: () => duplicate(ids) },
		{ label: '삭제', kbd: 'Delete', run: () => remove(ids) },
	];
	const onNodeMenu = (e: ReactMouseEvent, node: FlowNode) => {
		focusOn(node.id);
		const many = latest.current.nodes.filter(n => n.selected && n.id !== node.id).length > 0 && node.selected;
		if (many) { onSelectionMenu(e, latest.current.nodes.filter(n => n.selected)); return; }
		const ids = new Set([node.id]), common: MenuItem[] = ['separator', ...clipItems(ids)];
		if (node.type === 'table') {
			const t = node.data.table;
			openMenu(e, [
				{ label: '컬럼 추가', run: () => setEditing(insertColumn(onChange, t.id)) },
				{ label: '이름 편집', kbd: 'F2', run: () => setEditing(fieldKey(t.id, 'name')) },
				{ label: '설명 편집', run: () => { focusOn(t.id); setEditing(fieldKey(t.id, 'desc')); } },
				...mixedKeys(t) ? [{ label: t.keysOnly ? '모든 컬럼 보기' : 'PK만 보기', run: () => editTable(onChange, t.id, x => ({ ...x, keysOnly: !x.keysOnly })) }] : [],
				'separator',
				{ label: '이 테이블을 감싸는 그룹', run: () => addGroup(undefined, [node]) },
				...common]);
		} else if (node.type === 'memo') {
			const m = node.data.memo;
			openMenu(e, [{ label: '내용 편집', kbd: 'F2', run: () => setEditing(fieldKey(m.id, 'text')) }, 'separator',
				...colorItems(m.color, color => editItem(onChange, 'memos', m.id, x => ({ ...x, color }))), ...common]);
		} else {
			const g = node.data.group, members = latest.current.nodes.filter(n => n.id !== g.id && inside(node, n));
			openMenu(e, [{ label: '이름 편집', kbd: 'F2', run: () => setEditing(fieldKey(g.id, 'title')) },
				{ label: `안에 든 것까지 선택 (${members.length})`, disabled: !members.length, run: () => {
					const pick = new Set([g.id, ...members.map(n => n.id)]);
					setNodes(ns => ns.map(n => ({ ...n, selected: pick.has(n.id) })));
				} }, 'separator',
				...colorItems(g.color, color => editItem(onChange, 'groups', g.id, x => ({ ...x, color }))),
				'separator',
				{ label: '그룹만 삭제 (안의 것은 그대로)', kbd: 'Delete', run: () => remove(ids) },
				{ label: '그룹과 안의 것 모두 삭제', run: () => remove(new Set([g.id, ...members.map(n => n.id)])) }]);
		}
	};
	const onSelectionMenu = (e: ReactMouseEvent, picked: FlowNode[]) => {
		const ids = new Set(picked.map(n => n.id));
		openMenu(e, [
			{ label: `그룹으로 묶기 (${picked.length})`, run: () => addGroup(undefined, picked) },
			'separator',
			...clipItems(ids),
		]);
	};
	const onEdgeMenu = (e: ReactMouseEvent, edge: LinkEdge) => {
		focusOn(edge.id);
		const l = edge.data!.link;
		openMenu(e, [
			...ARROWS.map(arrow => ({ label: ARROW_LABELS[arrow], checked: l.arrow === arrow, run: () => setLink(edge.id, { arrow }) })),
			{ label: '방향 바꾸기', disabled: l.arrow === 'none' || l.arrow === 'both', run: () => setLink(edge.id, { from: l.to, to: l.from, arrow: l.arrow }) },
			'separator',
			{ label: l.label ? '글자 편집' : '글자 넣기', run: () => setEditing(fieldKey(edge.id, 'label')) },
			{ label: '선 삭제', kbd: 'Delete', run: () => remove(new Set([edge.id])) },
		]);
	};

	const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
		// 지우기는 단축키·메뉴가 data로(선까지 같이)
		setNodes(ns => applyNodeChanges(changes.filter(c => c.type !== 'remove'), ns));
	};
	const onEdgesChange = (changes: EdgeChange<LinkEdge>[]) => setEdges(es => applyEdgeChanges(changes.filter(c => c.type !== 'remove'), es));
	const onConnect = ({ source, target }: Connection) => {
		// 같은 두 끝은 한 번만(방향을 바꾸려면 선 우클릭)
		if (source === target || data.links.some(l => (l.from === source && l.to === target) || (l.from === target && l.to === source))) { return; }
		onChange(d => ({ ...d, links: [...d.links, { from: source, to: target, arrow: 'end', label: '' }] }));
	};
	const onDragStart = (_: unknown, node: FlowNode, dragged: FlowNode[]) => {
		const moving = new Set(dragged.map(n => n.id)), frames = dragged.filter(n => n.type === 'group-frame');
		const start = new Map<string, XYPosition>();
		for (const n of latest.current.nodes) {
			if (!moving.has(n.id) && frames.some(f => inside(f, n))) { start.set(n.id, n.position); }
		}
		carry.current = start.size ? { anchor: node.position, start } : undefined;
	};
	const onDrag = (_: unknown, node: FlowNode) => {
		const c = carry.current;
		if (!c) { return; }
		const dx = node.position.x - c.anchor.x, dy = node.position.y - c.anchor.y;
		setNodes(ns => ns.map(n => { const s = c.start.get(n.id); return s ? { ...n, position: { x: s.x + dx, y: s.y + dy } } : n; }));
	};
	/** 끌기를 마치면 옮긴 것(같이 옮긴 그룹 안 것까지) 자리 저장 */
	const onDragStop = (_: unknown, node: FlowNode, dragged: FlowNode[]) => {
		const c = carry.current;
		carry.current = undefined;
		const moved = new Map(dragged.map(n => [n.id, n.position]));
		if (c) {
			const dx = node.position.x - c.anchor.x, dy = node.position.y - c.anchor.y;
			c.start.forEach((s, id) => moved.set(id, { x: s.x + dx, y: s.y + dy }));
		}
		const place = <T extends { id: string; x: number; y: number }>(o: T): T => { const p = moved.get(o.id); return p && (p.x !== o.x || p.y !== o.y) ? { ...o, x: Math.round(p.x), y: Math.round(p.y) } : o; };
		onChange(d => {
			const next = { ...d, tables: d.tables.map(place), memos: d.memos.map(place), groups: d.groups.map(place) };
			return next.tables.every((t, i) => t === d.tables[i]) && next.memos.every((m, i) => m === d.memos[i]) && next.groups.every((g, i) => g === d.groups[i]) ? d : next;
		});
	};

	// 테이블 하나만 고르면 그것과 이어진 것만 또렷하게(나머지는 흐리게). 선은 마주 보는 면에
	const picked = nodes.filter(n => n.selected);
	const focus = picked.length === 1 && picked[0].type === 'table' ? picked[0].id : undefined;
	const near = new Set(focus ? [focus, ...edges.filter(e => e.source === focus || e.target === focus).flatMap(e => [e.source, e.target])] : []);
	const shownNodes = focus ? nodes.map(n => n.type === 'group-frame' || near.has(n.id) ? n : { ...n, data: { ...n.data, dim: true } } as FlowNode) : nodes;
	const byId = new Map(nodes.map(n => [n.id, n]));
	const shownEdges = edges.map(e => {
		const a = byId.get(e.source), b = byId.get(e.target);
		const [sourceHandle, targetHandle] = a && b ? facingSides(a, b) : [undefined, undefined];
		return { ...e, sourceHandle, targetHandle, className: !focus ? undefined : e.source === focus || e.target === focus ? 'hot' : 'dim' };
	});
	const light = document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast-light');
	const tool = (icon: string, label: string, run: () => void, extra?: { disabled?: boolean; title?: string; pressed?: boolean; text?: boolean }): ReactNode =>
		<button type="button" className={clsx('flow-tool', { 'with-text': extra?.text })} title={extra?.title ?? label} aria-label={label} disabled={extra?.disabled} aria-pressed={extra?.pressed} onClick={run}>
			<span className={`codicon codicon-${icon}`} />{extra?.text && <span>{label}</span>}</button>;

	return <DiagramContext.Provider value={context}>
		<div ref={wrapper} className={clsx('used-tables-flow', { full })}>
			<ReactFlow nodes={shownNodes} edges={shownEdges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
				onNodeDragStart={onDragStart} onNodeDrag={onDrag} onNodeDragStop={onDragStop}
				onPaneContextMenu={onPaneMenu} onNodeContextMenu={onNodeMenu} onSelectionContextMenu={onSelectionMenu} onEdgeContextMenu={onEdgeMenu}
				onEdgeDoubleClick={(_, edge) => setEditing(fieldKey(edge.id, 'label'))}
				onDoubleClick={e => { if ((e.target as HTMLElement).classList.contains('react-flow__pane')) { addTable(at(e)); } }}
				connectionMode={ConnectionMode.Loose} connectionLineType={ConnectionLineType.SmoothStep} defaultMarkerColor="var(--vscode-descriptionForeground)"
				snapToGrid snapGrid={[GRID, GRID]} panOnScroll selectionOnDrag panOnDrag={[1]} deleteKeyCode={null} zoomOnDoubleClick={false} elevateNodesOnSelect={false}
				colorMode={light ? 'light' : 'dark'} fitView fitViewOptions={FIT} proOptions={{ hideAttribution: true }} minZoom={0.2} maxZoom={2}>
				<Background variant={BackgroundVariant.Dots} gap={GRID} size={1.2} />
				<MiniMap pannable zoomable nodeBorderRadius={6} nodeStrokeWidth={2} nodeClassName={n => n.type ?? ''} />
				<Controls showInteractive={false} fitViewOptions={{ ...FIT, duration: 200 }}><ZoomLevel /></Controls>
				<Panel position="top-left" className="flow-toolbar">
					{tool('table', '테이블', () => addTable(), { text: true, title: '테이블 추가 (빈 곳 더블클릭)' })}
					{tool('note', '메모', () => addMemo(), { text: true, title: '메모 추가' })}
					{tool('layers', '그룹', () => { const sel = latest.current.nodes.filter(n => n.selected && n.type !== 'group-frame'); addGroup(undefined, sel); },
						{ text: true, title: '그룹 추가 (고른 것이 있으면 감싸서)' })}
					<span className="flow-sep" />
					{tool('discard', '되돌리기', onUndo, { disabled: !canUndo, title: '되돌리기 (Ctrl+Z)' })}
					{tool('redo', '다시 실행', onRedo, { disabled: !canRedo, title: '다시 실행 (Ctrl+Y)' })}
					<span className="flow-sep" />
					{tool('question', '도움말', () => setHelp(h => !h), { pressed: help })}
				</Panel>
				<Panel position="top-right">
					<button type="button" className={`flow-full codicon codicon-${full ? 'screen-normal' : 'screen-full'}`} title={full ? '원래 크기로 (Esc)' : '전체 화면'}
						aria-label={full ? '원래 크기로' : '전체 화면'} aria-pressed={full} onClick={() => setFull(f => !f)} />
				</Panel>
				{help && <Panel position="top-left" className="flow-help">
					<ul>
						<li><b>빈 곳 더블클릭</b> 테이블 추가 · <b>우클릭</b> 메뉴(추가·색·화살표·삭제)</li>
						<li><b>글자 더블클릭</b> 편집 · <b>Enter</b> 반영 · <b>Tab</b> 다음 칸 · <b>Esc</b> 취소</li>
						<li><b>PK</b> 칸 클릭으로 PK 켜고 끄기 · 마지막 칸에서 Tab: 컬럼 하나 더</li>
						<li><b>박스 옆 점 → 다른 박스</b> 선 잇기 · 선 더블클릭: 글자</li>
						<li><b>빈 곳 끌기</b> 여러 개 고르기 → 우클릭 그룹으로 묶기</li>
						<li><b>그룹 이름 줄 끌기</b> 안에 든 것과 같이 옮기기</li>
						<li><b>휠</b> 화면 이동(가운데 버튼·Space+끌기도) · <b>Ctrl+휠</b> 확대·축소</li>
						<li><b>Delete</b> 지우기 · <b>Ctrl+C/V/D</b> 복사·붙여넣기·복제 · <b>Ctrl+Z/Y</b> 되돌리기·다시</li>
					</ul>
				</Panel>}
				{!nodes.length && <Panel position="top-center" className="flow-empty">
					<p>빈 곳을 더블클릭하거나 우클릭해 테이블·메모·그룹을 추가하세요.</p>
					<button type="button" className="btn btn-primary" onClick={() => addTable()}>테이블 추가</button>
				</Panel>}
			</ReactFlow>
		{menu && <Menu key={`${menu.x},${menu.y}`} x={menu.x} y={menu.y} onClose={() => setMenu(undefined)}>
			{menu.items.map((item, i) => item === 'separator' ? <div key={i} className="menu-separator" role="separator" />
				: <button key={i} role={item.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={item.checked} disabled={item.disabled}
					onClick={() => { setMenu(undefined); item.run(); }}>
					<span className="menu-label">{item.swatch && <span className={`swatch note-${item.swatch}`} />}{item.checked !== undefined && <span className={`codicon codicon-${item.checked ? 'check' : 'blank'}`} />}{item.label}</span>
					{item.kbd && <kbd>{item.kbd}</kbd>}</button>)}
		</Menu>}
		</div>
	</DiagramContext.Provider>;
}
