// Info 탭: 화면 정보(head의 meta_* 속성)와 개정 이력(History Meta Info). 입력칸을 벗어나면(Enter·blur) 바로 XML에 반영
import { useEffect, useState, type KeyboardEvent } from 'react';
import { INFO_FIELDS, readHistory, type HistoryRow } from '../../core/info';
import type { XmlNode } from '../../core/xmlModel';
import { DateInput, formatDate } from './dateInput';
import { useRowDrag } from './rowDrag';

type Row = HistoryRow & { uid: number };
const withUids = (rows: HistoryRow[]): Row[] => rows.map((r, uid) => ({ ...r, uid }));
const HISTORY_COLUMNS: [keyof HistoryRow, string][] = [['no', '개정번호'], ['desc', '제/개정 페이지 및 수정 내용'], ['date', '제/개정 일자'], ['user', '제/개정자']];

function Field({ label, value, multiline, date, onCommit }: { label: string; value: string; multiline?: boolean; date?: boolean; onCommit(v: string): void }) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const commit = () => { if (draft !== value) { onCommit(draft); } };
	const keys = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
		if (e.key === 'Escape') { setDraft(value); }
		if (e.key === 'Escape' || e.key === 'Enter' && !multiline && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.blur(); }
	};
	const props = { 'aria-label': label, value: draft, onBlur: commit, onKeyDown: keys };
	return <label className={multiline ? 'info-field wide' : 'info-field'}>
		<span>{label}</span>
		{date ? <DateInput aria-label={label} value={value} onCommit={onCommit} /> : multiline ? <textarea rows={3} {...props} onChange={e => setDraft(e.target.value)} /> : <input {...props} onChange={e => setDraft(e.target.value)} />}
	</label>;
}

export function InfoPane({ head, onAttr, onHistory }: { head: XmlNode; onAttr(name: string, value: string | undefined): void; onHistory(rows: HistoryRow[]): void }) {
	const savedKey = JSON.stringify(readHistory(head));
	// 행마다 uid: 끌어 옮겨도 입력칸 상태가 그 행을 따라가게
	const [rows, setRows] = useState<Row[]>(() => withUids(readHistory(head)));
	const [selected, setSelected] = useState<number>();
	// 문서의 이력 내용이 바뀔 때만 다시 읽는다(고치는 중인 칸은 그대로)
	useEffect(() => setRows(withUids(JSON.parse(savedKey) as HistoryRow[])), [savedKey]);
	const commit = (next = rows) => {
		const plain = next.map(({ uid: _, ...r }) => r);
		if (JSON.stringify(plain) !== savedKey) { onHistory(plain); }
	};
	const update = (next: Row[]) => { setRows(next); commit(next); };
	// 손잡이(⠿)로 끌어 순서 바꾸기: 놓으면 바로 반영
	const { handleProps, rowProps, dropClass } = useRowDrag<Row>(change => update(typeof change === 'function' ? change(rows) : change), setSelected);
	const add = () => {
		const no = Math.max(0, ...rows.map(r => Number(r.no) || 0)) + 1, uid = Math.max(-1, ...rows.map(r => r.uid)) + 1;
		update([...rows, { uid, no: String(no), desc: '', date: formatDate(new Date()), user: '' }]);
		setSelected(uid);
	};
	const remove = () => {
		if (selected === undefined) { return; }
		update(rows.filter(r => r.uid !== selected));
		setSelected(undefined);
	};
	return <div className="info-pane">
		<section>
			<h3>화면 정보</h3>
			<div className="info-grid">
				{INFO_FIELDS.map(f => <Field key={f.name} label={f.label} value={head.attrs[f.name] ?? ''} multiline={'multiline' in f} date={'date' in f}
					onCommit={v => onAttr(f.name, v || undefined)} />)}
			</div>
		</section>
		<section className="info-history">
			<h3>History Meta Info
				<span className="section-tools">
					<button type="button" className="btn-tool accent" onClick={add} aria-label="이력 추가"><span className="codicon codicon-add" />추가</button>
					<button type="button" className="btn-tool" onClick={remove} disabled={selected === undefined} aria-label="이력 삭제"><span className="codicon codicon-trash" />삭제</button>
				</span>
			</h3>
			<div className="data-editor-body">
				{rows.length ? <div className="data-editor-table-wrap">
					<table style={{ width: '100%' }}>
						<colgroup><col style={{ width: 48 }} /><col style={{ width: 90 }} /><col /><col style={{ width: 120 }} /><col style={{ width: 120 }} /></colgroup>
						<thead><tr><th>No</th>{HISTORY_COLUMNS.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
						<tbody>{rows.map((row, i) => <tr key={row.uid} className={`${selected === row.uid ? 'selected' : ''} ${dropClass(row.uid)}`} onClick={() => setSelected(row.uid)} {...rowProps(row.uid)}>
							<td><button type="button" className="data-row-handle" title="끌어서 순서 변경" aria-label={`${i + 1}행 이동`} {...handleProps(row.uid)}>⠿ {i + 1}</button></td>
							{HISTORY_COLUMNS.map(([key, label]) => {
								const common = { 'aria-label': `${i + 1}행 ${label}`, onFocus: () => setSelected(row.uid) };
								const set = (v: string) => setRows(current => current.map(r => r.uid === row.uid ? { ...r, [key]: v } : r));
								return <td key={key}>
									{key === 'date'
										// 고르거나 칸에서 나오면 바로 반영(올바른 날짜만)
										? <DateInput {...common} className="center" value={row.date} onCommit={v => update(rows.map(r => r.uid === row.uid ? { ...r, date: v } : r))} />
										: key === 'desc'
											// 여러 줄: Enter는 줄바꿈, 칸에서 나오면 반영
											? <textarea {...common} rows={Math.max(1, row.desc.split('\n').length)} value={row.desc} onChange={e => set(e.target.value)} onBlur={() => commit()} />
											: <input {...common} className={key === 'no' ? 'center' : undefined} value={row[key]} onChange={e => set(e.target.value)} onBlur={() => commit()}
												onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.currentTarget.blur(); } }} />}
								</td>;
							})}
						</tr>)}</tbody>
					</table>
				</div> : <p className="table-empty">개정 이력이 없습니다. 추가를 눌러 넣어 주세요.</p>}
			</div>
		</section>
	</div>;
}
