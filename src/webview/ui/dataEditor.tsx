import { useRef, useState, type KeyboardEvent } from 'react';
import { DATA_TYPES, type DataField } from '../../core/data';
import { VALID_ID, type XmlNode } from '../../core/xmlModel';
import { PopupTitle, usePopupWindow } from './popupWindow';
import { useRowDrag } from './rowDrag';

type Row = DataField & { uid: number; ord?: number };

const COLUMN_LABELS = ['No', 'id', 'name', 'dataType', 'length', 'encYN'];
const COLUMN_WIDTHS = [48, 130, 130, 130, 100, 42];

export function DataEditor({ node, externalError, offsetIndex = 0, onApply, onClose }: {
	node: XmlNode; externalError?: string; offsetIndex?: number; onApply(fields: DataField[], id: string): void; onClose(): void;
}) {
	const map = node.tag.endsWith(':dataMap');
	const info = node.children.find(c => c.tag.endsWith(map ? ':keyInfo' : ':columnInfo'));
	const data = map ? node.children.find(c => c.tag.endsWith(':data')) : undefined;
	const [rows, setRows] = useState<Row[]>(() => (info?.children ?? []).map((c, uid) => ({
		uid, ord: uid, id: c.attrs.id ?? '', name: c.attrs.name ?? '', dataType: c.attrs.dataType ?? 'text',
		length: c.attrs.length ?? '', encYN: c.attrs.encYN === 'true', value: data?.children.find(v => v.tag === c.attrs.id)?.text ?? '',
	})));
	const [id, setId] = useState(node.attrs.id ?? '');
	const [selected, setSelected] = useState<number>();
	const [error, setError] = useState('');
	const [columnWidths, setColumnWidths] = useState(COLUMN_WIDTHS);
	const nextUid = useRef(rows.length);
	const { titleProps, resizeHandles, popupProps } = usePopupWindow({ initialOffset: offsetIndex, onClose });
	const columnDrag = useRef<{ index: number; startX: number; width: number } | undefined>(undefined);
	const { handleProps, rowProps, dropClass } = useRowDrag(setRows, setSelected);
	const update = (uid: number, change: Partial<Row>) => setRows(current => current.map(r => r.uid === uid ? { ...r, ...change } : r));
	const insert = () => {
		let number = 1;
		const base = map ? 'key' : 'col';
		while (rows.some(r => r.id === `${base}${number}`)) { number++; }
		const row = { uid: nextUid.current++, id: `${base}${number}`, name: `name${number}`, dataType: 'text', length: '', encYN: false, value: '' };
		const at = selected === undefined ? rows.length : rows.findIndex(r => r.uid === selected) + 1;
		setRows(current => [...current.slice(0, at), row, ...current.slice(at)]);
		setSelected(row.uid);
	};
	const remove = () => { setRows(current => current.filter(r => r.uid !== selected)); setSelected(undefined); };
	const move = (by: number) => setRows(current => {
		const at = current.findIndex(r => r.uid === selected), to = at + by;
		if (at < 0 || to < 0 || to >= current.length) { return current; }
		const copy = [...current];
		[copy[at], copy[to]] = [copy[to], copy[at]];
		return copy;
	});
	const gridKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
		const direction = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
		if (!direction) { return; }
		const cell = (e.target as HTMLElement).closest('td');
		const tableRows = [...e.currentTarget.tBodies[0].rows];
		const rowIndex = cell ? tableRows.indexOf(cell.parentElement as HTMLTableRowElement) : -1;
		if (!cell || rowIndex < 0) { return; }
		const target = tableRows[rowIndex + direction[0]]?.cells[cell.cellIndex + direction[1]]?.querySelector<HTMLElement>('input, select, button');
		if (target) { e.preventDefault(); target.focus(); setSelected(rows[rowIndex + direction[0]].uid); }
	};
	const apply = () => {
		if (!VALID_ID.test(id)) { setError(`ID를 확인해 줘: ${id || '(비어 있음)'}`); return; }
		const ids = new Set<string>();
		for (const row of rows) {
			if (!VALID_ID.test(row.id) || ids.has(row.id)) { setError(`ID를 확인해 줘: ${row.id || '(비어 있음)'}`); return; }
			if (row.length && !/^\d+$/.test(row.length)) { setError('length는 0 이상의 정수만 입력할 수 있어.'); return; }
			ids.add(row.id);
		}
		setError('');
		onApply(rows.map(({ uid: _, ord, ...field }) => ({ ...field, sourceIndex: ord === undefined ? undefined : info?.children[ord]?.index })), id);
	};
	return <dialog {...popupProps} className="popup data-editor" aria-label={`${node.attrs.id ?? node.tag} 편집`}>
		<PopupTitle titleProps={titleProps} badge={map ? 'DataMap' : 'DataList'} onClose={onClose}>
			<input className="data-editor-id" aria-label="ID" value={id} onChange={e => setId(e.target.value)} onPointerDown={e => e.stopPropagation()} />
			<span className="popup-meta">· {map ? '키' : '컬럼'} {rows.length}</span>
		</PopupTitle>
		<div className="data-editor-body">
			<div className="data-editor-tools">
				<button type="button" className="btn-tool accent" onClick={insert} title="고른 행 아래에 추가" aria-label="행 삽입"><span className="codicon codicon-add" />{map ? '키 추가' : '컬럼 추가'}</button>
				<button type="button" className="btn-tool" onClick={remove} disabled={selected === undefined} title="고른 행 삭제" aria-label="행 삭제"><span className="codicon codicon-trash" />삭제</button>
				<span className="tools-gap" />
				<button type="button" className="btn-icon" onClick={() => move(-1)} disabled={selected === undefined} title="위로 이동" aria-label="위로 이동"><span className="codicon codicon-arrow-up" /></button>
				<button type="button" className="btn-icon" onClick={() => move(1)} disabled={selected === undefined} title="아래로 이동" aria-label="아래로 이동"><span className="codicon codicon-arrow-down" /></button>
			</div>
			<div className="data-editor-table-wrap">
				<table onKeyDown={gridKeyDown} style={{ width: '100%', minWidth: columnWidths.reduce((sum, width) => sum + width, 0) }}>
					<colgroup>{columnWidths.map((width, index) => <col key={index} style={{ width: index < columnWidths.length - 1 ? width : undefined }} />)}</colgroup>
					<thead><tr>{COLUMN_LABELS.map((label, index) => <th key={label}>{label}{index < COLUMN_LABELS.length - 1 && <span className="data-col-resizer"
						onPointerDown={e => {
							if (e.button !== 0) { return; }
							e.preventDefault();
							columnDrag.current = { index, startX: e.clientX, width: columnWidths[index] };
							e.currentTarget.setPointerCapture(e.pointerId);
						}} onPointerMove={e => {
							const drag = columnDrag.current;
							if (drag?.index === index) { setColumnWidths(current => current.map((width, i) => i === index ? Math.max(42, drag.width + e.clientX - drag.startX) : width)); }
						}} onPointerUp={() => columnDrag.current = undefined} onPointerCancel={() => columnDrag.current = undefined} />}</th>)}</tr></thead><tbody>
					{rows.map((row, i) => <tr key={row.uid} className={`${selected === row.uid ? 'selected' : ''} ${dropClass(row.uid)}`}
						onClick={() => setSelected(row.uid)} {...rowProps(row.uid)}>
						<td><button className="data-row-handle" title="끌어서 행 이동" aria-label={`${i + 1}행 이동`} {...handleProps(row.uid)}>⠿ {i + 1}</button></td>
						<td><input className="mono" aria-label={`${i + 1}행 id`} value={row.id} onChange={e => update(row.uid, { id: e.target.value })} /></td>
						<td><input aria-label={`${i + 1}행 name`} value={row.name} onChange={e => update(row.uid, { name: e.target.value })} /></td>
						<td><select aria-label={`${i + 1}행 dataType`} value={row.dataType} onChange={e => update(row.uid, { dataType: e.target.value })}>{DATA_TYPES.map(type => <option key={type}>{type}</option>)}</select></td>
						<td><input aria-label={`${i + 1}행 length`} inputMode="numeric" value={row.length} onChange={e => update(row.uid, { length: e.target.value })} /></td>
						<td><input className="switch" aria-label={`${i + 1}행 encYN`} type="checkbox" checked={row.encYN} onChange={e => update(row.uid, { encYN: e.target.checked })} /></td>
					</tr>)}
				</tbody></table>
			</div>
		</div>
		{(error || externalError) && <p className="error" role="alert">{error || externalError}</p>}
		<div className="data-editor-actions">
			<span className="actions-hint">행을 끌어 순서 변경 · 화살표로 칸 이동</span>
			<button type="button" className="btn btn-secondary" onClick={onClose}>닫기</button>
			<button type="button" className="btn btn-primary" onClick={apply}>확인</button>
		</div>
		{resizeHandles}
	</dialog>;
}
