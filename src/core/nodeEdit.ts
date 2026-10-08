import { nodeAt, parseXml, pathTo, type XmlNode } from './xmlModel';
import { applyEdits, deleteNode, setAttribute, setAttributes, setText, type TextEdit } from './edit';
import { pasteNode } from './paste';
import { moveNode } from './move';
import { mergeCells, unmergeCells } from './merge';
import { idConflict } from './check';
import { addDataNode, editDataFields, isDataKind, renameDataRefs, type DataRename } from './data';
import { addSubmissionNode, editSubmissionNode } from './submission';
import { editChoices } from './choices';
import { editHistory } from './info';
import { addGridColumn, addGridPart, addGridRow, bindGridView, deleteGridColumns, editGridCells, moveGridColumn } from './grid';
import type { ToExtension } from './protocol';

export type NodeEdit = Extract<ToExtension, { type: 'setAttr' | 'setText' | 'paste' | 'delete' | 'move' | 'addData' | 'editDataFields' | 'addSubmission' | 'editSubmission' | 'editChoices' | 'editGridCells' | 'editHistory' | 'bindGrid' | 'addGridPart' | 'mergeCells' | 'unmergeCells' | 'gridColumns' }>;

/** XML 편집 계획: 규칙·검증·연관 바인딩을 계산한다. 문서 적용과 성공 알림은 호출자가 맡는다. */
export function prepareNodeEdit(text: string, msg: NodeEdit): { changes: TextEdit[]; notice?: string } | { error: string } | undefined {
	const root = parseXml(text);
	// id는 같은 범위(화면·그리드 부분·데이터 컬럼) 안에서 안 겹치게. 막으면 바꾸지 않는다
	const conflict = root && msg.type === 'setAttr' ? [{ name: msg.name, value: msg.value }, ...msg.also ?? []]
		.map(a => a.name === 'id' && a.value ? idConflict(root, msg.index, a.value) : undefined).find(Boolean) : undefined;
	if (conflict) {
		return { error: conflict };
	}
	const changes = root && nodeChanges(text, root, msg);
	if (!changes) {
		return undefined;
	}
	if (msg.type === 'editGridCells') {
		// 바꾼 뒤 문서에서 본다: 칸끼리 id를 맞바꾸거나 같은 id를 두 칸에 넣은 것까지
		const after = parseXml(applyEdits(text, changes));
		const clash = after && msg.cells.map(c => c.attrs.id ? idConflict(after, c.index, c.attrs.id) : undefined).find(Boolean);
		if (clash) {
			return { error: clash };
		}
	}
	const rename = root && changes.length ? dataRename(root, msg) : undefined;
	const refs = rename ? renameDataRefs(text, root!, rename) : [];
	let notice: string | undefined;
	if (rename && refs.length) {
		const { from, to, columns = new Map<string, string>() } = rename;
		const what = [...from !== to ? [`\`${from}\` → \`${to}\``] : [], ...[...columns].map(([a, b]) => `\`${from}.${a}\` → \`${b}\``)];
		notice = `바인딩 ${refs.length}곳도 함께 변경했습니다. ${what.join(', ')}`;
	}
	return { changes: [...changes, ...refs], notice };
}

/** 데이터 노드(dataList·dataMap 등)나 그 컬럼·키의 id를 바꾸는 편집이면 무엇을 바꾸는지 */
function dataRename(root: XmlNode, msg: NodeEdit): DataRename | undefined {
	if (msg.type === 'editDataFields') {
		const node = nodeAt(root, msg.index), from = node?.attrs.id;
		if (!node || !from) {
			return undefined;
		}
		const columns = new Map(msg.fields.flatMap(f => {
			const old = f.sourceIndex === undefined ? undefined : nodeAt(root, f.sourceIndex)?.attrs.id;
			return old && old !== f.id ? [[old, f.id] as const] : [];
		}));
		const to = msg.id || from;
		return to !== from || columns.size ? { from, to, columns } : undefined;
	}
	if (msg.type !== 'setAttr' || msg.name !== 'id' || msg.also?.length || !msg.value) {
		return undefined;
	}
	const path = pathTo(root, msg.index), node = path?.at(-1), old = node?.attrs.id;
	if (!path || !node || !old || old === msg.value) {
		return undefined;
	}
	if (isDataKind(node)) {
		return { from: old, to: msg.value };
	}
	// 데이터 > columnInfo·keyInfo > column·key
	const owner = path.at(-3), id = owner?.attrs.id;
	return owner && id && isDataKind(owner) && /:(columnInfo|keyInfo)$/.test(path.at(-2)!.tag) ? { from: id, to: id, columns: new Map([[old, msg.value]]) } : undefined;
}

function nodeChanges(text: string, root: XmlNode, msg: NodeEdit): TextEdit[] | undefined {
	const find = (index: number) => nodeAt(root, index);
	const all = (indexes: number[]) => {
		const nodes = indexes.map(find);
		return nodes.every(n => n) ? nodes as XmlNode[] : undefined;
	};
	const one = (change: TextEdit | undefined) => change ? [change] : [];
	if (msg.type === 'move') {
		const dragged = all([msg.dragged, ...msg.more ?? []]), target = find(msg.target);
		return dragged && target && moveNode(text, dragged, target, msg.position);
	}
	if (msg.type === 'mergeCells' || msg.type === 'unmergeCells') {
		const cells = all([msg.index, ...msg.more]);
		return cells && (msg.type === 'mergeCells' ? mergeCells : unmergeCells)(text, root, cells);
	}
	const path = pathTo(root, msg.index), node = path?.at(-1);
	if (!path || !node) {
		return undefined;
	}
	switch (msg.type) {
		case 'delete': return all([msg.index, ...msg.more ?? []])?.map(n => deleteNode(text, n));
		case 'addData': return [addDataNode(text, root, node, msg.kind)];
		case 'addSubmission': return [addSubmissionNode(text, root, node, msg.fields)];
		case 'addGridPart': return msg.part === 'column' || msg.part === 'columnLeft' ? addGridColumn(text, root, node, msg.at, msg.part === 'columnLeft' ? 'left' : 'right')
			: [msg.part === 'row' ? addGridRow(text, root, node, msg.at) : addGridPart(text, root, node, msg.part)];
		case 'bindGrid': {
			const list = find(msg.list);
			return list && one(bindGridView(text, root, node, list, msg.mode, msg.extras));
		}
		case 'editDataFields': return one(editDataFields(text, root, node, msg.fields, msg.id));
		case 'editSubmission': return one(editSubmissionNode(text, root, node, msg.fields));
		case 'editChoices': return one(editChoices(text, root, node, msg.fields));
		case 'editGridCells': return editGridCells(text, root, msg.cells);
		case 'editHistory': return one(editHistory(text, root, node, msg.rows));
		case 'gridColumns': return msg.op === 'delete' ? deleteGridColumns(text, node, msg.cells) : moveGridColumn(text, node, msg.cells[0], msg.op);
		case 'setAttr': {
			if (msg.also?.length) {
				return one(setAttributes(text, node, [{ name: msg.name, value: msg.value }, ...msg.also].map(a => [a.name, a.value]), path.slice(0, -1)));
			}
			// 같은 노드가 두 번 오면 같은 범위를 두 번 고쳐 원문이 깨지므로 처음 것만
			const targets = [{ index: msg.index, value: msg.value }, ...msg.more ?? []]
				.filter((t, i, all) => all.findIndex(o => o.index === t.index) === i).map(t => ({ ...t, path: pathTo(root, t.index) }));
			// 한 노드라도 못 찾으면(옛 버전) 아무것도 바꾸지 않는다. 각 편집은 그 노드의 시작 태그 안이라 서로 겹치지 않는다
			return targets.every(t => t.path) ? targets.flatMap(t => one(setAttribute(text, t.path!.at(-1)!, msg.name, t.value, t.path!.slice(0, -1)))) : undefined;
		}
		case 'paste': return one(pasteNode(text, root, node, msg.xml, msg.position));
		case 'setText': return one(setText(text, node, msg.value));
	}
}
