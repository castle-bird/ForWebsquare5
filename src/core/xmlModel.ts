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
		const own = { ...scope };
		for (const [k, v] of Object.entries(n.attribs)) {
			if (k === 'xmlns' || k.startsWith('xmlns:')) {
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

export const findTag = (node: XmlNode, tag: string) => findNode(node, n => n.tag === tag);

export const localName = (tag: string) => tag.slice(tag.indexOf(':') + 1);
export const prefixOf = (tag: string) => tag.slice(0, tag.indexOf(':') + 1);
export const kid = (n: XmlNode | undefined, name: string) => n?.children.find(c => localName(c.tag) === name);
export const kids = (n: XmlNode | undefined, name: string) => n?.children.filter(c => localName(c.tag) === name) ?? [];
export const defOf = <T>(node: XmlNode, defs: readonly T[] | undefined): T | undefined => node.def === undefined ? undefined : defs?.[node.def];

export const WEBSQUARE_NS = 'http://www.inswave.com/websquare';
export const XFORMS_NS = 'http://www.w3.org/2002/xforms';
/** 이벤트 핸들러 속성 접두어(ev:onclick) */
export const EV = 'ev:';

export const isScreen = (root: XmlNode | undefined) => root?.tag === 'html'
	&& Object.entries(root.attrs).some(([k, v]) => (k === 'xmlns' || k.startsWith('xmlns:')) && v === WEBSQUARE_NS);

export const VALID_ID = /^[A-Za-z_][\w.-]*$/;

export function usedIds(root: XmlNode, except?: XmlNode): Set<string> {
	const used = new Set<string>();
	const visit = (n: XmlNode) => { if (n.attrs.id && n.index !== except?.index) { used.add(n.attrs.id); } n.children.forEach(visit); };
	visit(root);
	return used;
}

export function uniqueId(used: Set<string>, base: string): string {
	let i = 1;
	while (used.has(`${base}${i}`)) { i++; }
	used.add(`${base}${i}`);
	return `${base}${i}`;
}
