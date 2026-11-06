import type { ReactNode } from 'react';
import type { FlowSide, SubmissionFlow } from '../../core/dataFlow';
import { post, useEditorStore } from '../store';
import { PopupTitle, usePopupWindow } from './popupWindow';

/** 길어서 줄이 바뀔 때 `_`·`.`·`/` 뒤에서만 끊는다(글자 중간에서 끊기면 읽기 어렵다) */
const soft = (text: string) => text.split(/(?<=[._/])/).flatMap((part, i) => i ? [<wbr key={i} />, part] : [part]);

type Pick = { onSelect(index: number): void; onOpen(index: number): void };

/** 이름을 누르면 선택, 더블클릭하거나 바로 옆 연필 버튼을 누르면 편집 팝업(Data 탭 더블클릭과 같다) */
function Item({ kind, name, title, index, onSelect, onOpen, children }: Pick & { kind: string; name: string; title: string; index: number; children: ReactNode }) {
	return <span className="flow-item">
		<button type="button" className={`flow-data ${kind}`} title={title} onClick={() => onSelect(index)} onDoubleClick={() => onOpen(index)}>{children}</button>
		<button type="button" className="flow-edit codicon codicon-edit" title="편집 팝업 열기" aria-label={`${name} 편집`} onClick={() => onOpen(index)} />
	</span>;
}

function FlowSideView({ side, label, hint, onSelect, onOpen }: Pick & { side: FlowSide; label: string; hint: string }) {
	const title = <span className="flow-hint" title={`${label} 속성`}>{hint}</span>;
	if (side.raw) {
		return <div className="flow-side">{title}<span className="flow-problem" title={`${label} 형식: data:json,[{"id":"..."}] 또는 data:json,아이디`}><i className="codicon codicon-error" aria-hidden="true" />{label} 문법 오류</span>
			<code className="flow-raw">{side.raw}</code></div>;
	}
	if (!side.items.length) { return <div className="flow-side">{title}<span className="flow-none">없음</span></div>; }
	// 같은 id가 두 번 적힐 수 있어 key는 순서
	return <div className="flow-side">{title}{side.items.map(({ id, action, key, data }, i) => {
		if (!data) {
			return <span key={i} className="flow-data missing" title="화면의 dataCollection에 이 id의 dataList·dataMap이 없습니다">
				<i className="codicon codicon-warning" aria-hidden="true" /><span className="flow-id">{soft(id)}</span><span className="flow-problem">잘못된 형식</span></span>;
		}
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
				{/* 카드 하나 = Submission 하나. 머리줄에 이름, 본문은 요청 → Controller → 응답 한 줄, 아래에 이벤트 핸들러를 한 줄씩 */}
				{flows.map((flow, i) => <div className="flow-card" key={flow.index}>
					<div className="flow-card-head">
						<span className="flow-no" title={`${i + 1}번째 Submission`}>{i + 1}</span>
						<span className="flow-hint">Submission ID</span>
						<Item kind="submission" name={flow.id || 'Submission'} index={flow.index} title={`submission ${flow.id}`} onSelect={onSelect} onOpen={onOpen}>
							<span className="flow-id">{flow.id ? soft(flow.id) : '(id 없음)'}</span></Item>
					</div>
					<FlowSideView side={flow.request} label="ref" hint="요청" onSelect={onSelect} onOpen={onOpen} />
					<div className="flow-column flow-link">
						<span className="flow-arrow" aria-hidden="true" />
						<span className="flow-item">
							{flow.method && <span className="flow-method">{flow.method.toUpperCase()}</span>}
							<span className="flow-url" title={flow.action}>{flow.action ? soft(flow.action) : '(action 없음)'}</span>
							<button type="button" className="flow-edit flow-go codicon codicon-go-to-file" disabled={!flow.action.trim()} title="Controller 메서드로 이동" aria-label="Controller 이동"
								onClick={() => post({ type: 'openAction', action: flow.action })} />
						</span>
						<span className="flow-arrow" aria-hidden="true" />
					</div>
					<FlowSideView side={flow.response} label="target" hint="응답" onSelect={onSelect} onOpen={onOpen} />
					{!!flow.handlers.length && <div className="flow-handlers">
						{flow.handlers.map(h => <div className="flow-handler" key={h.event}><span title={`ev:${h.event}`}>{h.event}</span><code title={h.handler}>{soft(h.handler)}</code></div>)}
					</div>}
				</div>)}
			</> : <p className="flow-empty">이 화면에는 Submission이 없습니다.</p>}
		</div>
		<p className="flow-notice"><i className="codicon codicon-info" aria-hidden="true" />XML에 선언된 항목만 보여 줍니다. Script에서 동적으로 만든 dataList·dataMap·Submission은 보이지 않을 수 있습니다.</p>
		<div className="submission-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>닫기</button></div>
		{resizeHandles}
	</dialog>;
}
