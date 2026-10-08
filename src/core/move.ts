import { deleteNode, eolOf, leadOf, type TextEdit } from './edit';
import { insertNode, reindentLines, type DropPosition } from './paste';
import { nodeAt, type XmlNode } from './xmlModel';

export function moveNode(text: string, dragged: XmlNode | XmlNode[], target: XmlNode, position: DropPosition): TextEdit[] {
	const nodes = (Array.isArray(dragged) ? [...dragged] : [dragged]).sort((a, b) => a.start - b.start);
	if (nodes.some(n => target.start >= n.start && target.end <= n.end)) {
		throw new Error('자기 자신 안으로는 옮길 수 없습니다.');
	}
	const lead = (n: XmlNode) => leadOf(text, n.start) ?? '';
	const first = lead(nodes[0]);
	const snippet = first + nodes.map(n => reindentLines(text.slice(n.start, n.end), lead(n), first)).join(eolOf(text) + first);
	return [...nodes.map(n => deleteNode(text, n)), insertNode(text, target, position, snippet)];
}

/** 노드와 그 자손 수 */
const sizeOf = (n: XmlNode): number => 1 + n.children.reduce((s, c) => s + sizeOf(c), 0);

/**
 * moveNode 뒤의 노드 번호(index = 문서 안 태그 순서). 웹뷰의 선택·펼침이 번호로 노드를 가리켜서, 옮긴 뒤 같은 노드를 계속 가리키게 바꿀 때 쓴다.
 * 옮긴 묶음(문서 순서대로)은 놓인 자리로, 그 사이 노드는 묶음 크기만큼 밀린다. 'inside'는 맨 뒤 자식으로(insertNode). 번호를 못 찾으면 undefined
 */
export function movedIndexes(root: XmlNode, dragged: number[], target: number, position: DropPosition): Map<number, number> | undefined {
	const t = nodeAt(root, target), nodes = dragged.map(i => nodeAt(root, i));
	if (!t || nodes.some(n => !n)) { return undefined; }
	const moved = new Set<number>();
	for (const n of nodes as XmlNode[]) { for (let i = n.index; i < n.index + sizeOf(n); i++) { moved.add(i); } }
	const all = Array.from({ length: root.index + sizeOf(root) }, (_, i) => i);
	const rest = all.filter(i => !moved.has(i)), at = position === 'before' ? t.index : t.index + sizeOf(t);
	const cut = rest.findIndex(i => i >= at);
	const order = cut < 0 ? [...rest, ...moved] : [...rest.slice(0, cut), ...[...moved].sort((a, b) => a - b), ...rest.slice(cut)];
	return new Map(order.map((old, now) => [old, now]));
}
