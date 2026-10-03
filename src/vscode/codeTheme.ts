// 코드 편집기 테마 고르기: 탭 줄 톱니바퀴 메뉴(또는 명령 팔레트) → 목록에서 위아래로 미리 보기, Enter로 적용(모든 화면 공통)
// 확장에 든 테마(media/themes)·가져온 테마(VS Code 테마 .json)도 목록에 같이, 덮어쓰기 설정(codeThemeCustomizations)은 어느 테마든 위에 얹는다
import * as path from 'path';
import * as fs from 'fs/promises';
import { readdirSync, readFileSync } from 'fs';
import * as vscode from 'vscode';
import { CODE_THEMES, customizationsFor, fromVsCodeTheme, parseJsonc, withCustomizations, type CodeThemeState, type ImportedTheme, type ThemeOverlay, type VsTheme } from '../core/codeTheme';
import type { ToWebview } from '../core/protocol';

const KEY = 'websquare5-editor.codeTheme';
const IMPORTED = 'websquare5-editor.importedCodeThemes';
const SETTING = 'websquare5-editor.codeThemeCustomizations';
const IMPORT_ITEM = '$import';
let globalState: vscode.Memento;

const imported = () => globalState.get<ImportedTheme[]>(IMPORTED, []);
let bundled: ImportedTheme[] = [];
/** 확장에 든 테마 + 가져온 테마(둘 다 VS Code 기본 다크·라이트 바탕 위에 변환한 색) */
const extraThemes = () => [...bundled, ...imported()];

/** media/themes의 VS Code 테마 .json(가져온 테마처럼 다루되 지울 수 없다). 읽지 못한 파일은 건너뛴다 */
function loadBundled(dir: string): ImportedTheme[] {
	let files: string[];
	try { files = readdirSync(dir).filter(f => f.endsWith('.json')).sort(); } catch { return []; }
	return files.flatMap(file => {
		try {
			const theme = parseJsonc(readFileSync(path.join(dir, file), 'utf8')) as VsTheme;
			const { dark, ...overlay } = fromVsCodeTheme(theme);
			const name = path.basename(file, '.json');
			return [{ id: `bundled:${name}`, label: theme.name?.trim() || name, dark, overlay }];
		} catch {
			return [];
		}
	});
}

/** 저장된 id가 내장·가져온 목록에 없으면 VS Code 따라가기 */
const currentId = () => {
	const id = globalState.get<string>(KEY);
	return CODE_THEMES.some(t => t.id === id) || extraThemes().some(t => t.id === id) ? id! : 'vscode';
};

/** id 테마를 웹뷰에 보낼 모양으로: 바탕 + (가져온 층) + 덮어쓰기 층 */
function stateOf(id: string): CodeThemeState {
	const setting = vscode.workspace.getConfiguration().get(SETTING);
	const own = extraThemes().find(t => t.id === id);
	if (own) {
		return { theme: 'vscode', dark: own.dark, id: own.id, label: own.label, imported: own.overlay, ...customizationsFor(setting, own.id, own.label) };
	}
	const builtIn = CODE_THEMES.find(t => t.id === id) ?? CODE_THEMES[0];
	return { theme: builtIn.id, id: builtIn.id, label: builtIn.label, ...customizationsFor(setting, builtIn.id, builtIn.label) };
}

export const codeTheme = () => stateOf(currentId());

/** 덮어쓰기 팝업 저장: 값이 있는 쪽(작업 공간이 있으면 작업 공간, 아니면 사용자 설정)에 쓴다. 바뀌면 설정 감시가 모든 화면에 보낸다 */
export async function saveCustomizations(common: ThemeOverlay | undefined, own: ThemeOverlay | undefined): Promise<void> {
	const { id = 'vscode', label = id } = stateOf(currentId());
	const config = vscode.workspace.getConfiguration(), info = config.inspect(SETTING);
	const target = info?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
	const current = target === vscode.ConfigurationTarget.Workspace ? info?.workspaceValue : info?.globalValue;
	const next = withCustomizations(current, id, label, common, own);
	await config.update(SETTING, Object.keys(next).length ? next : undefined, target);
}

export function registerCodeTheme(context: vscode.ExtensionContext, broadcast: (msg: ToWebview) => void): void {
	globalState = context.globalState;
	bundled = loadBundled(path.join(context.extensionPath, 'media', 'themes'));
	const send = (id: string) => broadcast({ type: 'codeTheme', ...stateOf(id) });
	context.subscriptions.push(
		vscode.commands.registerCommand('websquare5-editor.codeTheme', () => pickCodeTheme(send)),
		vscode.commands.registerCommand('websquare5-editor.importCodeTheme', () => importTheme(send)),
		vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration(SETTING)) { send(currentId()); } }),
	);
}

type Item = vscode.QuickPickItem & { id: string };
const REMOVE: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('trash'), tooltip: '가져온 테마 삭제' };

function pickCodeTheme(send: (id: string) => void): void {
	const current = currentId();
	const items = (): Item[] => [
		...CODE_THEMES.map(t => ({ id: t.id as string, label: t.label, description: 'dark' in t ? t.dark ? '어두움' : '밝음' : undefined })),
		...bundled.map(t => ({ id: t.id, label: t.label, description: t.dark ? '어두움' : '밝음' })),
		...imported().length ? [{ id: '', label: '가져온 테마', kind: vscode.QuickPickItemKind.Separator }] : [],
		...imported().map(t => ({ id: t.id, label: t.label, description: t.dark ? '어두움 · 가져옴' : '밝음 · 가져옴', buttons: [REMOVE] })),
		{ id: '', label: '', kind: vscode.QuickPickItemKind.Separator },
		{ id: IMPORT_ITEM, label: '$(folder-opened) 테마 파일 가져오기…', description: 'VS Code 테마 .json' },
	];
	const pick = vscode.window.createQuickPick<Item>();
	pick.title = '코드 편집기 테마';
	pick.placeholder = '위아래로 움직이면 미리 보기, Enter로 적용 (Esc: 취소)';
	pick.items = items();
	pick.activeItems = pick.items.filter(i => i.id === current);
	let chosen: string | undefined;
	let importing = false;
	pick.onDidChangeActive(([item]) => item && item.id !== IMPORT_ITEM && send(item.id));
	pick.onDidTriggerItemButton(async ({ item }) => {
		await globalState.update(IMPORTED, imported().filter(t => t.id !== item.id));
		pick.items = items();
	});
	pick.onDidAccept(() => {
		chosen = pick.activeItems[0]?.id;
		importing = chosen === IMPORT_ITEM;
		pick.hide();
	});
	pick.onDidHide(() => {
		// 지운 테마를 쓰던 중이면 currentId가 VS Code 따라가기로 돌린다
		const theme = chosen && !importing ? chosen : currentId();
		void globalState.update(KEY, theme);
		send(theme);
		pick.dispose();
		if (importing) { void importTheme(send); }
	});
	pick.show();
}

/** VS Code 테마 .json을 골라 변환해 목록에 넣고 바로 적용. 같은 이름이면 바꿔 넣는다 */
async function importTheme(send: (id: string) => void): Promise<void> {
	const [file] = await vscode.window.showOpenDialog({ title: 'VS Code 테마 파일 가져오기', filters: { 'VS Code 테마': ['json'] }, canSelectMany: false }) ?? [];
	if (!file) { return; }
	try {
		const theme = await readVsCodeTheme(file.fsPath);
		const { dark, ...overlay } = fromVsCodeTheme(theme);
		if (!overlay.colors && !overlay.tokens) { throw new Error('VS Code 테마 파일이 아니거나 색이 없어.'); }
		const label = theme.name?.trim() || path.basename(file.fsPath, '.json');
		const id = `custom:${label}`;
		await globalState.update(IMPORTED, [...imported().filter(t => t.id !== id), { id, label, dark, overlay }]);
		await globalState.update(KEY, id);
		send(id);
		void vscode.window.showInformationMessage(`'${label}' 테마를 가져와 적용했어. 문법 색은 비슷하게 맞춘 거라, 다르면 설정 codeThemeCustomizations로 고칠 수 있어.`);
	} catch (e) {
		void vscode.window.showErrorMessage(`테마를 못 가져왔어: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/** include(바탕 테마 파일)를 따라가 합친다: 바탕 색·규칙 먼저, 자기 것이 뒤(위) */
async function readVsCodeTheme(file: string, depth = 0): Promise<VsTheme> {
	const theme = parseJsonc(await fs.readFile(file, 'utf8')) as VsTheme;
	if (!theme || typeof theme !== 'object') { throw new Error('JSON 객체가 아니야.'); }
	if (typeof theme.include !== 'string' || depth > 4) { return theme; }
	const base = await readVsCodeTheme(path.resolve(path.dirname(file), theme.include), depth + 1);
	const rules = (t: typeof theme) => Array.isArray(t.tokenColors) ? t.tokenColors : [];
	return {
		...base, ...theme,
		colors: { ...base.colors, ...theme.colors },
		tokenColors: typeof theme.tokenColors === 'string' ? theme.tokenColors : [...rules(base), ...rules(theme)],
	};
}
