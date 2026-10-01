import { applyEdits, eolOf, leadOf, setAttribute, startTagEnd, type TextEdit } from './edit';
import { localName, parseXml, uniqueId, usedIds, type XmlNode } from './xmlModel';

const EV = 'ev:';

const CONTAINERS = new Set(['body', 'group', 'content', 'generator']);
export const isContainer = (n: XmlNode) => CONTAINERS.has(localName(n.tag));

export type DropPosition = 'before' | 'after' | 'inside';
export type InsertPosition = DropPosition | 'first';

export const reindentLines = (s: string, from: string, to: string) =>
	s.replace(/(\r?\n)([ \t]*)/g, (_, nl: string, ws: string) => nl + (ws.startsWith(from) ? to + ws.slice(from.length) : ws));

export function insertNode(text: string, target: XmlNode, position: InsertPosition, xml: string): TextEdit {
	if (position === 'first') {
		if (!isContainer(target)) {
			throw new Error('자식을 넣을 수 없는 위치입니다.');
		}
		return target.children.length ? insertNode(text, target.children[0], 'before', xml) : insertNode(text, target, 'inside', xml);
	}
	const indent = /^[ \t]*/.exec(xml)![0];
	const body = xml.slice(indent.length).trimEnd();
	const eol = eolOf(text);
	const reindent = (to: string) => reindentLines(body, indent, to);

	if (position !== 'inside') {
		const lead = leadOf(text, target.start);
		if (lead === undefined) {
			const at = position === 'before' ? target.start : target.end;
			return { start: at, end: at, replacement: body };
		}
		const lineStart = target.start - lead.length;
		return position === 'before'
			? { start: lineStart, end: lineStart, replacement: lead + reindent(lead) + eol }
			: { start: target.end, end: target.end, replacement: eol + lead + reindent(lead) };
	}
	if (!isContainer(target) && !target.tag.endsWith(':dataCollection') && target.tag !== 'xf:model') {
		throw new Error('자식을 넣을 수 없는 위치입니다.');
	}

	const open = startTagEnd(text, target.start);
	if (text[open - 1] === '/') {
		return { start: open - 1, end: open + 1, replacement: `>${body}</${target.tag}>` };
	}
	const close = text.lastIndexOf('</', target.end - 1);
	const closeIndent = leadOf(text, close);
	if (closeIndent === undefined) {
		return { start: close, end: close, replacement: body };
	}
	const lineStart = close - closeIndent.length;
	const last = target.children.at(-1);
	const lastIndent = last && leadOf(text, last.start);
	const childIndent = lastIndent ?? closeIndent + (closeIndent.includes(' ') && !closeIndent.includes('\t') ? '    ' : '\t');
	return { start: lineStart, end: lineStart, replacement: childIndent + reindent(childIndent) + eol };
}

export function pasteNode(text: string, root: XmlNode, target: XmlNode, xml: string | string[]): TextEdit {
	const items = typeof xml === 'string' ? [xml] : xml;
	if (!items.length) { throw new Error('복사한 내용이 없습니다.'); }
	const used = usedIds(root);
	const first = /^[ \t]*/.exec(items[0])![0];
	const joined = items.map(item => {
		const indent = /^[ \t]*/.exec(item)![0];
		return reindentLines(rename(item.slice(indent.length), used), indent, first);
	}).join(eolOf(text) + first);
	return insertNode(text, target, isContainer(target) ? 'inside' : 'after', first + joined);
}

function rename(snippet: string, used: Set<string>): string {
	const copy = parseXml(snippet);
	if (!copy || copy.start !== 0 || copy.end !== snippet.trimEnd().length) {
		throw new Error('복사한 내용이 컴포넌트 하나가 아닙니다.');
	}
	const edits: TextEdit[] = [];
	const walk = (n: XmlNode) => {
		for (const name of Object.keys(n.attrs).filter(k => k.startsWith(EV))) {
			edits.push(setAttribute(snippet, n, name, undefined)!);
		}
		if (n.attrs.id) {
			edits.push(setAttribute(snippet, n, 'id', uniqueId(used, `${n.attrs.id.replace(/_copy\d+$/, '')}_copy`))!);
		}
		n.children.forEach(walk);
	};
	walk(copy);
	return applyEdits(snippet, edits);
}
