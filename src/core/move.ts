import { deleteNode, eolOf, leadOf, type TextEdit } from './edit';
import { insertNode, reindentLines, type DropPosition } from './paste';
import type { XmlNode } from './xmlModel';

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
