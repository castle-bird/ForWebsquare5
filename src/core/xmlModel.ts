import { parseDocument } from 'htmlparser2';
import type { ChildNode } from 'domhandler';

export interface XmlNode {
	index: number;
	tag: string;
	ns: string;
	attrs: Record<string, string>;
	start: number;
	end: number;
	children: XmlNode[];
	text?: string;
	def?: number;
	udc?: boolean;
	frame?: XmlNode;
	frameError?: string;
	url?: string;
}

export function parseXml(text: string): XmlNode | undefined {
	const doc = parseDocument(text, { xmlMode: true, withStartIndices: true, withEndIndices: true });
	if (doc.children.some(n => n.type === 'directive' && /^!doctype$/i.test(n.name))) {
		throw new Error('DOCTYPE이 있는 XML은 지원하지 않습니다. Source 탭이나 텍스트 편집기에서 고쳐 주세요.');
	}
	let index = 0;
	const convert = (nodes: ChildNode[], scope: Record<string, string>): XmlNode[] => nodes.flatMap(n => {
		if (n.type !== 'tag') {
			return [];
		}
		let own = scope;
		for (const [k, v] of Object.entries(n.attribs)) {
			if (k === 'xmlns' || k.startsWith('xmlns:')) {
				if (own === scope) { own = { ...scope }; }
				own[k.slice(6)] = v;
			}
		}
		const colon = n.name.indexOf(':');
		const text = n.children.map(c => c.type === 'text' ? c.data : c.type === 'cdata' ? c.children.map(t => t.type === 'text' ? t.data : '').join('') : '').join('').trim();
		return [{
			index: index++,
			tag: n.name,
			ns: own[colon < 0 ? '' : n.name.slice(0, colon)] ?? '',
			attrs: n.attribs,
			start: n.startIndex!,
			end: n.endIndex! + 1,
			children: convert(n.children, own),
			...text && { text },
		}];
	});
	return convert(doc.children, {})[0];
}

export function pathTo(node: XmlNode, index?: number): XmlNode[] | undefined {
	if (index === undefined) {
		return undefined;
	}
	if (node.index === index) {
		return [node];
	}
	for (const c of node.children) {
		const path = pathTo(c, index);
		if (path) {
			return [node, ...path];
		}
	}
	return undefined;
}

/** index 노드(없으면 undefined) */
export const nodeAt = (node: XmlNode, index?: number) => index === undefined ? undefined : findNode(node, n => n.index === index);

/** test를 만족하는 첫 노드(자기 자신부터, 문서 순서) */
export function findNode(node: XmlNode, test: (n: XmlNode) => boolean): XmlNode | undefined {
	if (test(node)) {
		return node;
	}
	for (const c of node.children) {
		const found = findNode(c, test);
		if (found) {
			return found;
		}
	}
	return undefined;
}

export const localName = (tag: string) => tag.slice(tag.indexOf(':') + 1);
export const prefixOf = (tag: string) => tag.slice(0, tag.indexOf(':') + 1);
export const kid = (n: XmlNode | undefined, name: string) => n?.children.find(c => localName(c.tag) === name);
export const kids = (n: XmlNode | undefined, name: string) => n?.children.filter(c => localName(c.tag) === name) ?? [];
/** 편집기가 보존할 수 있는 속성·자식만 있는지 */
export const hasOnly = (n: XmlNode, children: readonly string[], attrs: readonly string[] = []) =>
	!n.text && n.children.every(c => c.ns === n.ns && children.includes(localName(c.tag))) && Object.keys(n.attrs).every(a => attrs.includes(a));
export const defOf = <T>(node: XmlNode, defs: readonly T[] | undefined): T | undefined => node.def === undefined ? undefined : defs?.[node.def];

export const WEBSQUARE_NS = 'http://www.inswave.com/websquare';
export const XFORMS_NS = 'http://www.w3.org/2002/xforms';
/** WebSquare·XForms 요소인지: 접두어(w2:·xf:) 대신 xmlns로 푼 namespace와 로컬 이름으로 본다 */
export const isWs = (n: XmlNode | undefined, name: string) => n?.ns === WEBSQUARE_NS && localName(n.tag) === name;
export const isXf = (n: XmlNode | undefined, name: string) => n?.ns === XFORMS_NS && localName(n.tag) === name;
/** 이벤트 핸들러 속성 접두어(ev:onclick) */
export const EV = 'ev:';

/** node에 선언된 ns의 태그 접두사(기본 네임스페이스면 '', 접두사가 있으면 'w2:', 선언이 없으면 undefined) */
export function nsPrefix(node: XmlNode, ns: string): string | undefined {
	if (node.attrs.xmlns === ns) { return ''; }
	const decl = Object.keys(node.attrs).find(k => k.startsWith('xmlns:') && node.attrs[k] === ns);
	return decl && `${decl.slice(6)}:`;
}

export const isScreen = (root: XmlNode | undefined) => root?.tag === 'html' && nsPrefix(root, WEBSQUARE_NS) !== undefined;

export const VALID_ID = /^[A-Za-z_][\w.-]*$/;

export function usedIds(root: XmlNode, except?: XmlNode): Set<string> {
	const used = new Set<string>();
	const visit = (n: XmlNode) => { if (n.attrs.id && n.index !== except?.index) { used.add(n.attrs.id); } n.children.forEach(visit); };
	visit(root);
	return used;
}

/** 새 id 검증: XML 이름으로 쓸 수 있고 except 말고는 아무도 안 쓰는지 */
export function assertFreeId(root: XmlNode, id: string, invalid: string, except?: XmlNode): void {
	if (!VALID_ID.test(id)) { throw new Error(invalid); }
	if (usedIds(root, except).has(id)) { throw new Error(`이미 사용 중인 ID입니다: ${id}`); }
}

export function uniqueId(used: Set<string>, base: string): string {
	let i = 1;
	while (used.has(`${base}${i}`)) { i++; }
	used.add(`${base}${i}`);
	return `${base}${i}`;
}
