// 화면 정보(Info 탭): head의 meta_* 속성(프로그램 ID·이름 등)과 `<w2:historyInfo>`의 개정 이력
import { eolOf, escape, INVALID_XML_CHAR, leadOf, lineIndent, startTagEnd, type TextEdit } from './edit';
import { localName, WEBSQUARE_NS, type XmlNode } from './xmlModel';

/** head 속성 이름 → 화면 이름. multiline은 여러 줄 입력, date는 달력(yyyy-MM-dd) */
export const INFO_FIELDS = [
	{ name: 'meta_programId', label: '프로그램 ID' },
	{ name: 'meta_programName', label: '프로그램명' },
	{ name: 'meta_author', label: '작성자' },
	{ name: 'meta_date', label: '작성일', date: true },
	{ name: 'meta_programDesc', label: '프로그램 설명', multiline: true },
	{ name: 'meta_memo', label: '비고', multiline: true },
] as const;

export interface HistoryRow { no: string; desc: string; date: string; user: string }
/** 이력 칸 → `<w2:history>` 속성(이 순서로 쓴다) */
const HISTORY_ATTRS: [keyof HistoryRow, string][] = [['no', 'meta_no'], ['desc', 'meta_desc'], ['date', 'meta_date'], ['user', 'meta_user']];

const historyInfo = (head: XmlNode) => head.children.find(c => c.ns === WEBSQUARE_NS && localName(c.tag) === 'historyInfo');

export const readHistory = (head: XmlNode): HistoryRow[] => (historyInfo(head)?.children ?? [])
	.filter(c => localName(c.tag) === 'history')
	.map(h => Object.fromEntries(HISTORY_ATTRS.map(([key, attr]) => [key, h.attrs[attr] ?? ''])) as unknown as HistoryRow);

/** 개정 이력을 rows로 다시 쓴다. historyInfo가 없으면 head 맨 앞에 만든다(WebSquare namespace 접두사로) */
export function editHistory(text: string, root: XmlNode, head: XmlNode, rows: HistoryRow[]): TextEdit | undefined {
	if (head.tag !== 'head') { throw new Error('head에서만 개정 이력을 고칠 수 있습니다.'); }
	if (rows.some(r => HISTORY_ATTRS.some(([key]) => INVALID_XML_CHAR.test(r[key])))) { throw new Error('XML에 쓸 수 없는 문자가 들어 있습니다.'); }
	if (JSON.stringify(readHistory(head)) === JSON.stringify(rows.map(r => Object.fromEntries(HISTORY_ATTRS.map(([key]) => [key, r[key]]))))) { return undefined; }
	const info = historyInfo(head);
	if (info?.children.some(c => localName(c.tag) !== 'history') || info && /<!--/.test(text.slice(info.start, info.end))) {
		throw new Error('개정 이력에 다른 내용이 있어 Info 탭으로는 고칠 수 없습니다. Source 탭에서 고쳐 주세요.');
	}
	const declared = Object.entries(root.attrs).find(([name, value]) => name.startsWith('xmlns:') && value === WEBSQUARE_NS)?.[0].slice(6);
	const p = info ? info.tag.slice(0, -'historyInfo'.length) : declared && `${declared}:`;
	if (!p) { throw new Error('WebSquare namespace(xmlns:w2) 선언이 없습니다.'); }

	const eol = eolOf(text), first = head.children[0];
	const indent = info ? lineIndent(text, info.start) : first ? leadOf(text, first.start) ?? '' : `${lineIndent(text, head.start)}\t`;
	const unit = /^ +$/.test(indent) ? '    ' : '\t';
	const lines = rows.map(r => `${eol}${indent}${unit}<${p}history ${HISTORY_ATTRS.map(([key, attr]) => `${attr}="${escape(r[key], '"')}"`).join(' ')}></${p}history>`).join('');
	const block = `<${p}historyInfo>${lines}${rows.length ? eol + indent : ''}</${p}historyInfo>`;
	if (info) { return { start: info.start, end: info.end, replacement: block }; }
	if (first) {
		const lead = leadOf(text, first.start);
		return lead === undefined
			? { start: first.start, end: first.start, replacement: block }
			: { start: first.start - lead.length, end: first.start - lead.length, replacement: `${lead}${block}${eol}` };
	}
	const open = startTagEnd(text, head.start);
	if (text[open - 1] === '/') {
		return { start: open - 1, end: open + 1, replacement: `>${eol}${indent}${block}${eol}${lineIndent(text, head.start)}</head>` };
	}
	return { start: open + 1, end: open + 1, replacement: `${eol}${indent}${block}` };
}
