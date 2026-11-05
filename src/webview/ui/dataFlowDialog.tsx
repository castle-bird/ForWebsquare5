import type { ReactNode } from 'react';
import type { FlowSide, SubmissionFlow } from '../../core/dataFlow';
import { post, useEditorStore } from '../store';
import { PopupTitle, usePopupWindow } from './popupWindow';

/** 길어서 줄이 바뀔 때 `_`·`.`·`/` 뒤에서만 끊는다(글자 중간에서 끊기면 읽기 어렵다) */
const soft = (text: string) => text.split(/(?<=[._/])/).flatMap((part, i) => i ? [<wbr key={i} />, part] : [part]);

type Pick = { onSelect(index: number): void; onOpen(index: number): void };

/** 이름을 누르면 선택, 바로 옆 연필 버튼을 누르면 편집 팝업 */
function Item({ kind, name, title, index, onSelect, onOpen, children }: Pick & { kind: string; name: string; title: string; index: number; children: ReactNode }) {
	return <span className="flow-item">
		<button type="button" className={`flow-data ${kind}`} title={title} onClick={() => onSelect(index)}>{children}</button>
		<button type="button" className="flow-edit codicon codicon-edit" title="편집 팝업 열기" aria-label={`${name} 편집`} onClick={() => onOpen(index)} />
	</span>;
}

function FlowSideView({ side, label, onSelect, onOpen }: Pick & { side: FlowSide; label: string }) {
	if (side.raw) { return <div className="flow-side"><span className="flow-raw" title={`${label} 값을 해석하지 못했습니다`}>{side.raw}</span></div>; }
	if (!side.items.length) { return <div className="flow-side"><span className="flow-none">없음</span></div>; }
	// 같은 id가 두 번 적힐 수 있어 key는 순서
	return <div className="flow-side">{side.items.map(({ id, action, key, data }, i) => {
		if (!data) { return <span key={i} className="flow-data missing" title="화면에 이 id의 데이터가 없습니다"><span className="flow-kind">?</span><span className="flow-id">{soft(id)}</span></span>; }
		const kind = data.kind.endsWith('List') ? 'list' : 'map';
		return <Item key={i} kind={kind} name={id} index={data.index} onSelect={onSelect} onOpen={onOpen} title={`${data.kind} ${id}${data.fields.length ? `\n${data.fields.join(', ')}` : ''}`}>
			<span className={`flow-kind ${kind}`}>{kind === 'list' ? 'List' : 'Map'}</span><span className="flow-id">{soft(id)}</span>
			{action && <span className="flow-action">{action}</span>}{key && <span className="flow-action">key={key}</span>}</Item>;
	})}</div>;
}

/** 현재 화면의 Submission별 요청(ref)·응답(target) 데이터와 Controller 관계. 읽기 전용이고 팝업이라 Script·Java 탭을 보며 열어 둘 수 있다 */
export function DataFlowDialog({ flows, onSelect, onOpen, onClose }: {
	flows: SubmissionFlow[]; onSelect(index: number): void; onOpen(index: number): void; onClose(): void;
}) {
	const { titleProps, resizeHandles, popupProps } = usePopupWindow({ onClose });
	const panelFont = useEditorStore(s => s.panelFont);
	return <dialog {...popupProps} className="popup submission-editor data-flow" data-panel-font={panelFont} aria-label="데이터 흐름">
		<PopupTitle titleProps={titleProps} badge="Submission" onClose={onClose}><span>데이터 흐름</span></PopupTitle>
		<div className="data-flow-body">
			{flows.length ? <>
				<div className="flow-row flow-head"><span>#</span><span>Submission</span><span>요청 (ref)</span><span>응답 (target)</span><span>Controller</span></div>
				{flows.map((flow, i) => <div className="flow-row" key={flow.index}>
					<span className="flow-no" title={`${i + 1}번째 Submission`}>{i + 1}</span>
					<div className="flow-column">
						<Item kind="submission" name={flow.id || 'Submission'} index={flow.index} title={`submission ${flow.id}`} onSelect={onSelect} onOpen={onOpen}>
							<span className="flow-id">{flow.id ? soft(flow.id) : '(id 없음)'}</span>
							{flow.method && <span className="flow-action">{flow.method}</span>}</Item>
						{flow.handlers.map(h => <div className="flow-handler" key={h.event} title={`ev:${h.event}`}><span>{h.event}</span><code>{soft(h.handler)}</code></div>)}
					</div>
					<FlowSideView side={flow.request} label="ref" onSelect={onSelect} onOpen={onOpen} />
					<FlowSideView side={flow.response} label="target" onSelect={onSelect} onOpen={onOpen} />
					<div className="flow-column">
						<span className="flow-item">
							<span className="flow-url" title={flow.action}>{flow.action ? soft(flow.action) : '(action 없음)'}</span>
							<button type="button" className="flow-edit flow-go codicon codicon-go-to-file" disabled={!flow.action.trim()} title="Controller 메서드로 이동" aria-label="Controller 이동"
								onClick={() => post({ type: 'openAction', action: flow.action })} />
						</span>
					</div>
				</div>)}
			</> : <p className="flow-empty">이 화면에는 Submission이 없습니다.</p>}
		</div>
		<p className="flow-notice"><i className="codicon codicon-info" aria-hidden="true" />XML에 선언된 항목만 보여 줍니다. Script에서 동적으로 만든 dataList·dataMap·Submission은 보이지 않을 수 있습니다.</p>
		<div className="submission-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>닫기</button></div>
		{resizeHandles}
	</dialog>;
}
