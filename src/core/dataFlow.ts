// 현재 화면의 Submission 흐름: 요청 데이터(ref) → Submission(action) → 응답 데이터(target)와 이벤트 핸들러.
// dataList·dataMap은 어느 쪽(요청·응답)에도 올 수 있어 종류로 방향을 가정하지 않는다
import { DATA_KINDS, modelParts, type DataKind } from './data';
import { parseDataRef, SUBMISSION_EVENTS } from './submission';
import { isWs, type XmlNode } from './xmlModel';

interface FlowData { id: string; kind: DataKind; index: number; fields: string[] }
/** ref·target의 항목 하나. data가 없으면 화면에 그런 데이터가 없는 것 */
interface FlowRef { id: string; action: string; key: string; data?: FlowData }
/** ref·target 한쪽. 값을 해석하지 못하면 items는 비고 raw에 원문 */
export interface FlowSide { items: FlowRef[]; raw?: string }
export interface SubmissionFlow {
	id: string; index: number; action: string; method: string;
	request: FlowSide; response: FlowSide;
	handlers: { event: string; handler: string }[];
}

const fieldsOf = (n: XmlNode) => n.children.find(c => isWs(c, 'columnInfo') || isWs(c, 'keyInfo'))?.children.flatMap(f => f.attrs.id ? [f.attrs.id] : []) ?? [];

export function dataFlow(root: XmlNode | undefined): SubmissionFlow[] {
	const { dataCollection, submissions } = modelParts(root);
	const data = new Map<string, FlowData>();
	for (const n of dataCollection?.children ?? []) {
		const kind = DATA_KINDS.find(k => isWs(n, k));
		if (kind && n.attrs.id && !data.has(n.attrs.id)) { data.set(n.attrs.id, { id: n.attrs.id, kind, index: n.index, fields: fieldsOf(n) }); }
	}
	const side = (value: string | undefined): FlowSide => {
		const parsed = parseDataRef(value ?? '');
		return parsed ? { items: parsed.items.map(i => ({ ...i, data: data.get(i.id) })) } : { items: [], raw: value };
	};
	return submissions.map(s => ({
		id: s.attrs.id ?? '', index: s.index, action: s.attrs.action ?? '', method: s.attrs.method ?? '',
		request: side(s.attrs.ref), response: side(s.attrs.target),
		handlers: SUBMISSION_EVENTS.flatMap(event => s.attrs[`ev:${event}`]?.trim() ? [{ event, handler: s.attrs[`ev:${event}`].trim() }] : []),
	}));
}
