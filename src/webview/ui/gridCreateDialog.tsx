import { useEffect, useState, type FormEvent } from 'react';
import { listColumns } from '../../core/grid';
import { INSERT_POSITION_LABELS, insertPositions } from '../../core/palette';
import type { InsertPosition } from '../../core/paste';
import type { ToWebview } from '../../core/protocol';
import type { XmlNode } from '../../core/xmlModel';
import { post } from '../store';
import { PopupActions, PopupTitle, usePopupWindow } from './popupWindow';

const PARTS = [['header', 'Header'], ['body', 'Body'], ['subTotal', 'subTotal'], ['footer', 'footer']] as const;
type Part = typeof PARTS[number][0];
const digits = (value: string) => value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const validCount = (value: string, max: number) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max;

export function GridCreateDialog({ target, lists, version, onClose }: { target: XmlNode; lists: XmlNode[]; version: number; onClose(): void }) {
	const positions = insertPositions(target);
	const [position, setPosition] = useState<InsertPosition>(positions.includes('inside') ? 'inside' : 'after');
	const [list, setList] = useState('');
	const [columns, setColumns] = useState('3');
	const [enabled, setEnabled] = useState<Record<Part, boolean>>({ header: true, body: true, subTotal: false, footer: false });
	const [rows, setRows] = useState<Record<Part, string>>({ header: '1', body: '1', subTotal: '1', footer: '1' });
	const [pending, setPending] = useState(false), [error, setError] = useState('');
	const { titleProps, resizeHandles, popupProps } = usePopupWindow({ onClose, autoHeight: true });
	useEffect(() => {
		const receive = (e: MessageEvent<ToWebview>) => {
			if (e.data.type !== 'popupAck' || e.data.popup !== 'createGrid') { return; }
			setPending(false);
			if (e.data.ok) { onClose(); } else { setError(e.data.error ?? '그리드를 만들지 못했습니다.'); }
		};
		window.addEventListener('message', receive);
		return () => window.removeEventListener('message', receive);
	}, [onClose]);
	const chosen = lists.find(n => String(n.index) === list);
	const listCount = chosen ? listColumns(chosen).length : 0;
	const disabled = pending || !validCount(columns, 100) || !PARTS.some(([key]) => enabled[key])
		|| PARTS.some(([key]) => enabled[key] && !validCount(rows[key], 10)) || !!list && !listCount;
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (disabled) { return; }
		setPending(true); setError('');
		const count = (part: Part) => enabled[part] ? Number(rows[part]) : 0;
		post({ type: 'createGrid', version, index: target.index, popup: 'createGrid', position, options: {
			columns: Number(columns), headerRows: count('header'), bodyRows: count('body'), subTotalRows: count('subTotal'), footerRows: count('footer'),
			...chosen && { list: chosen.index },
		} });
	};
	return <dialog {...popupProps} className="popup submission-editor grid-create" aria-label="그리드 만들기">
		<form onSubmit={submit}>
			<PopupTitle titleProps={titleProps} badge="GridView" onClose={onClose}><span>그리드 만들기</span></PopupTitle>
			<div className="form-sections"><section>
				<div className="form-grid">
					<label className="field"><span>dataList</span><select aria-label="dataList" value={list} onChange={e => {
						const value = e.target.value, selected = lists.find(n => String(n.index) === value);
						setList(value); if (selected && listColumns(selected).length) { setColumns(String(listColumns(selected).length)); }
					}}><option value="">연결 안 함</option>{lists.map(n => <option key={n.index} value={n.index}>{n.attrs.id} ({listColumns(n).length}열)</option>)}</select></label>
					<label className="field"><span>열 수 (1–100)</span><input aria-label="열 수" type="text" inputMode="numeric" aria-invalid={!validCount(columns, 100)} value={columns} onChange={e => setColumns(digits(e.target.value))} /></label>
					<label className="field wide"><span>삽입 위치: {target.attrs.id || target.tag}</span><select value={position} onChange={e => setPosition(e.target.value as InsertPosition)}>{positions.map(p => <option key={p} value={p}>{INSERT_POSITION_LABELS[p]}</option>)}</select></label>
				</div>
				<h3 className="grid-create-heading">만들 구역과 행 수 (1–10)</h3>
				<div className="grid-create-parts">{PARTS.map(([key, label]) => <div className="grid-create-part" key={key}>
					<label><input type="checkbox" checked={enabled[key]} onChange={e => setEnabled(old => ({ ...old, [key]: e.target.checked }))} />{label}</label>
					<input aria-label={`${label} 행 수`} type="text" inputMode="numeric" disabled={!enabled[key]} aria-invalid={enabled[key] && !validCount(rows[key], 10)} value={rows[key]} onChange={e => setRows(old => ({ ...old, [key]: digits(e.target.value) }))} />
				</div>)}</div>
				<div className="grid-create-notice"><span className="codicon codicon-info" aria-hidden="true" /><p>선택한 dataList의 컬럼을 앞에서부터 반영합니다. 열이 더 많으면 빈 컬럼을 만듭니다.</p></div>
				<div className="grid-create-message">
					{error ? <p role="alert">{error}</p>
						: disabled && !pending ? <p role="alert">구역을 선택하고 열 수와 행 수를 범위에 맞게 입력해 주세요.</p> : null}
				</div>
			</section></div>
			<PopupActions onClose={onClose} applyDisabled={disabled} />
		</form>{resizeHandles}
	</dialog>;
}
