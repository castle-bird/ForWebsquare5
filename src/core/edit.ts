import { decodeXML } from 'entities';
import { findNode, parseXml, type XmlNode } from './xmlModel';

export interface TextEdit { start: number; end: number; replacement: string }

export const eolOf = (text: string) => text.includes('\r\n') ? '\r\n' : '\n';

export const lineIndent = (text: string, pos: number) => /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', pos - 1) + 1, pos))![0];

export function leadOf(text: string, pos: number): string | undefined {
	const lead = text.slice(text.lastIndexOf('\n', pos - 1) + 1, pos);
	return /^[ \t]*$/.test(lead) ? lead : undefined;
}

export const INVALID_XML_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;

export const applyEdits = (text: string, edits: (TextEdit | undefined)[]) => edits.filter(e => e !== undefined)
	.sort((a, b) => b.start - a.start).reduce((t, e) => t.slice(0, e.start) + e.replacement + t.slice(e.end), text);

export function sourceChange(before: string, after: string): TextEdit | undefined {
	if (before === after) {
		return undefined;
	}
	let start = 0;
	while (start < before.length && start < after.length && before[start] === after[start]) {
		start++;
	}
	let end = 0;
	while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) {
		end++;
	}
	return { start, end: before.length - end, replacement: after.slice(start, after.length - end) };
}

interface ScriptBody { start: number; end: number; text: string; cdata: boolean }

export function scriptBody(text: string, root: XmlNode): ScriptBody | string {
	const node = findNode(root, n => n.tag.replace(/^.*:/, '') === 'script' && !('src' in n.attrs));
	if (!node) {
		return '인라인 <script>가 없습니다.';
	}
	const mixed = '주석·여러 CDATA·요소가 섞인 스크립트는 여기서 편집할 수 없습니다. Source 탭에서 편집해 주세요.';
	const from = startTagEnd(text, node.start) + 1;
	if (text[from - 2] === '/' || node.children.length) {
		return text[from - 2] === '/' ? '빈 <script/>입니다. Source 탭에서 본문을 넣어 주세요.' : mixed;
	}
	const to = text.lastIndexOf('</', node.end - 1);
	const region = text.slice(from, to);
	const cdata = /^(\s*<!\[CDATA\[)((?:(?!\]\]>)[\s\S]|\]\]><!\[CDATA\[)*)\]\]>\s*$/.exec(region);
	if (cdata) {
		const start = from + cdata[1].length;
		return { start, end: start + cdata[2].length, text: cdata[2].split(']]><![CDATA[').join(''), cdata: true };
	}
	return /<!--|<!\[CDATA\[|<\?/.test(region) ? mixed : { start: from, end: to, text: decodeXML(region), cdata: false };
}

/** 화면 XML 원문에서 편집할 수 있는 Script 본문(없거나 편집할 수 없는 모양이면 undefined). XML을 못 읽으면 parseXml 오류 */
export function editableScript(text: string): ScriptBody | undefined {
	const root = parseXml(text), body = root && scriptBody(text, root);
	return typeof body === 'object' ? body : undefined;
}

export function encodeScript(value: string, cdata: boolean): string {
	return cdata ? splitCdata(value) : value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll(']]>', ']]&gt;');
}

export const escapeText = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function applyLineChanges(text: string, changes: { fromLine: number; fromCh: number; toLine: number; toCh: number; insert: string }[]): string {
	const lineStarts = [0, ...[...text.matchAll(/\r\n?|\n/g)].map(m => m.index + m[0].length)];
	const at = (line: number, ch: number) => lineStarts[line] + ch;
	return [...changes].sort((x, y) => at(y.fromLine, y.fromCh) - at(x.fromLine, x.fromCh))
		.reduce((t, c) => t.slice(0, at(c.fromLine, c.fromCh)) + c.insert + t.slice(at(c.toLine, c.toCh)), text);
}

const splitCdata = (value: string) => value.replaceAll(']]>', ']]]]><![CDATA[>');

export function setAttribute(text: string, node: XmlNode, name: string, value: string | undefined, ancestors: XmlNode[] = []): TextEdit | undefined {
	// 이름은 원문에 그대로 들어가므로 XML 이름 형식(접두사 하나)만 허용 (태그 구조를 깨는 입력 차단)
	if (!/^[A-Za-z_][\w.-]*(:[A-Za-z_][\w.-]*)?$/.test(name) || name === 'xmlns' || name.startsWith('xmlns:')) {
		throw new Error(`편집할 수 없는 속성 이름: ${name}`);
	}
	if (value !== undefined && INVALID_XML_CHAR.test(value)) {
		throw new Error('XML에 쓸 수 없는 문자가 들어 있습니다.');
	}
	const prefix = name.includes(':') ? name.slice(0, name.indexOf(':')) : '';
	const declared = !prefix || prefix === 'xml' || [node, ...ancestors].some(n => `xmlns:${prefix}` in n.attrs);
	if (!declared && prefix !== 'ev') {
		throw new Error(`선언되지 않은 접두사: ${prefix}`);
	}
	const tagEnd = startTagEnd(text, node.start);
	const found = findAttribute(text, node.start, tagEnd, name);
	if (found) {
		if (value === undefined) {
			return { start: found.start, end: found.end, replacement: '' };
		}
		const replacement = escape(value, found.quote);
		return text.slice(found.valueStart, found.valueEnd) === replacement ? undefined : { start: found.valueStart, end: found.valueEnd, replacement };
	}
	if (value === undefined) {
		return undefined;
	}
	let at = text[tagEnd - 1] === '/' ? tagEnd - 1 : tagEnd;
	while (at > node.start && /\s/.test(text[at - 1])) {
		at--;
	}
	const declare = declared ? '' : ' xmlns:ev="http://www.w3.org/2001/xml-events"';
	return { start: at, end: at, replacement: ` ${name}="${escape(value, '"')}"${declare}` };
}

export function withAttrs(xml: string, attrs: [string, string | undefined][], ancestors: XmlNode[] = []): string {
	for (const [name, value] of attrs) {
		xml = applyEdits(xml, [setAttribute(xml, parseXml(xml)!, name, value, ancestors)]);
	}
	return xml;
}

/** 여러 속성은 시작 태그만 고친다. 본문 재파싱 없이 따옴표·공백·접두사 검증을 유지한다. */
export function setAttributes(text: string, node: XmlNode, attrs: [string, string | undefined][], ancestors: XmlNode[] = []): TextEdit | undefined {
	const tag = text.slice(node.start, startTagEnd(text, node.start) + 1);
	const change = sourceChange(tag, withAttrs(tag, attrs, ancestors));
	return change && { ...change, start: node.start + change.start, end: node.start + change.end };
}

export function startTagEnd(text: string, start: number): number {
	let quote = '';
	for (let i = start + 1; i < text.length; i++) {
		const c = text[i];
		if (quote) {
			if (c === quote) {
				quote = '';
			}
		} else if (c === '"' || c === '\'') {
			quote = c;
		} else if (c === '>') {
			return i;
		}
	}
	throw new Error('시작 태그가 닫히지 않음');
}

function findAttribute(text: string, tagStart: number, tagEnd: number, name: string) {
	const re = /(\s+)([^\s=/>]+)\s*=\s*(["'])/g;
	re.lastIndex = tagStart;
	for (let m = re.exec(text); m && m.index < tagEnd; m = re.exec(text)) {
		const quote = m[3];
		const valueStart = m.index + m[0].length;
		const valueEnd = text.indexOf(quote, valueStart);
		// 닫는 따옴표가 없으면 lastIndex가 0으로 돌아가 무한 반복한다
		if (valueEnd < 0) {
			break;
		}
		if (m[2] === name) {
			return { start: m.index, end: valueEnd + 1, valueStart, valueEnd, quote };
		}
		re.lastIndex = valueEnd + 1;
	}
	return undefined;
}

/** 속성값 이스케이프. 줄바꿈·탭은 파서가 공백으로 바꾸므로 문자 참조로 보존 */
export function escape(value: string, quote: string): string {
	const s = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\r', '&#13;').replaceAll('\n', '&#10;').replaceAll('\t', '&#9;');
	return quote === '"' ? s.replaceAll('"', '&quot;') : s.replaceAll("'", '&apos;');
}

export function deleteNode(text: string, node: XmlNode): TextEdit {
	const lead = leadOf(text, node.start);
	const trail = /^[ \t]*\r?\n/.exec(text.slice(node.end));
	return lead !== undefined && trail
		? { start: node.start - lead.length, end: node.end + trail[0].length, replacement: '' }
		: { start: node.start, end: node.end, replacement: '' };
}

export function setText(text: string, node: XmlNode, value: string): TextEdit | undefined {
	const tagEnd = startTagEnd(text, node.start);
	const escaped = escapeText(value);
	if (text[tagEnd - 1] === '/') {
		return value ? { start: tagEnd - 1, end: tagEnd + 1, replacement: `>${escaped}</${node.tag}>` } : undefined;
	}
	const contentStart = tagEnd + 1;
	const contentEnd = node.children.length ? node.children[0].start : text.lastIndexOf('</', node.end - 1);
	const region = text.slice(contentStart, contentEnd);
	const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(region);
	if (cdata) {
		const start = contentStart + cdata.index + '<![CDATA['.length;
		const replacement = splitCdata(value);
		return cdata[1] === replacement ? undefined : { start, end: start + cdata[1].length, replacement };
	}
	const [, lead, body, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(region)!;
	const start = contentStart + lead.length;
	return body === escaped ? undefined : { start, end: contentEnd - trail.length, replacement: escaped };
}
