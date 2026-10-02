import * as path from 'node:path';
import * as vscode from 'vscode';
import { findApiDocs } from '../project/apiDocs';
import { findDefinitionFile } from '../project/components';
import { cached, exists, findWebRoot } from '../project/paths';
import { findWpack } from '../project/wpack';

export type SetupKey = 'eclipseInstallPath' | 'componentDefinitionFile' | 'wpackExecutable' | 'apiDocumentationPath';

const ITEMS: Record<SetupKey, { label: string; example: string; folder: boolean; filters?: Record<string, string[]> }> = {
	eclipseInstallPath: {
		label: 'Eclipse 설치 폴더', folder: true,
		example: '<Eclipse 설치 폴더> (예: C:\\eclipse_egov{버전}). 지정하면 아래 3개를 이 안에서 자동으로 찾는다',
	},
	componentDefinitionFile: {
		label: '컴포넌트 정의 파일', folder: false, filters: { 'WebSquareConfig.xml': ['xml'] },
		example: 'Eclipse 설치 폴더 밑 어딘가의 WebSquareConfig.xml (자동으로 못 찾을 때만 직접 지정)',
	},
	wpackExecutable: {
		label: 'wpack 변환기', folder: false, filters: { 'w-pack': ['js', 'exe'] },
		example: 'Eclipse 설치 폴더 밑 어딘가의 w-pack/index.js 또는 standalone_wpack-win.exe (자동으로 못 찾을 때만 직접 지정)',
	},
	apiDocumentationPath: {
		label: 'API 문서 폴더', folder: true,
		example: 'index.html·$p·WebSquare.*가 있는 폴더 (자동으로 못 찾을 때만 직접 지정)',
	},
};

function configuredPath(key: SetupKey, uri: vscode.Uri, webRoot?: string): string | undefined {
	const value = vscode.workspace.getConfiguration('websquare5-editor', uri).get<string>(key)?.trim();
	const base = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? webRoot ?? path.dirname(uri.fsPath);
	return value ? path.resolve(base, value) : undefined;
}

const FINDERS: Record<Exclude<SetupKey, 'eclipseInstallPath'>, (eclipseRoot: string) => Promise<string | undefined>> = {
	componentDefinitionFile: findDefinitionFile,
	wpackExecutable: findWpack,
	apiDocumentationPath: findApiDocs,
};

const autoCache = new Map<string, Promise<string | undefined>>();
export function clearAutoCache(): void {
	autoCache.clear();
}

export async function resolvePath(key: SetupKey, uri: vscode.Uri, webRoot?: string): Promise<string | undefined> {
	const configured = configuredPath(key, uri, webRoot);
	if (configured && await exists(configured)) {
		return configured;
	}
	if (key === 'eclipseInstallPath') {
		return undefined;
	}
	const eclipseRoot = configuredPath('eclipseInstallPath', uri, webRoot);
	if (!eclipseRoot) {
		return undefined;
	}
	return cached(autoCache, `${key}:${eclipseRoot}`, async () => {
		const found = await FINDERS[key](eclipseRoot);
		return found && await exists(found) ? found : undefined;
	});
}

export async function offerSetup(key: SetupKey, message: string): Promise<void> {
	const pick = ITEMS[key].folder ? '폴더 선택' : '파일 선택';
	if (await vscode.window.showWarningMessage(message, pick) === pick) {
		await choose(key);
	}
}

async function choose(key: SetupKey): Promise<void> {
	const item = ITEMS[key];
	const uri = referenceUri();
	const webRoot = uri && await findWebRoot(uri.fsPath);
	const current = uri && await resolvePath(key, uri, webRoot);
	const [picked] = await vscode.window.showOpenDialog({
		title: `${item.label}: ${item.example}`, openLabel: '선택', defaultUri: current ? vscode.Uri.file(item.folder ? current : path.dirname(current)) : undefined,
		canSelectFiles: !item.folder, canSelectFolders: item.folder, canSelectMany: false, filters: item.filters,
	}) ?? [];
	if (picked) {
		await vscode.workspace.getConfiguration('websquare5-editor').update(key, picked.fsPath, vscode.ConfigurationTarget.Global);
		void vscode.window.showInformationMessage(`${item.label} 저장: ${picked.fsPath}`);
	}
}

function referenceUri(): vscode.Uri | undefined {
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	return input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText ? input.uri : vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function updateSetupContext(): Promise<void> {
	const uri = referenceUri();
	const webRoot = uri && await findWebRoot(uri.fsPath);
	await Promise.all((Object.keys(ITEMS) as SetupKey[]).map(async key => vscode.commands.executeCommand(
		'setContext', `websquare5-editor.found.${key}`, !!uri && !!await resolvePath(key, uri, webRoot))));
}

export function registerSetup(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('websquare5-editor.setup', async () => {
			const uri = referenceUri();
			const webRoot = uri && await findWebRoot(uri.fsPath);
			const rows = await Promise.all((Object.keys(ITEMS) as SetupKey[]).map(async key => {
				const found = uri && await resolvePath(key, uri, webRoot);
				const auto = !uri || found !== configuredPath(key, uri, webRoot);
				return { key, label: `${found ? '$(check)' : '$(warning)'} ${ITEMS[key].label}`, description: found ? (auto ? '기본 위치에서 찾음' : '선택됨') : '선택 필요', detail: found ?? `${ITEMS[key].folder ? '폴더' : '파일'} 위치 예시: ${ITEMS[key].example}` };
			}));
			const row = await vscode.window.showQuickPick(rows, { title: 'WebSquare5 환경 설정', placeHolder: '설정할 파일 또는 폴더를 선택하세요' });
			if (row) {
				await choose(row.key);
			}
		}),
		vscode.commands.registerCommand('websquare5-editor.choose', (key: SetupKey) => choose(key)),
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('websquare5-editor')) {
				clearAutoCache();
				void updateSetupContext();
			}
		}),
	);
	void updateSetupContext();
}
