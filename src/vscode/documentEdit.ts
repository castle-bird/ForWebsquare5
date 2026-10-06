import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { nodeAt, parseXml, pathTo, type XmlNode } from '../core/xmlModel';
import { applyEdits, applyLineChanges, deleteNode, editableScript, encodeScript, setAttribute, setAttributes, setText, sourceChange, type TextEdit } from '../core/edit';
import { pasteNode } from '../core/paste';
import { moveNode } from '../core/move';
import { mergeCells, unmergeCells } from '../core/merge';
import { idConflict } from '../core/check';
import { addDataNode, editDataFields, isDataKind, renameDataRefs, type DataRename } from '../core/data';
import { addSubmissionNode, editSubmissionNode } from '../core/submission';
import { editChoices } from '../core/choices';
import { editHistory } from '../core/info';
import { addGridColumn, addGridPart, addGridRow, bindGridView, deleteGridColumns, editGridCells, moveGridColumn } from '../core/grid';
import type { CodeChange, CodeTarget, ToExtension } from '../core/protocol';

type NodeEdit = Extract<ToExtension, { type: 'setAttr' | 'setText' | 'paste' | 'delete' | 'move' | 'addData' | 'editDataFields' | 'addSubmission' | 'editSubmission' | 'editChoices' | 'editGridCells' | 'editHistory' | 'bindGrid' | 'addGridPart' | 'mergeCells' | 'unmergeCells' | 'gridColumns' }>;

/** notify: 같이 바꾼 것(데이터·컬럼 id를 바꿔 바인딩도 바꿈)·막은 이유(겹치는 id)를 알린다 */
export async function applyNodeEdit(document: vscode.TextDocument, msg: NodeEdit, notify?: (message: string) => void): Promise<boolean> {
	const text = document.getText();
	const root = parseXml(text);
	// id는 같은 범위(화면·그리드 부분·데이터 컬럼) 안에서 안 겹치게. 막으면 바꾸지 않는다
	const conflict = root && msg.type === 'setAttr' ? [{ name: msg.name, value: msg.value }, ...msg.also ?? []]
		.map(a => a.name === 'id' && a.value ? idConflict(root, msg.index, a.value) : undefined).find(Boolean) : undefined;
	if (conflict) {
		notify?.(conflict);
		return false;
	}
	const changes = root && nodeChanges(text, root, msg);
	if (!changes) {
		return false;
	}
	if (msg.type === 'editGridCells') {
		// 바꾼 뒤 문서에서 본다: 칸끼리 id를 맞바꾸거나 같은 id를 두 칸에 넣은 것까지
		const after = parseXml(applyEdits(text, changes));
		const clash = after && msg.cells.map(c => c.attrs.id ? idConflict(after, c.index, c.attrs.id) : undefined).find(Boolean);
		if (clash) {
			notify?.(clash);
			return false;
		}
	}
	const rename = root && changes.length ? dataRename(root, msg) : undefined;
	const refs = rename ? renameDataRefs(text, root!, rename) : [];
	const ok = !changes.length || await applyTextEdits(document, [...changes, ...refs]);
	if (ok && rename && refs.length) {
		const { from, to, columns = new Map<string, string>() } = rename;
		const what = [...from !== to ? [`\`${from}\` → \`${to}\``] : [], ...[...columns].map(([a, b]) => `\`${from}.${a}\` → \`${b}\``)];
		notify?.(`바인딩 ${refs.length}곳도 함께 변경했습니다. ${what.join(', ')}`);
	}
	return ok;
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

export function applyTextEdits(document: vscode.TextDocument, changes: TextEdit[], base = 0): Thenable<boolean> {
	const edit = new vscode.WorkspaceEdit();
	const at = (offset: number) => document.positionAt(base + offset);
	for (const change of changes) {
		edit.replace(document.uri, new vscode.Range(at(change.start), at(change.end)), change.replacement);
	}
	return vscode.workspace.applyEdit(edit);
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
		const cells = [msg.index, ...msg.more].map(find);
		return cells.every(c => c) ? (msg.type === 'mergeCells' ? mergeCells : unmergeCells)(text, root, cells as XmlNode[]) : undefined;
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
		case 'paste': return one(pasteNode(text, root, node, msg.xml));
		case 'setText': return one(setText(text, node, msg.value));
	}
}

/** script는 화면 XML의 Script 본문, 그 밖(source·연결 파일)은 문서 전체 */
export async function applyCodeEdit(document: vscode.TextDocument, target: CodeTarget, changes: CodeChange[]): Promise<boolean> {
	if (target !== 'script') {
		const edit = new vscode.WorkspaceEdit();
		for (const c of changes) {
			edit.replace(document.uri, new vscode.Range(c.fromLine, c.fromCh, c.toLine, c.toCh), c.insert);
		}
		return vscode.workspace.applyEdit(edit);
	}
	const text = document.getText(), body = editableScript(text);
	if (!body) {
		return false;
	}
	const change = sourceChange(text.slice(body.start, body.end), encodeScript(applyLineChanges(body.text, changes), body.cdata));
	return !change || applyTextEdits(document, [change], body.start);
}

/** 포맷 들여쓰기는 파일·VS Code 설정과 상관없이 공백 4칸(편집기 들여쓰기 단위와 같음) */
const INDENT: vscode.FormattingOptions = { tabSize: 4, insertSpaces: true };

/** 이 언어를 다루는 확장(내장 제외): 언어 서버가 아직 준비 안 됐을 수 있다 */
function languageExtensions(languageId: string) {
	return vscode.extensions.all.filter(ext => {
		const pkg = ext.packageJSON as { name?: string; isBuiltin?: boolean; activationEvents?: string[]; contributes?: { languages?: { id: string }[] } } | undefined;
		// 이 확장도 onLanguage:xml을 걸고 있어서, 빼지 않으면 XML 포매터가 없을 때 늘 서버를 기다린다
		return !!pkg && !pkg.isBuiltin && !ext.id.startsWith('vscode.') && pkg.name !== 'websquare5-editor'
			&& (!!pkg.activationEvents?.includes(`onLanguage:${languageId}`) || !!pkg.contributes?.languages?.some(l => l.id === languageId));
	});
}

/**
 * 언어 서버가 다 떴다는 신호(redhat.java API의 serverReady 같은). Java는 프로젝트를 다 불러와야 포매터가 생기는데
 * 프로젝트가 커서 오래 걸리면 정해진 시간으로는 모자라서, 이 신호가 오기 전에는 포기하지 않는다
 */
async function serverReady(extensions: vscode.Extension<unknown>[]): Promise<{ ready: Promise<unknown> } | undefined> {
	for (const ext of extensions) {
		const api = await Promise.resolve(ext.isActive ? ext.exports : ext.activate()).catch(() => undefined) as { serverReady?: () => Promise<unknown> } | undefined;
		if (typeof api?.serverReady === 'function') {
			// 감싸서 돌려준다(async 함수가 그대로 돌려주면 준비될 때까지 기다려 버림)
			return { ready: api.serverReady() };
		}
	}
	return undefined;
}

/** 기다려도 포매터가 없던 언어 → 그때 설치된 확장 수. 확장을 새로 설치하면 다시 기다린다 */
const noFormatter = new Map<string, number>();

/**
 * 결과가 나올 때까지 0.3초마다 다시(알림에서 취소 가능). ready가 있으면 그게 끝난 뒤 5초까지, 없으면 60초까지.
 * 포매터는 ready보다 먼저 등록되기도 해서(Java: 4.6초 vs 10초) ready만 기다리지 않고 계속 물어본다
 */
async function waitFor<T>(title: string, attempt: () => Thenable<T | undefined>, ready?: Promise<unknown>): Promise<T | undefined> {
	return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, async (_progress, token) => {
		let deadline = ready ? Infinity : Date.now() + 60_000;
		void ready?.then(() => { deadline = Date.now() + 5_000; }, () => { deadline = Date.now(); });
		while (Date.now() < deadline && !token.isCancellationRequested) {
			await new Promise(r => setTimeout(r, 300));
			const result = await attempt();
			if (result !== undefined) {
				return result;
			}
		}
		return undefined;
	});
}

/**
 * 포맷: 그 사용자의 VS Code 포매터(언어별 기본 포매터 설정, 없으면 VS Code 내장)를 그대로 쓴다.
 * Script는 화면 XML 안 JS라 VS Code가 JS로 보지 않으므로, 임시 .js 파일로 꺼내 JS 포매터로 포맷하고 본문만 돌려준다(CDATA 앞뒤 공백 유지)
 */
export async function formatCode(document: vscode.TextDocument, target: CodeTarget): Promise<string | undefined> {
	if (target !== 'script') {
		return formatDocument(document);
	}
	const source = editableScript(document.getText())?.text;
	if (source === undefined || !source.trim()) {
		return source;
	}
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws5-script-'));
	const file = vscode.Uri.file(path.join(dir, 'script.js'));
	try {
		await fs.writeFile(file.fsPath, source);
		const formatted = await formatDocument(await vscode.workspace.openTextDocument(file), true);
		return formatted === undefined ? undefined : source.match(/^\s*/)![0] + formatted.trim() + source.match(/\s*$/)![0];
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

/** 문서를 VS Code 포매터로 포맷한 결과(문서는 그대로). builtIn: VS Code 내장 언어 기능(JS 등)이라 처음 부르면 켜지는 동안 잠깐 다시 묻는다 */
async function formatDocument(document: vscode.TextDocument, builtIn = false): Promise<string | undefined> {
	const run = () => vscode.commands.executeCommand<vscode.TextEdit[] | undefined>('vscode.executeFormatDocumentProvider', document.uri, INDENT);
	// Java 등 언어 서버 확장은 서버가 다 뜬 뒤에야 포매터를 등록한다 → 설치돼 있으면 준비될 때까지 기다린다
	// 한 번 기다려도 없었던 언어(포매터 없는 확장)는 다시 기다리지 않는다
	const lang = document.languageId;
	let edits = await run();
	for (let i = 0; builtIn && !edits && i < 10; i++) {
		await new Promise(r => setTimeout(r, 300));
		edits = await run();
	}
	const extensions = !edits && noFormatter.get(lang) !== vscode.extensions.all.length ? languageExtensions(lang) : [];
	if (extensions.length) {
		edits = await waitFor(`'${lang}' 포매터 준비 중… (언어 서버 시작)`, run, (await serverReady(extensions))?.ready);
		if (!edits) {
			noFormatter.set(lang, vscode.extensions.all.length);
		}
	}
	if (!edits) {
		void vscode.window.showInformationMessage(`'${lang}' 파일 포매터가 설치되어 있지 않습니다.`, '포매터 설치...')
			.then(pick => pick && vscode.commands.executeCommand('workbench.extensions.search', `category:formatters ${lang}`));
		return undefined;
	}
	return applyEdits(document.getText(), edits.map(e => ({ start: document.offsetAt(e.range.start), end: document.offsetAt(e.range.end), replacement: e.newText })));
}
