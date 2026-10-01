import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { DATA_TYPES, type DataField } from '../../core/data';
import { VALID_ID, type XmlNode } from '../../core/xmlModel';
import { PopupTitle, usePopupWindow } from './popupWindow';

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
	const [drop, setDrop] = useState<{ uid: number; after: boolean }>();
	const nextUid = useRef(rows.length);
	const { titleProps, resizeHandles, popupProps } = usePopupWindow({ initialOffset: offsetIndex, onClose });
	const columnDrag = useRef<{ index: number; startX: number; width: number } | undefined>(undefined);
	const rowDrag = useRef<number | undefined>(undefined);
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
	const dragOver = (e: DragEvent<HTMLTableRowElement>, uid: number) => {
		if (rowDrag.current === undefined || rowDrag.current === uid) { return; }
		e.preventDefault();
		const rect = e.currentTarget.getBoundingClientRect();
		const after = e.clientY > rect.top + rect.height / 2;
		setDrop(current => current?.uid === uid && current.after === after ? current : { uid, after });
	};
	const dropRow = (e: DragEvent<HTMLTableRowElement>, uid: number) => {
		e.preventDefault();
		const dragged = rowDrag.current;
		if (dragged === undefined) { return; }
		const rect = e.currentTarget.getBoundingClientRect();
		const after = e.clientY > rect.top + rect.height / 2;
		setRows(current => {
			const from = current.findIndex(r => r.uid === dragged);
			const to = current.findIndex(r => r.uid === uid);
			if (from < 0 || to < 0 || from === to) { return current; }
			const next = [...current];
			const [item] = next.splice(from, 1);
			next.splice(to + (after ? 1 : 0) - (from < to ? 1 : 0), 0, item);
			return next;
		});
		setSelected(dragged);
		rowDrag.current = undefined;
		setDrop(undefined);
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
		</PopupTitle>
		<div className="data-editor-body">
			<div className="data-editor-tools">
				<button type="button" className="btn-icon" onClick={insert} title="행 삽입" aria-label="행 삽입"><span className="codicon codicon-add" /></button>
				<button type="button" className="btn-icon" onClick={remove} disabled={selected === undefined} title="행 삭제" aria-label="행 삭제"><span className="codicon codicon-remove" /></button>
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
					{rows.map((row, i) => <tr key={row.uid} className={`${selected === row.uid ? 'selected' : ''} ${drop?.uid === row.uid ? drop.after ? 'drop-after' : 'drop-before' : ''}`}
						onClick={() => setSelected(row.uid)} onDragOver={e => dragOver(e, row.uid)} onDrop={e => dropRow(e, row.uid)}>
						<td><button className="data-row-handle" draggable title="끌어서 행 이동" aria-label={`${i + 1}행 이동`}
							onDragStart={e => { rowDrag.current = row.uid; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(row.uid)); }}
							onDragEnd={() => { rowDrag.current = undefined; setDrop(undefined); }}>⠿ {i + 1}</button></td>
						<td><input aria-label={`${i + 1}행 id`} value={row.id} onChange={e => update(row.uid, { id: e.target.value })} /></td>
						<td><input aria-label={`${i + 1}행 name`} value={row.name} onChange={e => update(row.uid, { name: e.target.value })} /></td>
						<td><select aria-label={`${i + 1}행 dataType`} value={row.dataType} onChange={e => update(row.uid, { dataType: e.target.value })}>{DATA_TYPES.map(type => <option key={type}>{type}</option>)}</select></td>
						<td><input aria-label={`${i + 1}행 length`} inputMode="numeric" value={row.length} onChange={e => update(row.uid, { length: e.target.value })} /></td>
						<td><input aria-label={`${i + 1}행 encYN`} type="checkbox" checked={row.encYN} onChange={e => update(row.uid, { encYN: e.target.checked })} /></td>
					</tr>)}
				</tbody></table>
			</div>
		</div>
		{(error || externalError) && <p className="error" role="alert">{error || externalError}</p>}
		<div className="data-editor-actions">
			<button type="button" className="btn btn-primary" onClick={apply}>확인</button>
			<button type="button" className="btn btn-secondary" onClick={onClose}>닫기</button>
		</div>
		{resizeHandles}
	</dialog>;
}
