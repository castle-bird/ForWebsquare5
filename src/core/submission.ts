import { eolOf, startTagEnd, withAttrs, type TextEdit } from './edit';
import { insertNode } from './paste';
import { assertFreeId, isXf, pathTo, uniqueId, usedIds, type XmlNode } from './xmlModel';

export const SUBMISSION_EVENTS = ['submit', 'submitdone', 'submiterror'] as const;
const EVENT_ATTRS = SUBMISSION_EVENTS.map(e => `ev:${e}` as const);
const FIELD_NAMES = ['id', 'ref', 'target', 'action', 'method', 'mode', 'mediatype', ...EVENT_ATTRS] as const;

const NEW_ATTRS = ['id', 'ref', 'target', 'action', 'method', 'mediatype', 'encoding', 'instance', 'replace', 'errorHandler', 'customHandler', 'mode', 'processMsg', ...EVENT_ATTRS, 'abortTrigger'];

export type SubmissionFields =Record<typeof FIELD_NAMES[number], string>;

export const SUBMISSION_METHODS = ['get', 'post', 'put', 'delete'];
export const SUBMISSION_MODES = ['asynchronous', 'synchronous'];
export const SUBMISSION_MEDIA_TYPES = ['application/x-www-form-urlencoded', 'application/json', 'application/xml', 'text/xml'];

// ref·target 값(data:json,…)을 데이터 항목 목록으로 만들고 읽는다
export const DATA_REF_TYPES = ['json', 'xml', 'array'];
export const REF_ACTIONS = ['', 'all', 'modified', 'inserted', 'deleted', 'updated'];
export const TARGET_ACTIONS = ['', 'append'];
export type DataRefItem = { id: string; action: string; key: string };

export function formatDataRef(type: string, items: DataRefItem[]): string {
	const list = items.filter(i => i.id);
	if (!list.length) { return ''; }
	// action을 앞에 둬서 여러 줄일 때 id가 줄 맞춰 보이게
	const obj = (i: DataRefItem) => ({ ...i.action && { action: i.action }, id: i.id, ...i.key && { key: i.key } });
	const [one] = list;
	// 여러 개는 항목마다 한 줄
	const body = list.length > 1 ? `[\n  ${list.map(i => JSON.stringify(obj(i))).join(',\n  ')}\n]` : one.action || one.key ? JSON.stringify(obj(one)) : one.id;
	return `data:${type},${body}`;
}

/** 해석할 수 없는 값이면 undefined */
export function parseDataRef(value: string): { type: string; items: DataRefItem[] } | undefined {
	if (!value.trim()) { return { type: 'json', items: [] }; }
	const m = /^data:(json|xml|array),([\s\S]*)$/.exec(value.trim());
	if (!m) { return undefined; }
	const body = m[2].trim();
	let raw: unknown;
	try { raw = /^[[{]/.test(body) ? JSON.parse(body) : body.split(','); } catch { return undefined; }
	const items = (Array.isArray(raw) ? raw : [raw]).map(x => typeof x === 'string' ? { id: x.trim(), action: '', key: '' }
		: x && typeof x === 'object' && typeof (x as DataRefItem).id === 'string'
			? { id: (x as DataRefItem).id, action: String((x as DataRefItem).action ?? ''), key: String((x as DataRefItem).key ?? '') } : undefined);
	return items.every(i => i?.id) ? { type: m[1], items: items as DataRefItem[] } : undefined;
}

export const newSubmissionFields =(root: XmlNode): SubmissionFields => ({
	...Object.fromEntries(FIELD_NAMES.map(name => [name, ''])) as SubmissionFields,
	id: nextSubmissionId(root), method: 'post', mode: 'asynchronous', mediatype: 'application/json',
});

export const nextSubmissionId = (root: XmlNode): string => uniqueId(usedIds(root), 'submission');

export const submissionFields = (node: XmlNode): SubmissionFields =>
	Object.fromEntries(FIELD_NAMES.map(name => [name, node.attrs[name] ?? ''])) as SubmissionFields;

// ref·target(JSON)은 Eclipse처럼 줄바꿈을 그대로·"는 '로 감싸 쓴다. 줄바꿈은 문서 줄바꿈에 맞춘다
const DATA_ATTRS = ['ref', 'target'];
const dataAttr = (text: string, name: string, value: string) => DATA_ATTRS.includes(name) ? value.replace(/\r?\n/g, eolOf(text)) : value;

export function editSubmissionNode(text: string, root: XmlNode, node: XmlNode, fields: SubmissionFields): TextEdit | undefined {
	if (!isXf(node, 'submission')) { throw new Error('xf:submission만 수정할 수 있습니다.'); }
	assertFreeId(root, fields.id, '올바른 Submission ID를 입력해 주세요.', node);
	const end = startTagEnd(text, node.start) + 1;
	const tag = text.slice(node.start, end);
	const selfClosing = tag.endsWith('/>');
	const changed = Object.entries(fields).filter(([name, value]) => value !== (node.attrs[name] ?? ''));
	const xml = withAttrs(selfClosing ? tag : `${tag.slice(0, -1)}/>`, changed.map(([name, value]) => [name, dataAttr(text, name, value) || undefined]),
		pathTo(root, node.index)?.slice(0, -1), DATA_ATTRS);
	const replacement = selfClosing ? xml : `${xml.slice(0, -2)}>`;
	return replacement === tag ? undefined : { start: node.start, end, replacement };
}

export function addSubmissionNode(text: string, root: XmlNode, model: XmlNode, fields: SubmissionFields): TextEdit {
	if (!isXf(model, 'model')) { throw new Error('xf:model에만 Submission을 추가할 수 있습니다.'); }
	assertFreeId(root, fields.id, '올바른 Submission ID를 입력해 주세요.');
	if (!SUBMISSION_METHODS.includes(fields.method) || !SUBMISSION_MODES.includes(fields.mode) || !SUBMISSION_MEDIA_TYPES.includes(fields.mediatype)) { throw new Error('지원하지 않는 Submission 옵션입니다.'); }
	// WebSquare5 기본 생성과 같은 속성·순서
	const values: Record<string, string> = { encoding: 'UTF-8', ...fields };
	const attrs = NEW_ATTRS.map(name => [name, dataAttr(text, name, values[name] ?? '')] as [string, string]);
	return insertNode(text, model, 'inside', withAttrs('<xf:submission/>', attrs, pathTo(root, model.index), DATA_ATTRS));
}
