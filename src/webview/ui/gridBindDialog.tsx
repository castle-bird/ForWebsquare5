import { useState, type FormEvent } from 'react';
import { GRID_BIND_MODES, type GridBindMode, type GridExtras } from '../../core/grid';
import { PopupTitle, usePopupWindow } from './popupWindow';

export function GridBindDialog({ gridId, listId, columnCount, hasContent, onConfirm, onClose }: {
	gridId: string; listId: string; columnCount: number; hasContent: boolean; onConfirm(mode: GridBindMode, extras: GridExtras): void; onClose(): void;
}) {
	const [mode, setMode] = useState<GridBindMode>(hasContent ? 'bind' : 'new');
	const [extras, setExtras] = useState<GridExtras>({});
	const { titleProps, resizeHandles, popupProps } = usePopupWindow({ onClose });
	const submit = (e: FormEvent) => { e.preventDefault(); onConfirm(mode, extras); };
	const check = (label: string, checked: boolean, onChange?: (v: boolean) => void) => <label className={onChange ? '' : 'fixed'}>
		<input type="checkbox" checked={checked} aria-disabled={!onChange} tabIndex={onChange ? undefined : -1} onChange={e => onChange?.(e.target.checked)} />{label}
	</label>;
	return <dialog {...popupProps} className="popup submission-editor grid-bind" aria-label="그리드 바인딩">
		<form onSubmit={submit}>
			<PopupTitle titleProps={titleProps} badge="GridView" onClose={onClose}><span>{gridId || '(id 없음)'} ← {listId}</span></PopupTitle>
			<div className="submission-fields">
				<label htmlFor="grid-bind-mode">Option</label>
				<select id="grid-bind-mode" value={mode} onChange={e => setMode(e.target.value as GridBindMode)} autoFocus>
					{Object.entries(GRID_BIND_MODES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
				</select>
				<label>column count</label>
				<span className="grid-bind-count">{columnCount}</span>
			</div>
			<div className="grid-bind-parts">
				{check('header', mode === 'new' || mode === 'header' || mode === 'all')}
				{check('body', mode === 'new' || mode === 'body' || mode === 'all')}
				{check('subTotal', !!extras.subTotal, v => setExtras(c => ({ ...c, subTotal: v })))}
				{check('footer', !!extras.footer, v => setExtras(c => ({ ...c, footer: v })))}
			</div>
			<div className="submission-actions">
				<button type="submit" className="btn btn-primary">확인</button>
				<button type="button" className="btn btn-secondary" onClick={onClose}>닫기</button>
			</div>
		</form>
		{resizeHandles}
	</dialog>;
}
