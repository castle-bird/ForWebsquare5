// ERD 탭 > 사용 테이블: 화면이 쓰는 DB 테이블·메모·그룹을 그림(ERD) 안에서 바로 적고 잇는다(ui/usedTablesDiagram.tsx).
// 저장은 확장이 이 PC의 고른 폴더에 화면별 JSON으로(고칠 때마다 잠깐 모았다가). 화면 XML은 건드리지 않는다
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UsedTables } from '../../core/tables';
import type { ToWebview } from '../../core/protocol';
import { post } from '../store';
import { isModKey } from '../keys';
import { UsedTablesDiagram } from './usedTablesDiagram';

type Status = Omit<Extract<ToWebview, { type: 'usedTables' }>, 'type'>;
export type Edit = (next: UsedTables | ((current: UsedTables) => UsedTables)) => void;
const SAVE_DELAY = 400;
/** 되돌리기 칸 수 */
const HISTORY = 200;

/**
 * 확장과 주고받기: 처음에 읽고(저장 폴더를 안 골랐으면 status.folder 없음), change는 바로 그리고 잠깐 모았다가 저장. 닫힐 때 남은 것 저장.
 * 그림 편집은 이 웹뷰 안에서만 되돌린다(VS Code Undo는 화면 XML 것). 확장이 새로 읽어 보내면 기록을 비운다
 */
function useUsedTables() {
	const [status, setStatus] = useState<Status>();
	const [data, setData] = useState<UsedTables>();
	const current = useRef<UsedTables>(undefined);
	const past = useRef<UsedTables[]>([]);
	const future = useRef<UsedTables[]>([]);
	const timer = useRef<number>(undefined);
	const pending = useRef<UsedTables>(undefined);
	const flush = useCallback(() => {
		clearTimeout(timer.current);
		if (pending.current) { post({ type: 'saveUsedTables', data: pending.current }); pending.current = undefined; }
	}, []);
	const show = useCallback((next: UsedTables) => {
		current.current = next;
		setData(next);
		pending.current = next;
		clearTimeout(timer.current);
		timer.current = window.setTimeout(flush, SAVE_DELAY);
	}, [flush]);
	const change = useCallback<Edit>(next => {
		const before = current.current;
		if (!before) { return; }
		const after = typeof next === 'function' ? next(before) : next;
		if (after === before) { return; }
		past.current = [...past.current.slice(1 - HISTORY), before];
		future.current = [];
		show(after);
	}, [show]);
	const step = useCallback((back: boolean) => {
		const [from, to] = back ? [past, future] : [future, past];
		const next = from.current.at(-1);
		if (!next || !current.current) { return; }
		from.current = from.current.slice(0, -1);
		to.current = [...to.current, current.current];
		show(next);
	}, [show]);
	useEffect(() => {
		const on = (e: MessageEvent<ToWebview>) => {
			if (e.data.type !== 'usedTables') { return; }
			const { type: _, ...next } = e.data;
			setStatus(next);
			if (next.data) { current.current = next.data; past.current = []; future.current = []; setData(next.data); }
		};
		window.addEventListener('message', on);
		post({ type: 'loadUsedTables' });
		return () => { window.removeEventListener('message', on); flush(); };
	}, [flush]);
	return { status, data, change, undo: () => step(true), redo: () => step(false), canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}

export function UsedTablesPane() {
	const { status, data, change, undo, redo, canUndo, canRedo } = useUsedTables();

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

	return <div className="used-tables"
		// 입력칸의 Ctrl+Z·Y는 입력칸 것만: VS Code로 넘어가면 화면 XML 문서가 되돌려진다
		onKeyDown={e => { if (isModKey(e.nativeEvent, 'z') || isModKey(e.nativeEvent, 'y')) { e.stopPropagation(); } }}>
		<div className="used-tables-bar">
			<span className="title">사용 테이블</span>
			<span className="where" title={status.file}>{status.file}</span>
			<button type="button" className="btn-tool" onClick={() => post({ type: 'chooseTablesFolder', pick: true })}>저장 위치 변경</button>
		</div>
		{status.error && <p className="error" role="alert">{status.error}</p>}
		<UsedTablesDiagram data={data} onChange={change} onUndo={undo} onRedo={redo} canUndo={canUndo} canRedo={canRedo} />
	</div>;
}
