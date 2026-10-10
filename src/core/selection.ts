import { findNode, localName, nodeAt, pathTo, type XmlNode } from './xmlModel';
import { applyEdits, type TextEdit } from './edit';

/** 구조 편집 후 번호 대신 ID와 그리드·데이터 범위로 현재 선택을 찾는다. */
export function selectionIndex(before: { root?: XmlNode; text: string }, after: { root?: XmlNode; text: string }, index?: number, change?: TextEdit): number | undefined {
	if (index === undefined || !before.root || !after.root) { return undefined; }
	if (before.text === after.text) { return index === -1 ? index : nodeAt(after.root, index)?.index; }
	if (index === -1) { return -1; } // Submission 가상 루트
	const path = pathTo(before.root, index), node = path?.at(-1);
	if (!path || !node) { return undefined; }
	const scope = (path: XmlNode[]) => JSON.stringify(path.slice(0, -1).filter(n =>
		['gridView', 'header', 'gBody', 'footer', 'subTotal', 'columnInfo', 'keyInfo'].includes(localName(n.tag))
	).map(n => [n.ns, localName(n.tag), n.attrs.id ?? '']));
	const ownScope = scope(path);
	// ID 없는 요소는 자식 변경과 무관한 속성으로 식별하고, 중복되면 선택을 해제한다.
	const attrs = Object.entries(node.attrs);
	const sameAttrs = (n: XmlNode) => Object.keys(n.attrs).length === attrs.length
		&& attrs.every(([key, value]) => n.attrs[key] === value);
	// 붙여넣기 결과가 예상 편집과 정확히 같으면 중복 속성 대신 원래 요소의 문자 위치를 추적한다.
	if (change && applyEdits(before.text, [change]) === after.text) {
		// 바뀐 범위 밖에 있는 시작·끝 위치로 찾는다(범위가 요소 앞부분에 걸치면 끝 위치만으로)
		const delta = change.replacement.length - (change.end - change.start);
		const start = node.start < change.start ? node.start : node.start >= change.end ? node.start + delta : undefined;
		const end = node.end <= change.start ? node.end : node.end > change.end ? node.end + delta : undefined;
		const mapped = start === undefined && end === undefined ? undefined
			: findNode(after.root, n => (start === undefined || n.start === start) && (end === undefined || n.end === end));
		if (mapped && mapped.ns === node.ns && mapped.tag === node.tag && sameAttrs(mapped)) { return mapped.index; }
	}
	const matchesIn = (root: XmlNode) => {
		const matches: XmlNode[] = [];
		const ancestors: XmlNode[] = [];
		const visit = (n: XmlNode): boolean => {
			ancestors.push(n);
			if (n.ns === node.ns && localName(n.tag) === localName(node.tag)
				&& (node.attrs.id ? n.attrs.id === node.attrs.id : sameAttrs(n)) && scope(ancestors) === ownScope) {
				matches.push(n);
			}
			const ambiguous = matches.length > 1 || n.children.some(visit);
			ancestors.pop();
			return ambiguous;
		};
		visit(root);
		return matches;
	};
	// 같은 범위에서 식별이 겹치면, 삭제된 요소 대신 남은 요소를 고르지 않는다.
	if (matchesIn(before.root).length !== 1) { return undefined; }
	const matches = matchesIn(after.root);
	if (matches.length === 1) { return matches[0].index; }
	// ID만 고친 경우: 선택 노드 외의 ID와 구조가 모두 그대로일 때만 같은 번호를 유지한다.
	const sameStructure = (a: XmlNode, b: XmlNode): boolean => a.ns === b.ns && localName(a.tag) === localName(b.tag)
		&& (a.index === index || a.attrs.id === b.attrs.id) && a.children.length === b.children.length
		&& a.children.every((c, i) => sameStructure(c, b.children[i]));
	return !matches.length && sameStructure(before.root, after.root) && nodeAt(after.root, index)?.tag === node.tag ? index : undefined;
}
