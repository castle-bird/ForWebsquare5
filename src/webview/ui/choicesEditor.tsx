import { useState } from 'react';
import { readChoices, type ChoiceItem, type Choices, type ChoicesFields, type ItemSet } from '../../core/choices';
import { localName, type XmlNode } from '../../core/xmlModel';
import type { ComponentDef } from '../../core/protocol';
import { ComboInput } from './combo';
import { PopupTitle, usePopupWindow } from './popupWindow';
import { useRowDrag } from './rowDrag';
import { Segmented } from './segmented';

export type ChoicesKind = 'selectbox' | 'checkcombobox' | 'multiselect' | 'multiupload' | 'radio' | 'checkbox' | 'gridSelect';

export function choicesKind(n: XmlNode, def?: ComponentDef): ChoicesKind | undefined {
	if (def && ['selectbox', 'checkcombobox', 'multiselect', 'multiupload', 'radio', 'checkbox'].includes(def.realType)) { return def.realType as ChoicesKind; }
	return localName(n.tag) === 'column' && n.attrs.inputType === 'select' ? 'gridSelect' : undefined;
}
interface DataSource { nodeset: string; fields: string[] }

type Row = ChoiceItem & { uid: number; checked: boolean };
const TITLES: Record<ChoicesKind, string> = { selectbox: 'SelectBox', checkcombobox: 'CheckComboBox', multiselect: 'MultiSelect', multiupload: 'Multiupload', radio: 'Radio', checkbox: 'Checkbox', gridSelect: 'Grid Select' };
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
	// All·Choose Option은 펼친 목록이 있는 것만(multiselect는 목록 자체가 보여서 없음)
	const options = !spread && kind !== 'multiselect' && kind !== 'multiupload';
	// multiupload 파라미터(param name·value): 같은 표만, 데이터 바인딩·ref 없음
	const params = kind === 'multiupload';
	const { handleProps, rowProps, dropClass } = useRowDrag(setRows);

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
		if (bind && !itemset.nodeset) { setError('바인딩할 NodeSet을 골라 주세요.'); return; }
		if (spread && direction !== 'none' && !/^[1-9]\d*$/.test(count)) { setError('Span Count는 1 이상의 정수로 적어 주세요.'); return; }
		setError('');
		const orEmpty = (name: string, value: string) => value || (node.attrs[name] === '' ? '' : null);
		const attrs: Record<string, string | null> = { ref: orEmpty('ref', ref) };
		if (options) {
			if (allOption !== (node.attrs.allOption === 'true')) { attrs.allOption = allOption ? 'true' : null; }
			if (chooseOption !== (node.attrs.chooseOption === 'true')) { attrs.chooseOption = chooseOption ? 'true' : null; }
			if (chooseOption) { attrs.chooseOptionLabel = orEmpty('chooseOptionLabel', chooseLabel); }
		} else if (spread && (direction !== startDirection || count !== startCount)) {
			attrs.cols = direction === 'cols' ? count : orEmpty('cols', '');
			attrs.rows = direction === 'rows' ? count : orEmpty('rows', '');
		}
		onApply({ items: rows.map(({ label, value }) => ({ label, value })), itemset: bind ? itemset : undefined, attrs });
	};

	return <dialog {...popupProps} className={'popup choices-editor' + (params ? ' params' : '')} aria-label={`${node.attrs.id ?? TITLES[kind]} 선택 항목`}>
		<PopupTitle titleProps={titleProps} badge={TITLES[kind]} onClose={onClose}>
			<span className="mono">{node.attrs.id ?? '(id 없음)'}</span><span className="popup-meta">· {params ? '파라미터' : '항목'} {rows.length}</span>
		</PopupTitle>
		{/* 항목 · 데이터에서 가져오기(itemset) · 값 연결과 옵션. 섹션 제목 줄에 도구, 라벨은 입력칸 위 */}
		<div className="form-sections choices-sections">
			<section className="choices-items" aria-disabled={bind || undefined}>
				<h3>{params ? '파라미터' : '항목'}
					<span className="section-tools">
						<button type="button" className="btn-tool accent" onClick={insert} disabled={bind} title="체크한 행 뒤에, 없으면 끝에 추가" aria-label="행 추가"><span className="codicon codicon-add" />항목 추가</button>
						<button type="button" className="btn-tool" onClick={() => setRows(rows.filter(r => !r.checked))} disabled={bind || !anyChecked} title="체크한 행 삭제" aria-label="행 삭제"><span className="codicon codicon-trash" />삭제</button>
						<button type="button" className="btn-icon" onClick={() => move(-1)} disabled={bind || !anyChecked} title="위로 이동" aria-label="위로 이동"><span className="codicon codicon-arrow-up" /></button>
						<button type="button" className="btn-icon" onClick={() => move(1)} disabled={bind || !anyChecked} title="아래로 이동" aria-label="아래로 이동"><span className="codicon codicon-arrow-down" /></button>
					</span>
				</h3>
				<div className="data-editor-body">
					<div className="data-editor-table-wrap">
						<table style={{ width: '100%' }}>
							<colgroup><col style={{ width: 48 }} /><col style={{ width: 32 }} /><col /><col /></colgroup>
							<thead><tr>
								<th>No</th>
								<th><input type="checkbox" aria-label="모두 선택" disabled={bind} checked={anyChecked && rows.every(r => r.checked)}
									onChange={e => setRows(rows.map(r => ({ ...r, checked: e.target.checked })))} /></th>
								{params ? <><th>Name</th><th>Value</th></> : <><th>Label (화면 글자)</th><th>Value (저장 값)</th></>}
							</tr></thead>
							<tbody>{rows.map((r, i) => <tr key={r.uid} className={`${r.checked ? 'selected' : ''} ${dropClass(r.uid)}`} {...bind ? {} : rowProps(r.uid)}>
								<td><button type="button" className="data-row-handle" disabled={bind} title="끌어서 행 이동" aria-label={`${i + 1}행 이동`} {...bind ? {} : handleProps(r.uid)}>⠿ {i + 1}</button></td>
								<td><input type="checkbox" aria-label={`${i + 1}행 선택`} disabled={bind} checked={r.checked} onChange={e => update(r.uid, { checked: e.target.checked })} /></td>
								<td><input aria-label={`${i + 1}행 Label`} disabled={bind} value={r.label} placeholder={params ? 'name' : '항목 이름'} onChange={e => update(r.uid, { label: e.target.value })} /></td>
								<td><input aria-label={`${i + 1}행 Value`} disabled={bind} value={r.value} placeholder="값" onChange={e => update(r.uid, { value: e.target.value })} /></td>
							</tr>)}</tbody>
						</table>
						{!rows.length && <p className="table-empty">{bind ? '데이터에서 가져온 항목을 씁니다.' : params ? '파라미터가 없습니다. 항목 추가로 넣어 주세요.' : '항목이 없습니다. 항목 추가로 넣거나 아래에서 데이터에서 가져오기를 켜 주세요.'}</p>}
					</div>
				</div>
			</section>
			{!params && <><section>
				<h3>
					<label className="choices-check switch-label"><input type="checkbox" className="switch" checked={bind} onChange={e => setBind(e.target.checked)} />
						<span className="switch-text">데이터에서 가져오기</span> <span className="mono">itemset</span></label>
					<span className="section-hint">켜면 위 항목 대신 사용</span>
				</h3>
				<div className="form-grid itemset" aria-disabled={!bind || undefined}>
					<label className="field"><span>NodeSet</span>
						{/* 화면에서 만드는 dataList처럼 목록에 없는 것도 바인딩하게 직접 입력도 받는다. 목록에서 다른 걸 고르면 Label·Value 비움 */}
						<ComboInput id="choices-nodeset" disabled={!bind} value={itemset.nodeset} options={sources.map(s => s.nodeset)}
							onValue={nodeset => setItemset({ ...itemset, nodeset })}
							onPick={nodeset => setItemset(nodeset === itemset.nodeset ? itemset : { nodeset, label: '', value: '' })} /></label>
					<label className="field"><span>Label</span>
						<ComboInput id="choices-label" disabled={!bind} value={itemset.label} options={fieldsOf(itemset.nodeset)}
							onValue={label => setItemset({ ...itemset, label })} onPick={label => setItemset({ ...itemset, label })} /></label>
					<label className="field"><span>Value</span>
						<ComboInput id="choices-value" disabled={!bind} value={itemset.value} options={fieldsOf(itemset.nodeset)}
							onValue={value => setItemset({ ...itemset, value })} onPick={value => setItemset({ ...itemset, value })} /></label>
				</div>
			</section>
			<section>
				<h3>{options || spread ? '값 연결 · 옵션' : '값 연결'}</h3>
				<div className="form-grid">
					<label className="field wide"><span>ref (고른 값을 넣을 곳)</span>
						<input id="choices-ref" value={ref} placeholder="data:dataMap1.key" onChange={e => setRef(e.target.value)} /></label>
					{spread
						? <>
							<div className="field"><span>Span Direction</span>
								<Segmented id="choices-direction" aria-label="Span Direction" value={direction} options={DIRECTIONS} onChange={setDirection} /></div>
							<label className="field"><span>Span Count</span>
								<input id="choices-count" inputMode="numeric" disabled={direction === 'none'} value={count} onChange={e => setCount(e.target.value)} /></label>
						</>
						: options && <div className="field wide choices-options">
							<label className="choices-check"><input type="checkbox" checked={allOption} onChange={e => setAllOption(e.target.checked)} /> All Option <span className="choices-hint">(-전체-, 값 all)</span></label>
							<div className="choices-inline">
								<label className="choices-check"><input type="checkbox" checked={chooseOption} onChange={e => setChooseOption(e.target.checked)} /> Choose Option</label>
								<input aria-label="Choose Option 문구" disabled={!chooseOption} value={chooseLabel} placeholder="-선택-" onChange={e => setChooseLabel(e.target.value)} />
							</div>
						</div>}
				</div>
			</section></>}
		</div>
		{(readError || error || externalError) && <p className="error" role="alert">{readError || error || externalError}</p>}
		<div className="data-editor-actions">
			<button type="button" className="btn btn-secondary" onClick={onClose}>닫기</button>
			<button type="button" className="btn btn-primary" disabled={!!readError} onClick={apply}>확인</button>
		</div>
		{resizeHandles}
	</dialog>;
}
