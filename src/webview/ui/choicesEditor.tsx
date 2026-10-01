import { useState } from 'react';
import { readChoices, type ChoiceItem, type Choices, type ChoicesFields, type ItemSet } from '../../core/choices';
import { localName, type XmlNode } from '../../core/xmlModel';
import type { ComponentDef } from '../../core/protocol';
import { ChoiceSelect } from './choiceSelect';
import { PopupTitle, usePopupWindow } from './popupWindow';

export type ChoicesKind = 'selectbox' | 'radio' | 'checkbox' | 'gridSelect';

export function choicesKind(n: XmlNode, def?: ComponentDef): ChoicesKind | undefined {
	if (def?.realType === 'selectbox' || def?.realType === 'radio' || def?.realType === 'checkbox') { return def.realType; }
	return localName(n.tag) === 'column' && n.attrs.inputType === 'select' ? 'gridSelect' : undefined;
}
export interface DataSource { nodeset: string; fields: string[] }

type Row = ChoiceItem & { uid: number; checked: boolean };
const TITLES: Record<ChoicesKind, string> = { selectbox: 'SelectBox', radio: 'Radio', checkbox: 'Checkbox', gridSelect: 'Grid Select' };
const DIRECTIONS = ['none', 'cols', 'rows'];

export function ChoicesEditor({ node, kind, sources, externalError, offsetIndex = 0, onApply, onClose }: {
	node: XmlNode; kind: ChoicesKind; sources: DataSource[]; externalError?: string; offsetIndex?: number;
	onApply(fields: ChoicesFields): void; onClose(): void;
}) {
	const initial = readChoices(node);
	const readError = 'error' in initial ? initial.error : '';
	const start: Choices = 'error' in initial ? { items: [] } : initial;
	const [rows, setRows] = useState<Row[]>(() => start.items.map((it, uid) => ({ ...it, uid, checked: false })));
	const [nextUid, setNextUid] = useState(start.items.length);
	const [bind, setBind] = useState(!!start.itemset);
	const [itemset, setItemset] = useState<ItemSet>(start.itemset ?? { nodeset: '', label: '', value: '' });
	const [ref, setRef] = useState(node.attrs.ref ?? '');
	const [allOption, setAllOption] = useState(node.attrs.allOption === 'true');
	const [chooseOption, setChooseOption] = useState(node.attrs.chooseOption === 'true');
	const [chooseLabel, setChooseLabel] = useState(node.attrs.chooseOptionLabel ?? '');
	const startDirection = node.attrs.cols ? 'cols' : node.attrs.rows ? 'rows' : 'none';
	const startCount = node.attrs.cols || node.attrs.rows || '';
	const [direction, setDirection] = useState(startDirection);
	const [count, setCount] = useState(startCount);
	const [error, setError] = useState('');
	const { titleProps, resizeHandles, popupProps } = usePopupWindow({ initialOffset: offsetIndex, onClose });
	const spread = kind === 'radio' || kind === 'checkbox';

	const update = (uid: number, change: Partial<Row>) => setRows(current => current.map(r => r.uid === uid ? { ...r, ...change } : r));
	const insert = () => {
		const last = rows.map(r => r.checked).lastIndexOf(true);
		const at = last < 0 ? rows.length : last + 1;
		setRows([...rows.slice(0, at), { uid: nextUid, label: '', value: '', checked: false }, ...rows.slice(at)]);
		setNextUid(nextUid + 1);
	};
	const move = (by: -1 | 1) => setRows(current => {
		const next = [...current];
		const order = by < 0 ? next.map((_, i) => i) : next.map((_, i) => next.length - 1 - i);
		for (const i of order) {
			const j = i + by;
			if (next[i].checked && next[j] && !next[j].checked) { [next[i], next[j]] = [next[j], next[i]]; }
		}
		return next;
	});
	const anyChecked = rows.some(r => r.checked);
	const fieldsOf = (nodeset: string) => sources.find(s => s.nodeset === nodeset)?.fields ?? [];

	const apply = () => {
		if (bind && !itemset.nodeset) { setError('바인딩할 NodeSet을 골라 줘.'); return; }
		if (spread && direction !== 'none' && !/^[1-9]\d*$/.test(count)) { setError('Span Count는 1 이상의 정수로 적어 줘.'); return; }
		setError('');
		const orEmpty = (name: string, value: string) => value || (node.attrs[name] === '' ? '' : undefined);
		const attrs: Record<string, string | undefined> = { ref: orEmpty('ref', ref) };
		if (!spread) {
			if (allOption !== (node.attrs.allOption === 'true')) { attrs.allOption = allOption ? 'true' : undefined; }
			if (chooseOption !== (node.attrs.chooseOption === 'true')) { attrs.chooseOption = chooseOption ? 'true' : undefined; }
			if (chooseOption) { attrs.chooseOptionLabel = orEmpty('chooseOptionLabel', chooseLabel); }
		} else if (direction !== startDirection || count !== startCount) {
			attrs.cols = direction === 'cols' ? count : orEmpty('cols', '');
			attrs.rows = direction === 'rows' ? count : orEmpty('rows', '');
		}
		onApply({ items: rows.map(({ label, value }) => ({ label, value })), itemset: bind ? itemset : undefined, attrs });
	};

	return <dialog {...popupProps} className="popup choices-editor" aria-label={`${node.attrs.id ?? TITLES[kind]} 선택 항목`}>
		<PopupTitle titleProps={titleProps} badge={TITLES[kind]} onClose={onClose}><span>{node.attrs.id ?? '(id 없음)'}</span></PopupTitle>
		<div className="data-editor-body" aria-disabled={bind || undefined}>
			<div className="data-editor-tools">
				<button type="button" className="btn-icon" onClick={insert} disabled={bind} title="행 추가(체크한 행 뒤, 없으면 끝)" aria-label="행 추가"><span className="codicon codicon-add" /></button>
				<button type="button" className="btn-icon" onClick={() => setRows(rows.filter(r => !r.checked))} disabled={bind || !anyChecked} title="체크한 행 삭제" aria-label="행 삭제"><span className="codicon codicon-remove" /></button>
				<button type="button" className="btn-icon" onClick={() => move(-1)} disabled={bind || !anyChecked} title="위로 이동" aria-label="위로 이동"><span className="codicon codicon-arrow-up" /></button>
				<button type="button" className="btn-icon" onClick={() => move(1)} disabled={bind || !anyChecked} title="아래로 이동" aria-label="아래로 이동"><span className="codicon codicon-arrow-down" /></button>
			</div>
			<div className="data-editor-table-wrap">
				<table style={{ width: '100%' }}>
					<colgroup><col style={{ width: 36 }} /><col /><col /></colgroup>
					<thead><tr>
						<th><input type="checkbox" aria-label="모두 선택" disabled={bind} checked={anyChecked && rows.every(r => r.checked)}
							onChange={e => setRows(rows.map(r => ({ ...r, checked: e.target.checked })))} /></th>
						<th>Label</th><th>Value</th>
					</tr></thead>
					<tbody>{rows.map((r, i) => <tr key={r.uid} className={r.checked ? 'selected' : undefined}>
						<td><input type="checkbox" aria-label={`${i + 1}행 선택`} disabled={bind} checked={r.checked} onChange={e => update(r.uid, { checked: e.target.checked })} /></td>
						<td><input aria-label={`${i + 1}행 Label`} disabled={bind} value={r.label} onChange={e => update(r.uid, { label: e.target.value })} /></td>
						<td><input aria-label={`${i + 1}행 Value`} disabled={bind} value={r.value} onChange={e => update(r.uid, { value: e.target.value })} /></td>
					</tr>)}</tbody>
				</table>
			</div>
		</div>
		<div className="choices-section">
			<label className="choices-check"><input type="checkbox" checked={bind} onChange={e => setBind(e.target.checked)} /> BindItemSet</label>
			<div className="submission-fields">
				<label htmlFor="choices-nodeset">NodeSet</label>
				<ChoiceSelect id="choices-nodeset" disabled={!bind} value={itemset.nodeset} options={['', ...sources.map(s => s.nodeset)]}
					onChange={e => setItemset({ nodeset: e.target.value, label: '', value: '' })} />
				<label htmlFor="choices-label">Label</label>
				<ChoiceSelect id="choices-label" disabled={!bind} value={itemset.label} options={['', ...fieldsOf(itemset.nodeset)]} onChange={e => setItemset({ ...itemset, label: e.target.value })} />
				<label htmlFor="choices-value">Value</label>
				<ChoiceSelect id="choices-value" disabled={!bind} value={itemset.value} options={['', ...fieldsOf(itemset.nodeset)]} onChange={e => setItemset({ ...itemset, value: e.target.value })} />
			</div>
		</div>
		<div className="choices-section submission-fields">
			<label htmlFor="choices-ref">ref</label>
			<input id="choices-ref" value={ref} placeholder="예: data:dataMap1.key" onChange={e => setRef(e.target.value)} />
		</div>
		{!spread
			? <div className="choices-section">
				<label className="choices-check"><input type="checkbox" checked={allOption} onChange={e => setAllOption(e.target.checked)} /> All Option <span className="choices-hint">(-전체-, 값 all)</span></label>
				<div className="choices-inline">
					<label className="choices-check"><input type="checkbox" checked={chooseOption} onChange={e => setChooseOption(e.target.checked)} /> Choose Option</label>
					<input aria-label="Choose Option 문구" disabled={!chooseOption} value={chooseLabel} placeholder="-선택-" onChange={e => setChooseLabel(e.target.value)} />
				</div>
			</div>
			: <div className="choices-section submission-fields">
				<label htmlFor="choices-direction">Span Direction</label>
				<ChoiceSelect id="choices-direction" value={direction} options={DIRECTIONS} onChange={e => setDirection(e.target.value)} />
				<label htmlFor="choices-count">Span Count</label>
				<input id="choices-count" inputMode="numeric" disabled={direction === 'none'} value={count} onChange={e => setCount(e.target.value)} />
			</div>}
		{(readError || error || externalError) && <p className="error" role="alert">{readError || error || externalError}</p>}
		<div className="data-editor-actions">
			<button type="button" className="btn btn-primary" disabled={!!readError} onClick={apply}>확인</button>
			<button type="button" className="btn btn-secondary" onClick={onClose}>닫기</button>
		</div>
		{resizeHandles}
	</dialog>;
}
