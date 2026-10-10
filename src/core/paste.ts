import { applyEdits, eolOf, leadOf, setAttribute, startTagEnd, type TextEdit } from './edit';
import { EV, findNode, localName, parseXml, pathTo, uniqueId, usedIds, WEBSQUARE_NS, XFORMS_NS, type XmlNode } from './xmlModel';
import { DATA_KINDS } from './data';

/** 이벤트 종류를 정하는 속성(`xf:action ev:event`)은 컴포넌트의 핸들러(`ev:onclick`)와 달리 지우면 동작이 사라진다 */
const EVENT_KIND = 'ev:event';
/** 화면 구조(복사·붙여넣기 대상이 아님): 하나뿐이라 복사하면 중복된다 */
const STRUCTURE = new Set(['html', 'head', 'body', 'model']);
export const isStructure = (n: XmlNode) => STRUCTURE.has(localName(n.tag));
/** 데이터 필드 이름(dataMap key·dataList/그리드 column): 컴포넌트 id가 아니라 복사해도 바꾸지 않는다(바인딩이 깨진다) */
// (붙여 넣을 조각만 따로 읽어 네임스페이스를 모르므로 태그 이름으로)
const isField = (n: XmlNode) => /:(key|column)$/.test(n.tag);

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

/** 붙여 넣을 조각의 집: submission은 xf:model, 데이터(dataMap·dataList 등)는 w2:dataCollection. 컴포넌트는 없음 */
function homeOf(root: XmlNode, tags: string[]): XmlNode | undefined {
	const kinds = new Set(tags.map(tag => tag.endsWith(':submission') ? 'model' : DATA_KINDS.some(k => tag.endsWith(`:${k}`)) ? 'collection' : ''));
	if (kinds.size > 1) {
		throw new Error('데이터(submission·dataMap·dataList)와 컴포넌트는 함께 붙여 넣을 수 없습니다.');
	}
	const [kind] = kinds;
	if (!kind) {
		return undefined;
	}
	const home = findNode(root, n => kind === 'model' ? n.ns === XFORMS_NS && localName(n.tag) === 'model' : n.ns === WEBSQUARE_NS && localName(n.tag) === 'dataCollection');
	if (!home) {
		throw new Error(kind === 'model' ? '붙여 넣을 xf:model이 없습니다.' : '붙여 넣을 DataCollection이 없습니다.');
	}
	return home;
}

/** position: 고른 것의 앞·뒤에 형제로(우클릭 붙여 넣기 > 앞·뒤). 없으면 컨테이너는 안 마지막, 아니면 바로 뒤 */
export function pasteNode(text: string, root: XmlNode, target: XmlNode, xml: string | string[], position?: 'before' | 'after'): TextEdit {
	const items = typeof xml === 'string' ? [xml] : xml;
	if (!items.length) { throw new Error('복사한 내용이 없습니다.'); }
	const copies = items.map(item => {
		const indent = /^[ \t]*/.exec(item)![0], snippet = item.slice(indent.length);
		const node = parseXml(snippet);
		if (!node || node.start !== 0 || node.end !== snippet.trimEnd().length) {
			throw new Error('복사한 내용이 컴포넌트 하나가 아닙니다.');
		}
		return { indent, snippet, node };
	});
	if (copies.some(({ node }) => isStructure(node))) {
		throw new Error('화면 구조(html·head·body·xf:model)는 복사해 붙여 넣을 수 없습니다.');
	}
	// 데이터는 자기 집(model·dataCollection) 안으로: 고른 곳이 그 안이면 바로 뒤, 아니면(화면 컴포넌트 등) 맨 뒤. 컴포넌트는 데이터 영역에 못 넣는다
	const home = homeOf(root, copies.map(({ node }) => node.tag));
	if (!home && pathTo(root, target.index)?.some(n => n.ns === XFORMS_NS && localName(n.tag) === 'model')) {
		throw new Error('데이터 영역(xf:model)에는 컴포넌트를 붙여 넣을 수 없습니다. 화면의 컴포넌트를 고른 뒤 붙여 넣어 주세요.');
	}
	const used = usedIds(root);
	const first = copies[0].indent;
	const joined = copies.map(({ snippet, node, indent }) =>
		reindentLines(rename(snippet, node, used), indent, first)
	).join(eolOf(text) + first);
	if (position && (isStructure(target) || home && !home.children.some(c => c.index === target.index))) {
		throw new Error(isStructure(target) ? '화면 구조(html·head·body·xf:model)의 앞뒤에는 붙여 넣을 수 없습니다.' : '데이터는 데이터 영역 안 항목의 앞뒤에만 붙여 넣을 수 있습니다.');
	}
	if (position) {
		return insertNode(text, target, position, first + joined);
	}
	if (home) {
		return home.children.some(c => c.index === target.index) ? insertNode(text, target, 'after', first + joined) : insertNode(text, home, 'inside', first + joined);
	}
	return insertNode(text, target, isContainer(target) ? 'inside' : 'after', first + joined);
}

function rename(snippet: string, copy: XmlNode, used: Set<string>): string {
	const edits: TextEdit[] = [];
	const walk = (n: XmlNode) => {
		for (const name of Object.keys(n.attrs).filter(k => k.startsWith(EV) && k !== EVENT_KIND)) {
			edits.push(setAttribute(snippet, n, name, undefined)!);
		}
		if (n.attrs.id && !isField(n)) {
			edits.push(setAttribute(snippet, n, 'id', uniqueId(used, `${n.attrs.id.replace(/_copy\d+$/, '')}_copy`))!);
		}
		n.children.forEach(walk);
	};
	walk(copy);
	return applyEdits(snippet, edits);
}
