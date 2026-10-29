import type { XmlNode } from './xmlModel';

/** 트리 검색 결과: match는 검색어에 맞는 노드, keep은 그 노드와 조상(보여 줄 줄), terms는 강조할 낱말(소문자) */
export interface TreeFilter { match: Set<XmlNode>; keep: Set<XmlNode>; terms: string[] }

/**
 * 공백으로 나눈 낱말이 모두 그 노드의 labels(줄에 보이는 글자: 이름·태그·id·class)에 들어 있으면(대소문자 무시) 맞는 노드.
 * 검색어가 비면 undefined(걸러내지 않음). 트리 구조(자식 목록)는 보이는 트리와 같은 것을 childrenOf로 받는다
 */
export function filterTree(tops: readonly XmlNode[], childrenOf: (n: XmlNode) => XmlNode[], labelsOf: (n: XmlNode) => string[], query: string): TreeFilter | undefined {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!terms.length) { return undefined; }
	const match = new Set<XmlNode>(), keep = new Set<XmlNode>();
	const visit = (n: XmlNode): boolean => {
		const text = labelsOf(n).join(' ').toLowerCase();
		const self = terms.every(t => text.includes(t));
		if (self) { match.add(n); }
		// 맞는 자손이 있어도 나머지 자식까지 모두 훑는다(match를 다 모으려고)
		const inside = childrenOf(n).map(visit).some(Boolean);
		if (self || inside) { keep.add(n); }
		return self || inside;
	};
	tops.forEach(visit);
	return { match, keep, terms };
}
