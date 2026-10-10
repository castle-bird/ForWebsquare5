import { deleteNode, eolOf, leadOf, type TextEdit } from './edit';
import { isContainer, isStructure } from './paste';
import { localName, pathTo, uniqueId, usedIds, XFORMS_NS, type XmlNode } from './xmlModel';

/** 원문을 다른 부모로 옮기지 않고 같은 부모 아래 컴포넌트만 감싼다. */
export function wrapProblem(root: XmlNode, nodes: XmlNode[]): string | undefined {
	if (!nodes.length) { return '감쌀 컴포넌트를 선택해 주세요.'; }
	const paths = nodes.map(n => pathTo(root, n.index));
	if (paths.some(path => !path || !path.slice(0, -1).some(n => localName(n.tag) === 'body') || isStructure(path.at(-1)!))) {
		return '화면 안의 컴포넌트만 그룹으로 감쌀 수 있습니다.';
	}
	const parent = paths[0]!.at(-2)!;
	if (paths.some(path => path!.at(-2) !== parent)) { return '같은 부모 아래의 컴포넌트를 선택해 주세요.'; }
	if (!isContainer(parent) || ['table', 'thead', 'tbody', 'tfoot', 'tr'].includes(parent.attrs.tagname)
		|| paths.some(path => path!.slice(0, -1).some(n => localName(n.tag) === 'gridView'))) {
		return '표·그리드의 구조 안에는 감싸는 Group을 넣을 수 없습니다.';
	}
	return undefined;
}

export function wrapComponents(text: string, root: XmlNode, nodes: XmlNode[]): { changes: TextEdit[]; id: string } {
	const problem = wrapProblem(root, nodes);
	if (problem) { throw new Error(problem); }
	const ordered = [...new Set(nodes)].sort((a, b) => a.start - b.start);
	const first = ordered[0], path = pathTo(root, first.index)!;
	const scope = Object.assign({}, ...path.slice(0, -1).map(n => Object.fromEntries(Object.entries(n.attrs).filter(([key]) => key === 'xmlns' || key.startsWith('xmlns:'))))) as Record<string, string>;
	const declaration = Object.keys(scope).find(key => scope[key] === XFORMS_NS);
	let prefix = declaration === 'xmlns' ? '' : declaration?.slice(6);
	if (prefix === undefined) {
		prefix = 'xf';
		for (let i = 1; scope['xmlns:' + prefix] !== undefined; i++) { prefix = 'xf' + i; }
	}
	const tag = (prefix ? prefix + ':' : '') + 'group';
	const xmlns = declaration ? '' : ` xmlns:${prefix}="${XFORMS_NS}"`;
	const id = uniqueId(usedIds(root), 'group'), lead = leadOf(text, first.start) ?? '', eol = eolOf(text);
	const unit = /^([ \t]+)</m.exec(text)?.[1] ?? '\t';
	// 자손의 텍스트·CDATA를 바꾸지 않도록 원문 내부 들여쓰기는 그대로 둔다.
	const children = ordered.map(n => lead + unit + text.slice(n.start, n.end)).join(eol);
	const replacement = `<${tag} id="${id}"${xmlns}>${eol}${children}${eol}${lead}</${tag}>`;
	return { id, changes: [{ start: first.start, end: first.end, replacement }, ...ordered.slice(1).map(n => deleteNode(text, n))] };
}
