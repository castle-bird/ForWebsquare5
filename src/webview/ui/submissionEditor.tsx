import { useState, type FormEvent } from 'react';
import { VALID_ID } from '../../core/xmlModel';
import { SUBMISSION_EVENTS, SUBMISSION_MEDIA_TYPES, SUBMISSION_METHODS, SUBMISSION_MODES, type SubmissionFields } from '../../core/submission';
import { PopupTitle, usePopupWindow } from './popupWindow';
import { ChoiceSelect } from './choiceSelect';

const MODE_LABELS: Record<string, string> = { asynchronous: '비동기', synchronous: '동기' };
const EVENT_LABELS: Record<typeof SUBMISSION_EVENTS[number], string> = { submit: 'submit', submitdone: 'submitdone', submiterror: 'submiterror' };

export function SubmissionEditor({ initial, editing, busy, externalError, offsetIndex = 0, onScript, onConfirm, onClose }: {
	initial: SubmissionFields; editing?: boolean; busy: boolean; externalError?: string; offsetIndex?: number;
	onScript?(eventName: string, current: string): string | undefined; onConfirm(fields: SubmissionFields): void; onClose(): void;
}) {
	const [fields, setFields] = useState(initial);
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
					</div>
				</section>
				<section>
					<h3>데이터</h3>
					<div className="form-grid">
						<label className="field"><span>요청 파라미터 (ref)</span>
							<textarea id="submission-ref" rows={3} placeholder="data:json,dataMap1" value={fields.ref} onChange={e => update('ref', e.target.value)} /></label>
						<label className="field"><span>응답 데이터 (target)</span>
							<textarea id="submission-target" rows={3} placeholder="data:json,dataList1" value={fields.target} onChange={e => update('target', e.target.value)} /></label>
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
			<div className="submission-actions">
				<button type="button" className="btn btn-secondary" onClick={onClose}>닫기</button>
				<button type="submit" className="btn btn-primary" disabled={busy}>확인</button>
			</div>
		</form>
		{resizeHandles}
	</dialog>;
}
