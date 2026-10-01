import * as vscode from 'vscode';
import { nodeAt, parseXml, pathTo, type XmlNode } from '../core/xmlModel';
import { applyEdits, applyLineChanges, deleteNode, editableScript, encodeScript, setAttribute, setText, sourceChange, type TextEdit } from '../core/edit';
import { pasteNode } from '../core/paste';
import { moveNode } from '../core/move';
import { addDataNode, editDataFields } from '../core/data';
import { addSubmissionNode, editSubmissionNode } from '../core/submission';
import { editChoices } from '../core/choices';
import { addGridColumn, addGridPart, addGridRow, bindGridView } from '../core/grid';
import type { CodeChange, CodeTarget, ToExtension } from '../core/protocol';

type NodeEdit = Extract<ToExtension, { type: 'setAttr' | 'setText' | 'paste' | 'delete' | 'move' | 'addData' | 'editDataFields' | 'addSubmission' | 'editSubmission' | 'editChoices' | 'bindGrid' | 'addGridPart' }>;

export async function applyNodeEdit(document: vscode.TextDocument, msg: NodeEdit): Promise<boolean> {
	const text = document.getText();
	const root = parseXml(text);
	const changes = root && nodeChanges(text, root, msg);
	if (!changes) {
		return false;
	}
	return !changes.length || applyTextEdits(document, changes);
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
		case 'setAttr': {
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

/** 이 언어를 다루는 확장(내장 제외)이 설치돼 있는지: 언어 서버가 아직 준비 안 됐을 수 있다 */
export function languageExtensionInstalled(languageId: string): boolean {
	return vscode.extensions.all.some(ext => {
		const pkg = ext.packageJSON as { name?: string; isBuiltin?: boolean; activationEvents?: string[]; contributes?: { languages?: { id: string }[] } } | undefined;
		// 이 확장도 onLanguage:xml을 걸고 있어서, 빼지 않으면 XML 포매터가 없을 때 늘 서버를 기다린다
		return !!pkg && !pkg.isBuiltin && !ext.id.startsWith('vscode.') && pkg.name !== 'websquare5-editor'
			&& (!!pkg.activationEvents?.includes(`onLanguage:${languageId}`) || !!pkg.contributes?.languages?.some(l => l.id === languageId));
	});
}

/** 기다려도 포매터가 없던 언어 → 그때 설치된 확장 수. 확장을 새로 설치하면 다시 기다린다 */
const noFormatter = new Map<string, number>();

/** 결과가 나올 때까지 1초마다 다시(최대 60초, 알림에서 취소 가능) */
async function waitFor<T>(title: string, attempt: () => Thenable<T | undefined>): Promise<T | undefined> {
	return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, async (_progress, token) => {
		for (let i = 0; i < 60 && !token.isCancellationRequested; i++) {
			await new Promise(r => setTimeout(r, 1000));
			const result = await attempt();
			if (result !== undefined) {
				return result;
			}
		}
		return undefined;
	});
}

export async function formatCode(document: vscode.TextDocument, target: CodeTarget): Promise<string | undefined> {
	if (target === 'script') {
		const source = editableScript(document.getText())?.text;
		if (source === undefined) {
			return undefined;
		}
		if (!source.trim()) {
			return source;
		}
		const prettier = await import('prettier');
		const known = new Set((await prettier.getSupportInfo()).options.map(o => o.name));
		// Prettier 확장이 기여하는 기본값(tabWidth 2 등)이 아래 기본 tabWidth 4를 덮지 않게, 사용자가 직접 설정한 값만 쓴다
		const config = vscode.workspace.getConfiguration('prettier', document.uri);
		const settings = Object.fromEntries([...known].flatMap(k => {
			if (!k) {
				return [];
			}
			const i = config.inspect(k);
			const value = i?.workspaceFolderValue ?? i?.workspaceValue ?? i?.globalValue;
			return value === undefined ? [] : [[k, value]];
		}));
		const options = await prettier.resolveConfig(document.uri.fsPath, { editorconfig: true }) ?? settings;
		// 프로젝트 설정(.prettierrc·.editorconfig)이 없으면 공백 4칸
		const formatted = await prettier.format(source, { tabWidth: 4, useTabs: false, ...options, parser: 'babel' });
		return source.match(/^\s*/)![0] + formatted.trim() + source.match(/\s*$/)![0];
	}
	const run = () => vscode.commands.executeCommand<vscode.TextEdit[] | undefined>('vscode.executeFormatDocumentProvider', document.uri, INDENT);
	// Java 등 언어 서버 확장은 서버가 다 뜬 뒤에야 포매터를 등록한다 → 설치돼 있으면 준비될 때까지 기다린다
	// 한 번 기다려도 없었던 언어(포매터 없는 확장)는 다시 기다리지 않는다
	const lang = document.languageId;
	let edits = await run();
	if (!edits && noFormatter.get(lang) !== vscode.extensions.all.length && languageExtensionInstalled(lang)) {
		edits = await waitFor(`'${lang}' 포매터 준비 중… (언어 서버 시작)`, run);
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
