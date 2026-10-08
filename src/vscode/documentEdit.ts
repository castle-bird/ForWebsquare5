import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CodeChange, CodeTarget } from '../core/protocol';
import { applyEdits, editableScript, encodeScript, applyLineChanges, sourceChange, type TextEdit } from '../core/edit';
import { prepareNodeEdit, type NodeEdit } from '../core/nodeEdit';

/** 문서 적용에 성공했을 때만 연관 바인딩 변경을 알린다. */
export async function applyNodeEdit(document: vscode.TextDocument, msg: NodeEdit, notify?: (message: string) => void): Promise<boolean> {
	const plan = prepareNodeEdit(document.getText(), msg);
	if (!plan) { return false; }
	if ('error' in plan) { notify?.(plan.error); return false; }
	const ok = !plan.changes.length || await applyTextEdits(document, plan.changes);
	if (ok && plan.notice) { notify?.(plan.notice); }
	return ok;
}

export function applyTextEdits(document: vscode.TextDocument, changes: TextEdit[], base = 0): Thenable<boolean> {
	const edit = new vscode.WorkspaceEdit();
	const at = (offset: number) => document.positionAt(base + offset);
	for (const change of changes) {
		edit.replace(document.uri, new vscode.Range(at(change.start), at(change.end)), change.replacement);
	}
	return vscode.workspace.applyEdit(edit);
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
