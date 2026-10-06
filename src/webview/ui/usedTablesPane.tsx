// Beta 탭 > 사용 테이블: 화면이 쓰는 DB 테이블을 직접 적고(이름·설명·CRUD·컬럼) 그림에서 테이블끼리 선으로 잇는다.
// 저장은 확장이 이 PC의 고른 폴더에 화면별 JSON으로(고칠 때마다 잠깐 모았다가). 화면 XML은 건드리지 않는다
import { useCallback, useEffect, useRef, useState } from 'react';
import { CRUD, type CrudKey, type UsedColumn, type UsedTable, type UsedTables } from '../../core/tables';
import type { ToWebview } from '../../core/protocol';
import { post } from '../store';
import { isModKey } from '../keys';
import { UsedTablesDiagram } from './usedTablesDiagram';

type Status = Omit<Extract<ToWebview, { type: 'usedTables' }>, 'type'>;
const SAVE_DELAY = 400;
/** 새 테이블 자리: 3열 격자에서 다음 칸 */
const nextSpot = (count: number) => ({ x: 40 + (count % 3) * 260, y: 40 + Math.floor(count / 3) * 200 });

/** 확장과 주고받기: 처음에 읽고(저장 폴더를 안 골랐으면 status.folder 없음), change는 바로 그리고 잠깐 모았다가 저장. 닫힐 때 남은 것 저장 */
function useUsedTables() {
	const [status, setStatus] = useState<Status>();
	const [data, setData] = useState<UsedTables>();
	const timer = useRef<number>(undefined);
	const pending = useRef<UsedTables>(undefined);
	const flush = useCallback(() => {
		clearTimeout(timer.current);
		if (pending.current) { post({ type: 'saveUsedTables', data: pending.current }); pending.current = undefined; }
	}, []);
	const change = useCallback((next: UsedTables) => {
		setData(next);
		pending.current = next;
		clearTimeout(timer.current);
		timer.current = window.setTimeout(flush, SAVE_DELAY);
	}, [flush]);
	useEffect(() => {
		const on = (e: MessageEvent<ToWebview>) => {
			if (e.data.type !== 'usedTables') { return; }
			const { type: _, ...next } = e.data;
			setStatus(next);
			if (next.data) { setData(next.data); }
		};
		window.addEventListener('message', on);
		post({ type: 'loadUsedTables' });
		return () => { window.removeEventListener('message', on); flush(); };
	}, [flush]);
	return { status, data, change };
}

export function UsedTablesPane() {
	const { status, data, change } = useUsedTables();
	// 고른 테이블(표의 행·그림의 박스 공통): 아래 컬럼 편집 대상
	const [selected, setSelected] = useState<string>();

	if (!status) { return <p className="empty">불러오는 중…</p>; }
	if (!status.folder) {
		return <div className="used-tables-setup">
			<h3>사용 테이블 저장 위치</h3>
			<p>화면 XML에는 넣지 않고, 이 PC의 폴더에 화면마다 JSON 파일로 저장합니다. 한 번 고르면 이 작업 공간에서 기억합니다.</p>
			<div className="setup-actions">
				<button type="button" className="btn btn-primary" onClick={() => post({ type: 'chooseTablesFolder', pick: true })}>폴더 고르기…</button>
				<button type="button" className="btn btn-secondary" onClick={() => post({ type: 'chooseTablesFolder', pick: false })}>기본 위치 사용</button>
			</div>
		</div>;
	}
	if (!data) { return <p className="empty">불러오는 중…</p>; }

	const update = (id: string, patch: Partial<UsedTable>) => change({ ...data, tables: data.tables.map(t => t.id === id ? { ...t, ...patch } : t) });
	const add = () => change({ ...data, tables: [...data.tables, { id: crypto.randomUUID(), name: '', desc: '', crud: [], columns: [], keysOnly: false, ...nextSpot(data.tables.length) }] });
	const remove = (id: string) => change({ tables: data.tables.filter(t => t.id !== id), links: data.links.filter(l => l.from !== id && l.to !== id) });
	const toggle = (t: UsedTable, k: CrudKey) => update(t.id, { crud: CRUD.map(([c]) => c).filter(c => c === k ? !t.crud.includes(k) : t.crud.includes(c)) });
	const updateColumn = (t: UsedTable, id: string, patch: Partial<UsedColumn>) => update(t.id, { columns: t.columns.map(c => c.id === id ? { ...c, ...patch } : c) });
	const addColumn = (t: UsedTable) => update(t.id, { columns: [...t.columns, { id: crypto.randomUUID(), name: '', desc: '', type: '', pk: false }] });
	const removeColumn = (t: UsedTable, id: string) => update(t.id, { columns: t.columns.filter(c => c.id !== id) });
	/** 박스 더블클릭: 표의 그 행 이름 칸으로 */
	const openRow = (id: string) => { const input = document.querySelector<HTMLInputElement>(`.used-tables-list input[data-table-id="${id}"]`); input?.focus(); input?.select(); };
	const current = data.tables.find(t => t.id === selected);

	return <div className="used-tables"
		// 이 화면의 Ctrl+Z·Y는 입력칸 것만: VS Code로 넘어가면 화면 XML 문서가 되돌려진다
		onKeyDown={e => { if (isModKey(e.nativeEvent, 'z') || isModKey(e.nativeEvent, 'y')) { e.stopPropagation(); } }}>
		<div className="used-tables-bar">
			<span className="beta-badge">Beta</span>
			<span className="title">사용 테이블</span>
			<span className="where" title={status.file}>{status.file}</span>
			<button type="button" className="btn-tool" onClick={() => post({ type: 'chooseTablesFolder', pick: true })}>저장 위치 변경</button>
		</div>
		{status.error && <p className="error" role="alert">{status.error}</p>}
		<div className="used-tables-body">
			<div className="used-tables-list">
				<div className="used-tables-tools">
					<button type="button" className="btn-tool accent" onClick={add}><span className="codicon codicon-add" />테이블 추가</button>
				</div>
				{data.tables.length ? <table>
					<thead><tr><th>테이블</th><th>설명</th><th>CRUD</th><th aria-label="삭제" /></tr></thead>
					<tbody>{data.tables.map((t, i) => <tr key={t.id} className={t.id === selected ? 'selected' : undefined} onFocus={() => setSelected(t.id)}>
						<td><input className="mono" data-table-id={t.id} aria-label={`${i + 1}행 테이블`} value={t.name} placeholder="TB_NAME" onChange={e => update(t.id, { name: e.target.value })} /></td>
						<td><input aria-label={`${i + 1}행 설명`} value={t.desc} onChange={e => update(t.id, { desc: e.target.value })} /></td>
						<td><span className="crud-toggles">{CRUD.map(([k, label]) => <button key={k} type="button" className={`crud-${k}`} aria-pressed={t.crud.includes(k)}
							aria-label={`${i + 1}행 ${label}`} onClick={() => toggle(t, k)}>{label}</button>)}</span></td>
						<td><button type="button" className="btn-icon" title="삭제" aria-label={`${i + 1}행 삭제`} onClick={() => remove(t.id)}><span className="codicon codicon-trash" /></button></td>
					</tr>)}</tbody>
				</table> : <p className="table-empty">이 화면이 쓰는 테이블을 추가해 주세요.</p>}
				{current ? <section className="used-columns" aria-label={`${current.name || '테이블'} 컬럼`}>
					<div className="used-tables-tools">
						<span className="columns-title">컬럼 · <span className="mono">{current.name || '(이름 없음)'}</span></span>
						<button type="button" className="btn-tool accent" onClick={() => addColumn(current)}><span className="codicon codicon-add" />컬럼 추가</button>
					</div>
					{current.columns.length ? <table>
						<thead><tr><th>컬럼</th><th>설명</th><th>타입</th><th>PK</th><th aria-label="삭제" /></tr></thead>
						<tbody>{current.columns.map((c, i) => <tr key={c.id}>
							<td><input className="mono" aria-label={`${i + 1}번 컬럼`} value={c.name} placeholder="COLUMN_NAME" onChange={e => updateColumn(current, c.id, { name: e.target.value })} /></td>
							<td><input aria-label={`${i + 1}번 컬럼 설명`} value={c.desc} onChange={e => updateColumn(current, c.id, { desc: e.target.value })} /></td>
							<td><input className="mono" aria-label={`${i + 1}번 컬럼 타입`} value={c.type} placeholder="VARCHAR(20)" onChange={e => updateColumn(current, c.id, { type: e.target.value })} /></td>
							<td><input type="checkbox" aria-label={`${i + 1}번 컬럼 PK`} checked={c.pk} onChange={e => updateColumn(current, c.id, { pk: e.target.checked })} /></td>
							<td><button type="button" className="btn-icon" title="삭제" aria-label={`${i + 1}번 컬럼 삭제`} onClick={() => removeColumn(current, c.id)}><span className="codicon codicon-trash" /></button></td>
						</tr>)}</tbody>
					</table> : <p className="table-empty">컬럼이 없습니다. 컬럼 추가로 넣어 주세요.</p>}
				</section> : data.tables.length > 0 && <p className="used-tables-hint">테이블 행이나 그림의 박스를 하나 고르면 여기서 컬럼을 편집합니다.</p>}
				<ul className="used-tables-hint">
					<li>박스 끌기: 옮기기</li>
					<li>박스 옆 점 → 다른 박스: 선 잇기</li>
					<li>선 고르고 Delete: 선 지우기</li>
					<li>박스 클릭: 이어진 테이블 강조 · 더블클릭: 표의 그 행으로</li>
					<li>휠: 화면 이동 · Ctrl+휠: 확대·축소</li>
				</ul>
			</div>
			<UsedTablesDiagram data={data} selected={selected} onSelect={setSelected} onChange={change} onOpen={openRow} />
		</div>
	</div>;
}
