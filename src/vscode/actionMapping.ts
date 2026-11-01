// Submission action → Controller 메서드 열기. 작업 폴더의 .java에서 요청 경로를 직접 읽는다(Spring 확장·Java 서버 불필요)
import * as path from 'node:path';
import * as vscode from 'vscode';
import { actionPath, matchAction, parseMappings, type ActionMapping } from '../core/actionMapping';

/** 빌드 산출물·의존성 폴더는 찾지 않는다 */
const EXCLUDE = '{**/target/**,**/build/**,**/bin/**,**/out/**,**/node_modules/**,**/.git/**}';
const MAX_FILES = 20000;

/** 파일마다 읽은 매핑(수정 시각이 같으면 다시 읽지 않는다) */
const cache = new Map<string, { mtime: number; mappings: ActionMapping[] }>();

async function mappingsOf(uri: vscode.Uri): Promise<ActionMapping[]> {
	const { mtime } = await vscode.workspace.fs.stat(uri);
	const hit = cache.get(uri.toString());
	if (hit?.mtime === mtime) { return hit.mappings; }
	const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	const mappings = text.includes('Mapping') ? parseMappings(text) : [];
	cache.set(uri.toString(), { mtime, mappings });
	return mappings;
}

/**
 * action에 맞는 Controller 메서드를 연다. 여럿이면 고르게 하고, 없으면 알린다.
 * reveal: 화면의 연결 탭 파일이면 그 탭에서 보이고 true(아니면 VS Code 편집기로). notify: 못 찾으면 디자이너 화면 알림(토스트)
 */
export async function openAction(document: vscode.TextDocument, action: string, reveal: (uri: vscode.Uri, range: vscode.Range) => Promise<boolean>, notify: (message: string) => void): Promise<void> {
	if (actionPath(action) === '/') { return; }
	const folder = vscode.workspace.getWorkspaceFolder(document.uri);
	const found = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Controller 찾는 중' }, async () => {
		const files = await vscode.workspace.findFiles(folder ? new vscode.RelativePattern(folder, '**/*.java') : '**/*.java', EXCLUDE, MAX_FILES);
		const all = await Promise.all(files.map(async uri => (await mappingsOf(uri).catch(() => [])).map(m => ({ uri, ...m, score: matchAction(action, m.path) }))));
		const hits = all.flat().filter(h => h.score > 0);
		const best = Math.max(0, ...hits.map(h => h.score));
		return hits.filter(h => h.score === best);
	});
	if (!found.length) {
		notify(`요청 URL \`${action}\`에 맞는 Controller 매핑(@RequestMapping 등)을 찾지 못했습니다.`);
		return;
	}
	const relative = (uri: vscode.Uri) => folder ? path.relative(folder.uri.fsPath, uri.fsPath) : uri.fsPath;
	const pick = found.length === 1 ? found[0] : (await vscode.window.showQuickPick(
		found.map(h => ({ label: h.method, description: h.path, detail: relative(h.uri), hit: h })),
		{ title: `요청 URL ${action}`, placeHolder: '열 Controller 메서드' }))?.hit;
	if (!pick) { return; }
	// 열린 문서(저장 안 한 편집 포함)에서 그 메서드 줄을 다시 찾는다: 디스크 기준 줄과 다를 수 있다
	const doc = await vscode.workspace.openTextDocument(pick.uri);
	const line = parseMappings(doc.getText()).find(m => m.method === pick.method && m.path === pick.path)?.line ?? Math.min(pick.line, doc.lineCount - 1);
	const ch = Math.max(0, doc.lineAt(line).text.indexOf(pick.method));
	const range = new vscode.Range(line, ch, line, ch + pick.method.length);
	if (!await reveal(doc.uri, range)) {
		await vscode.window.showTextDocument(doc, { selection: range });
	}
}
