import { startTagEnd, withAttrs, type TextEdit } from './edit';
import { insertNode } from './paste';
import { pathTo, uniqueId, usedIds, VALID_ID, XFORMS_NS, type XmlNode } from './xmlModel';

export const SUBMISSION_EVENTS = ['submit', 'submitdone', 'submiterror'] as const;
const EVENT_ATTRS = SUBMISSION_EVENTS.map(e => `ev:${e}` as const);
const FIELD_NAMES = ['id', 'ref', 'target', 'action', 'method', 'mode', 'mediatype', ...EVENT_ATTRS] as const;

export type SubmissionFields = Record<typeof FIELD_NAMES[number], string>;

export const SUBMISSION_METHODS = ['get', 'post', 'put', 'delete'];
export const SUBMISSION_MODES = ['asynchronous', 'synchronous'];
export const SUBMISSION_MEDIA_TYPES = ['application/x-www-form-urlencoded', 'application/json', 'application/xml', 'text/xml'];

export const newSubmissionFields = (root: XmlNode): SubmissionFields => ({
	...Object.fromEntries(FIELD_NAMES.map(name => [name, ''])) as SubmissionFields,
	id: nextSubmissionId(root), method: 'post', mode: 'asynchronous', mediatype: 'application/json',
});

export const nextSubmissionId = (root: XmlNode): string => uniqueId(usedIds(root), 'submission');

export const submissionFields = (node: XmlNode): SubmissionFields =>
	Object.fromEntries(FIELD_NAMES.map(name => [name, node.attrs[name] ?? ''])) as SubmissionFields;

export function editSubmissionNode(text: string, root: XmlNode, node: XmlNode, fields: SubmissionFields): TextEdit | undefined {
	if (node.tag !== 'xf:submission') { throw new Error('xf:submission만 수정할 수 있습니다.'); }
	if (!VALID_ID.test(fields.id)) { throw new Error('올바른 Submission ID를 입력해 줘.'); }
	if (usedIds(root, node).has(fields.id)) { throw new Error(`이미 사용 중인 ID야: ${fields.id}`); }
	const end = startTagEnd(text, node.start) + 1;
	const tag = text.slice(node.start, end);
	const selfClosing = tag.endsWith('/>');
	const changed = Object.entries(fields).filter(([name, value]) => value !== (node.attrs[name] ?? ''));
	const xml = withAttrs(selfClosing ? tag : `${tag.slice(0, -1)}/>`, changed.map(([name, value]) => [name, value || undefined]), pathTo(root, node.index)?.slice(0, -1));
	const replacement = selfClosing ? xml : `${xml.slice(0, -2)}>`;
	return replacement === tag ? undefined : { start: node.start, end, replacement };
}

export function addSubmissionNode(text: string, root: XmlNode, model: XmlNode, fields: SubmissionFields): TextEdit {
	if (model.tag !== 'xf:model' || model.ns !== XFORMS_NS) { throw new Error('xf:model에만 Submission을 추가할 수 있습니다.'); }
	if (!VALID_ID.test(fields.id)) { throw new Error('올바른 Submission ID를 입력해 줘.'); }
	if (usedIds(root).has(fields.id)) { throw new Error(`이미 사용 중인 ID야: ${fields.id}`); }
	if (!SUBMISSION_METHODS.includes(fields.method) || !SUBMISSION_MODES.includes(fields.mode) || !SUBMISSION_MEDIA_TYPES.includes(fields.mediatype)) { throw new Error('지원하지 않는 Submission 옵션이야.'); }
	const attrs = Object.entries(fields).filter(([name, value]) => value || !name.startsWith('ev:'));
	return insertNode(text, model, 'inside', withAttrs('<xf:submission/>', attrs, pathTo(root, model.index)));
}
