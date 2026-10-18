import { Fragment, useState, type FormEvent } from 'react';
import { VALID_ID } from '../../core/xmlModel';
import { DATA_REF_TYPES, formatDataRef, parseDataRef, REF_ACTIONS, SUBMISSION_EVENTS, SUBMISSION_MEDIA_TYPES, SUBMISSION_METHODS, SUBMISSION_MODES, TARGET_ACTIONS,
	type DataRefItem, type SubmissionFields } from '../../core/submission';
import { PopupActions, PopupTitle, usePopupWindow } from './popupWindow';
import { ChoiceSelect } from './choiceSelect';
import { Segmented } from './segmented';

const MODE_LABELS: Record<string, string> = { asynchronous: '비동기', synchronous: '동기' };
const EVENT_LABELS: Record<typeof SUBMISSION_EVENTS[number], string> = { submit: 'submit', submitdone: 'submitdone', submiterror: 'submiterror' };

const DATA_LABELS = { ref: '요청 파라미터 (ref)', target: '응답 데이터 (target)' };
type DataId = { id: string; list: boolean };

/** ref·target을 직접 타이핑하지 않고 DataMap·DataList와 동작을 골라 만든다 */
function DataRefPicker({ kind, value, dataIds, offsetIndex, onApply, onClose }: {
	kind: 'ref' | 'target'; value: string; dataIds: DataId[]; offsetIndex: number; onApply(value: string): void; onClose(): void;
}) {
	const parsed = parseDataRef(value);
	const [type, setType] = useState(parsed?.type ?? 'json');
	// 고른 항목(고른 순서대로 값에 들어감). 화면에 없는 id도 기존 값에 있으면 목록에 남긴다
	const [items, setItems] = useState<DataRefItem[]>(parsed?.items ?? []);
	const actions = kind === 'ref' ? REF_ACTIONS : TARGET_ACTIONS;
	const rows = [...dataIds, ...items.filter(i => !dataIds.some(d => d.id === i.id)).map(i => ({ id: i.id, list: true, missing: true }))];
	const toggle = (id: string, on: boolean) => setItems(curr => on ? [...curr, { id, action: '', key: '' }] : curr.filter(i => i.id !== id));
	const set = (id: string, patch: Partial<DataRefItem>) => setItems(curr => curr.map(item => item.id === id ? { ...item, ...patch } : item));
	const result = formatDataRef(type, items);
	// 서브미션 창 안에 펼치면 본문이 스크롤돼서 따로 띄운다(옮기기·크기 조절 가능)
	const { titleProps, resizeHandles, popupProps } = usePopupWindow({ initialOffset: offsetIndex, onClose });
	return <dialog {...popupProps} className="popup data-ref-popup" aria-label={`${DATA_LABELS[kind]} 데이터 선택`}>
		<PopupTitle titleProps={titleProps} badge="DataCollection" onClose={onClose}><span>{DATA_LABELS[kind]}</span></PopupTitle>
		<div className="data-ref-picker">
		<div className="data-ref-head"><span>형식</span>
			<Segmented aria-label="데이터 형식" value={type} options={DATA_REF_TYPES} onChange={setType} /></div>
		{!parsed && <p className="hint">기존 값을 해석하지 못했습니다. 적용하면 새 값으로 바뀝니다.</p>}
		{rows.length ? <div className="data-ref-rows">
			<span>데이터</span><span>Action</span><span>Key</span><span>순서</span>
			{rows.map(({ id, list, ...row }) => {
				const order = items.findIndex(i => i.id === id), item = items[order];
				return <Fragment key={id}>
					<label className="data-ref-id" title={'missing' in row ? '화면에 없는 데이터입니다' : undefined}>
						<input type="checkbox" checked={!!item} onChange={e => toggle(id, e.target.checked)} />
						<span className={'missing' in row ? 'missing' : undefined}>{id}</span><small>{'missing' in row ? '없음' : list ? 'List' : 'Map'}</small></label>
					<ChoiceSelect aria-label={`${id} Action`} value={item?.action ?? ''} options={actions} label={v => v || '(없음)'} disabled={!item || !list}
						title={list ? undefined : 'DataList에서만 고를 수 있습니다'} onChange={e => set(id, { action: e.target.value })} />
					<input aria-label={`${id} Key`} value={item?.key ?? ''} placeholder="(선택)" disabled={!item} onChange={e => set(id, { key: e.target.value })} />
					<span className="data-ref-order">{item ? order + 1 : ''}</span>
				</Fragment>;
			})}
		</div> : <p className="hint">DataCollection에 DataMap·DataList가 없습니다.</p>}
		<output className="data-ref-preview">{result || '(빈 값)'}</output>
		</div>
		<PopupActions onClose={onClose} onApply={() => onApply(result)} />
		{resizeHandles}
	</dialog>;
}

export function SubmissionEditor({ initial, editing, busy, externalError, offsetIndex = 0, dataIds = [], onScript, onConfirm, onClose }: {
	initial: SubmissionFields; editing?: boolean; busy: boolean; externalError?: string; offsetIndex?: number; dataIds?: DataId[];
	onScript?(eventName: string, current: string): string | undefined; onConfirm(fields: SubmissionFields): void; onClose(): void;
}) {
	const [fields, setFields] = useState(initial);
	const [picker, setPicker] = useState<'ref' | 'target'>();
	const title = editing ? '서브미션 수정' : '서브미션 추가';
	const [error, setError] = useState('');
	const { titleProps, resizeHandles, popupProps } = usePopupWindow({ initialOffset: offsetIndex, onClose });
	const update = (name: keyof SubmissionFields, value: string) => setFields(current => ({ ...current, [name]: value }));
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (!VALID_ID.test(fields.id)) { setError('올바른 ID를 입력해 주세요.'); return; }
		setError('');
		onConfirm(fields);
	};
	return <dialog {...popupProps} className="popup submission-editor" aria-label={title}>
		<form onSubmit={submit}>
			<PopupTitle titleProps={titleProps} badge="Submission" onClose={onClose}><span>{title}</span></PopupTitle>
			{/* 기본 · 데이터 · 이벤트로 묶고, 라벨은 입력칸 위(두 칸씩) */}
			<div className="form-sections">
				<section>
					<h3>기본</h3>
					<div className="form-grid">
						<label className="field"><span>서브미션 ID</span>
							<input id="submission-id" value={fields.id} onChange={e => update('id', e.target.value)} required autoFocus /></label>
						<label className="field"><span>요청 URL</span>
							<input id="submission-action" value={fields.action} placeholder="/path/to/action.do" onChange={e => update('action', e.target.value)} /></label>
						<div className="field"><span>HTTP 메서드 · 통신 방식</span>
							<div className="field-row">
								<ChoiceSelect id="submission-method" aria-label="HTTP 메서드" value={fields.method} options={SUBMISSION_METHODS} label={v => v.toUpperCase() || '(없음)'} onChange={e => update('method', e.target.value)} />
								<ChoiceSelect id="submission-mode" aria-label="통신 방식" value={fields.mode} options={SUBMISSION_MODES} label={v => MODE_LABELS[v] ?? (v || '(없음)')} onChange={e => update('mode', e.target.value)} />
							</div></div>
						<label className="field"><span>요청 데이터 형식</span>
							<ChoiceSelect id="submission-media" value={fields.mediatype} options={SUBMISSION_MEDIA_TYPES} label={v => v || '(없음)'} onChange={e => update('mediatype', e.target.value)} /></label>
						{/* processMsg: 값이 있으면 서브미션이 도는 동안 이 메시지 창을 띄운다 */}
						<label className="field wide"><span>처리 중 메시지</span>
							<input id="submission-processMsg" value={fields.processMsg} placeholder="조회중입니다..." onChange={e => update('processMsg', e.target.value)} /></label>
					</div>
				</section>
				<section>
					<h3>데이터</h3>
					<div className="form-grid">
						{(['ref', 'target'] as const).map(name => <div key={name} className="field">
							<div className="field-head"><label htmlFor={`submission-${name}`}>{DATA_LABELS[name]}</label>
								<button type="button" className="field-action" aria-expanded={picker === name} onClick={() => setPicker(picker === name ? undefined : name)}>
									<i className="codicon codicon-database" />데이터 선택</button></div>
							<textarea id={`submission-${name}`} rows={5} placeholder={name === 'ref' ? 'data:json,dataMap1' : 'data:json,dataList1'} value={fields[name]} onChange={e => update(name, e.target.value)} />
						</div>)}
					</div>
				</section>
				<section>
					<h3>이벤트 핸들러</h3>
					<div className="form-grid three">
						{SUBMISSION_EVENTS.map(eventName => {
							const name = `ev:${eventName}` as const;
							return <label key={eventName} className="field"><span>{EVENT_LABELS[eventName]}</span>
								<div className="submission-handler">
									<input id={`submission-${eventName}`} value={fields[name]} placeholder={`scwin.${fields.id}_${eventName}`} onChange={e => update(name, e.target.value)} />
									<button type="button" className="icon codicon codicon-code" disabled={!onScript} aria-label={`${EVENT_LABELS[eventName]} Script`}
										title={onScript ? 'Script: 없으면 만들고, 있으면 그 코드로 이동' : '확인으로 추가한 뒤 사용할 수 있습니다'}
										onClick={e => { e.preventDefault(); const handler = onScript?.(eventName, fields[name]); if (handler) { update(name, handler); } }} />
								</div></label>;
						})}
					</div>
				</section>
			</div>
			{(error || externalError) && <p className="error" role="alert">{error || externalError}</p>}
			<PopupActions onClose={onClose} applyDisabled={busy} />
		</form>
		{resizeHandles}
		{picker && <DataRefPicker key={picker} kind={picker} value={fields[picker]} dataIds={dataIds} offsetIndex={offsetIndex + 1}
			onApply={value => { update(picker, value); setPicker(undefined); }} onClose={() => setPicker(undefined)} />}
	</dialog>;
}
