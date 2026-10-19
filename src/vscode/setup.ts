import * as path from 'node:path';
import * as vscode from 'vscode';
import { findApiDocs } from '../project/apiDocs';
import { findDefinitionFile } from '../project/components';
import { eclipseUsage, findInstalls, findLocalInstalls, isInside } from '../project/discover';
import { cached, exists, findWebRoot, numeric } from '../project/paths';
import { findWpack } from '../project/wpack';

export type SetupKey = 'eclipseInstallPath' | 'componentDefinitionFile' | 'wpackExecutable' | 'apiDocumentationPath';
type FileKey = Exclude<SetupKey, 'eclipseInstallPath'>;

const ITEMS: Record<SetupKey, { label: string; example: string; folder: boolean; filters?: Record<string, string[]> }> = {
	eclipseInstallPath: {
		label: 'Eclipse 설치 폴더', folder: true,
		example: 'Eclipse 또는 WebSquare Studio 설치 폴더 (예: C:\\eclipse_egov{버전}). 비워 두면 로컬 드라이브에서 자동으로 찾습니다',
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

/** 자동 탐색 시간 제한: 화면을 열다 저절로 찾을 때는 짧게, 사용자가 직접 찾기를 눌렀을 때는 넉넉히 */
const AUTO_LIMIT = 20_000, EXPLICIT_LIMIT = 60_000;
/** 기억한 설치본 목록이 이보다 오래되면 시작이 끝난 뒤 조용히 다시 찾는다(그사이 새 버전을 설치했을 수 있다) */
const RESCAN_AFTER = 7 * 24 * 60 * 60 * 1000;
const FILE_KEYS: FileKey[] = ['componentDefinitionFile', 'wpackExecutable', 'apiDocumentationPath'];

/**
 * 이 PC에서 찾은 설치본(Eclipse 폴더) 목록과 설치본마다 찾아 둔 파일 위치. 확장 전용 상태(globalState)라 설정 동기화로 다른 PC에 가지 않는다.
 * 다음 실행부터는 폴더를 다시 뒤지지 않고 파일이 그대로 있는지만 확인한다
 */
interface Installs { roots: string[]; files: Record<string, Partial<Record<FileKey, string>>>; scannedAt?: number }
/** 이 프로젝트(작업 공간)에 쓰는 설치본(workspaceState). picked: 사용자가 고름(전역 설정보다 우선), 아니면 자동으로 고름(설정이 있으면 설정이 우선) */
interface Chosen { root: string; picked: boolean }
const INSTALLS = 'for-websquare5.installs', CHOSEN = 'for-websquare5.installRoot';

/** registerSetup에서 받는다. 없으면(테스트가 모듈만 불러온 경우) 기억·자동 탐색 없이 설정만 본다 */
let globalMemo: vscode.Memento | undefined, workspaceMemo: vscode.Memento | undefined;
let autoDiscover = false;
const installs = (): Installs => ({ roots: [], files: {}, ...globalMemo?.get<Installs>(INSTALLS) });
const chosen = () => workspaceMemo?.get<Chosen>(CHOSEN);

/** 읽기와 쓰기 사이에 await가 없어야 동시에 기억한 다른 값을 덮어쓰지 않는다 */
const updateInstalls = (change: (current: Installs) => Installs) => Promise.resolve(globalMemo?.update(INSTALLS, change(installs())));

const installChanged = new vscode.EventEmitter<void>();
/** 설치 폴더를 자동으로 고르거나 이 프로젝트에서 바꿨을 때, 기억한 파일 위치가 바뀌었을 때(설정 변경은 onDidChangeConfiguration으로 따로 온다) */
export const onDidChangeInstall = installChanged.event;

function configuredPath(key: SetupKey, uri: vscode.Uri, webRoot?: string): string | undefined {
	const value = vscode.workspace.getConfiguration('for-websquare5', uri).get<string>(key)?.trim();
	const base = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? webRoot ?? path.dirname(uri.fsPath);
	return value ? path.resolve(base, value) : undefined;
}

const FINDERS: Record<FileKey, (eclipseRoot: string) => Promise<string | undefined>> = {
	componentDefinitionFile: findDefinitionFile,
	wpackExecutable: findWpack,
	apiDocumentationPath: findApiDocs,
};

const autoCache = new Map<string, Promise<string | undefined>>();
export function clearAutoCache(): void {
	autoCache.clear();
}

/** 설치 폴더 밑을 뒤져 찾는다. 같은 세션에서는 폴더당 한 번 */
const scan = (key: FileKey, root: string) => cached(autoCache, `${key}:${root}`, async () => {
	const found = await FINDERS[key](root);
	return found && await exists(found) ? found : undefined;
});

function rememberFile(root: string, key: FileKey, file: string): void {
	if (installs().files[root]?.[key] !== file) {
		void updateInstalls(i => ({ ...i, files: { ...i.files, [root]: { ...i.files[root], [key]: file } } }));
	}
}

/**
 * 쓸 설치 폴더(실제로 있는 것만): 이 프로젝트에서 고른 것 → 설정값 → 이 프로젝트에 자동으로 골라 둔 것 →
 * (autoPick이고 WebSquare5 웹 루트 안에서 물었으면) 지금 자동으로 고르기
 */
async function installRoot(uri: vscode.Uri, webRoot: string | undefined, autoPick: boolean): Promise<string | undefined> {
	const current = chosen();
	if (current?.picked && await exists(current.root)) {
		return current.root;
	}
	const configured = configuredPath('eclipseInstallPath', uri, webRoot);
	if (configured && await exists(configured)) {
		return configured;
	}
	if (current && !current.picked && await exists(current.root)) {
		return current.root;
	}
	return autoPick && webRoot ? autoChoose(webRoot) : undefined;
}

async function findInInstall(root: string, key: FileKey, checkRevalidate = false): Promise<string | undefined> {
	const known = installs().files[root]?.[key];
	if (known && await exists(known)) {
		if (checkRevalidate) {
			revalidate(root);
		}
		return known;
	}
	const found = await scan(key, root);
	if (found) {
		rememberFile(root, key, found);
	}
	return found;
}

export async function resolvePath(key: SetupKey, uri: vscode.Uri, webRoot?: string): Promise<string | undefined> {
	if (key === 'eclipseInstallPath') {
		return installRoot(uri, webRoot, false);
	}
	const configured = configuredPath(key, uri, webRoot);
	if (configured && await exists(configured)) {
		return configured;
	}
	const root = await installRoot(uri, webRoot, true);
	return root && findInInstall(root, key, true);
}

/**
 * 기억한 위치를 쓰면 세션마다 한 번, 시작이 끝난 뒤 설치 폴더를 다시 뒤져 본다(같은 폴더에 새 버전을 덮어 설치했을 수 있다).
 * 달라졌으면 기억을 고치고 열린 화면이 다시 읽게 알린다
 */
const revalidated = new Set<string>();
function revalidate(root: string): void {
	if (revalidated.has(root)) {
		return;
	}
	revalidated.add(root);
	// 실패하면(설치 폴더를 못 읽음 등) 기억한 경로를 그대로 쓴다
	setTimeout(() => void recheck(root).catch(() => undefined), 15_000);
}

async function recheck(root: string): Promise<void> {
	const found = await Promise.all(FILE_KEYS.map(async key => [key, await scan(key, root).catch(() => undefined)] as const));
	const known = installs().files[root] ?? {};
	const files = { ...known };
	for (const [key, file] of found) {
		if (file) {
			files[key] = file;
		} else {
			delete files[key];
		}
	}
	if (FILE_KEYS.some(key => files[key] !== known[key])) {
		await updateInstalls(i => ({ ...i, files: { ...i.files, [root]: files } }));
		installChanged.fire();
	}
}

const existing = async (roots: string[]) => (await Promise.all(roots.map(async root => await exists(root) ? root : undefined))).filter(root => root !== undefined);

const definitionOf = (root: string) => findInInstall(root, 'componentDefinitionFile');

/** opened: 이 프로젝트를 작업 공간으로 연 적 있는 Eclipse. lastUsed: 그 Eclipse를 마지막으로 실행한 시각 */
interface Candidate { root: string; definition: string; opened: boolean; lastUsed: number }
const engineVersion = (c: Candidate) => path.basename(path.dirname(c.definition));

/**
 * 설치본이 여러 개일 때(전자정부 프레임워크 버전별 Eclipse 등) 고르는 순서:
 * 이 프로젝트(near)를 작업 공간으로 연 Eclipse → 가장 최근에 실행한 Eclipse → 엔진 버전이 높은 것. 컴포넌트 정의 파일이 없는 설치본은 뺀다
 */
async function rank(roots: string[], near?: string): Promise<Candidate[]> {
	const found = await Promise.all(roots.map(async root => {
		const [definition, usage] = await Promise.all([definitionOf(root), eclipseUsage(root)]);
		return definition ? { root, definition, opened: !!near && usage.workspaces.some(ws => isInside(near, ws)), lastUsed: usage.lastUsed } : undefined;
	}));
	return found.filter(c => c !== undefined)
		.sort((a, b) => Number(b.opened) - Number(a.opened) || b.lastUsed - a.lastUsed || numeric(engineVersion(b), engineVersion(a)));
}

function reasonOf([best, next]: Candidate[]): string {
	if (best.opened && !next?.opened) {
		return '이 프로젝트를 연 Eclipse';
	}
	return next && best.lastUsed !== next.lastUsed ? '가장 최근에 실행한 Eclipse' : '엔진 버전이 가장 높은 것';
}

/** 찾은 설치본 중 정의 파일이 있는 것을 기억한다. 시간 초과로 다 못 봤으면 전에 찾아 둔 것도 남긴다 */
async function saveRoots(found: string[], complete: boolean): Promise<string[]> {
	const usable = (await Promise.all(found.map(async root => await definitionOf(root) ? root : undefined))).filter(root => root !== undefined);
	const roots = complete ? usable : [...new Set([...usable, ...await existing(installs().roots)])];
	await updateInstalls(i => ({ ...i, roots, scannedAt: Date.now() }));
	return roots;
}

/** 로컬 드라이브에서 설치본 찾기(진행 알림, 취소 가능) */
function searchLocal(limit: number): Thenable<string[]> {
	return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'WebSquare5 설치 폴더를 찾는 중입니다…', cancellable: true }, async (_progress, token) => {
		const { installs: found, complete } = await findLocalInstalls({ deadline: Date.now() + limit, cancelled: () => token.isCancellationRequested });
		return saveRoots(found, complete);
	});
}

let refreshing = false;
function refreshLater(): void {
	if (refreshing || Date.now() - (installs().scannedAt ?? 0) < RESCAN_AFTER) {
		return;
	}
	refreshing = true;
	setTimeout(() => void findLocalInstalls({ deadline: Date.now() + EXPLICIT_LIMIT })
		.then(({ installs: found, complete }) => saveRoots(found, complete)).catch(() => undefined), 60_000);
}

/**
 * 설정도 고른 폴더도 없을 때 세션당 한 번 이 프로젝트에 쓸 설치본을 자동으로 고른다. 이 PC에서 처음이면 드라이브를 찾는다.
 * 고르면 이 프로젝트에 기억하고 알린다. 못 찾으면 조용히 끝내고, 안내는 그 기능을 쓸 때(offerSetup) 한 번 한다
 */
let choosing: Promise<string | undefined> | undefined;
function autoChoose(webRoot: string): Promise<string | undefined> {
	if (!autoDiscover) {
		return Promise.resolve(undefined);
	}
	return choosing ??= (async () => {
		let roots = await existing(installs().roots);
		const fresh = !roots.length;
		if (fresh) {
			roots = await searchLocal(AUTO_LIMIT);
		} else {
			refreshLater();
		}
		const ranked = await rank(roots, webRoot);
		const [best] = ranked;
		if (!best) {
			return undefined;
		}
		await workspaceMemo?.update(CHOSEN, { root: best.root, picked: false } satisfies Chosen);
		installChanged.fire();
		void updateSetupContext();
		if (fresh || ranked.length > 1) {
			void announce(ranked);
		}
		return best.root;
	})().catch(() => undefined);
}

async function announce(ranked: Candidate[]): Promise<void> {
	const many = ranked.length > 1;
	const other = many ? '다른 설치본 선택' : '다른 폴더 선택';
	const message = many
		? `이 프로젝트에 WebSquare5 설치 폴더를 적용했습니다: ${ranked[0].root} (찾은 설치본 ${ranked.length}개 중 ${reasonOf(ranked)})`
		: `WebSquare5 설치 폴더를 찾아 적용했습니다: ${ranked[0].root}`;
	if (await vscode.window.showInformationMessage(message, other) === other) {
		await (many ? pickInstall(ranked) : choose('eclipseInstallPath'));
	}
}

/** 찾은 설치본 중 이 프로젝트에 쓸 것 고르기(프로젝트마다 기억, 전역 설정보다 우선). 목록에 없으면 폴더를 직접 고른다 */
async function pickInstall(ranked: Candidate[]): Promise<void> {
	const manual = { label: '$(folder-opened) 폴더 직접 선택…', description: '모든 프로젝트에 적용', root: '' };
	const items = ranked.map(c => ({
		label: c.root, root: c.root,
		description: [`엔진 ${engineVersion(c)}`, c.opened && '이 프로젝트를 연 Eclipse', c.lastUsed && `최근 실행 ${new Date(c.lastUsed).toLocaleDateString('ko-KR')}`].filter(Boolean).join(' · '),
	}));
	const picked = await vscode.window.showQuickPick([...items, manual], { title: '이 프로젝트에 쓸 WebSquare5 설치 폴더', placeHolder: '설치본을 선택하세요' });
	if (picked === manual) {
		await choose('eclipseInstallPath');
	} else if (picked) {
		await workspaceMemo?.update(CHOSEN, { root: picked.root, picked: true } satisfies Chosen);
		installChanged.fire();
		void updateSetupContext();
		void vscode.window.showInformationMessage(`이 프로젝트의 WebSquare5 설치 폴더: ${picked.root}`);
	}
}

/** 사용자가 직접 자동 찾기를 눌렀을 때: 하나만 찾아도 확인받는다 */
async function searchNow(): Promise<void> {
	const roots = await searchLocal(EXPLICIT_LIMIT);
	const ranked = await rank(roots, await nearRoot());
	if (ranked.length) {
		await pickInstall(ranked);
	} else if (await vscode.window.showWarningMessage('로컬 드라이브에서 WebSquare5 설치 폴더를 찾지 못했습니다. Eclipse(또는 WebSquare Studio) 설치 폴더를 직접 선택해 주세요.', '폴더 선택') === '폴더 선택') {
		await choose('eclipseInstallPath');
	}
}

/**
 * 고른 폴더에서 설치본 찾기: 그 폴더 밑에 정의 파일이 있으면 그 폴더, 없으면(너무 넓게 골랐으면) 그 밑의 설치본.
 * D:\ 같은 넓은 폴더도 얕은 곳부터 플러그인 폴더를 찾으므로 깊은 곳을 다 뒤지지 않는다
 */
async function installUnder(dir: string): Promise<string | undefined> {
	if (await findDefinitionFile(dir)) {
		return dir;
	}
	const { installs: found } = await findInstalls([dir], { deadline: Date.now() + EXPLICIT_LIMIT });
	return (await rank(found, await nearRoot()))[0]?.root;
}

async function save(key: SetupKey, value: string): Promise<void> {
	await vscode.workspace.getConfiguration('for-websquare5').update(key, value, vscode.ConfigurationTarget.Global);
	void vscode.window.showInformationMessage(`${ITEMS[key].label} 저장: ${value}`);
}

const SEARCH = '다시 자동으로 찾기';

/** 못 찾은 항목 안내. 설치 폴더부터 모르면 설치 폴더를 고르게 한다(고르면 나머지는 그 안에서 찾는다) */
export async function offerSetup(key: SetupKey, message: string, uri?: vscode.Uri, webRoot?: string): Promise<void> {
	if (key !== 'eclipseInstallPath' && uri && !await resolvePath('eclipseInstallPath', uri, webRoot)) {
		key = 'eclipseInstallPath';
		message = 'WebSquare5 설치 폴더를 찾지 못했습니다. Eclipse(또는 WebSquare Studio) 설치 폴더를 선택해 주세요.';
	}
	const pick = ITEMS[key].folder ? '폴더 선택' : '파일 선택';
	const answer = await vscode.window.showWarningMessage(message, pick, ...key === 'eclipseInstallPath' ? [SEARCH] : []);
	if (answer === pick) {
		await choose(key);
	} else if (answer === SEARCH) {
		await searchNow();
	}
}

async function choose(key: SetupKey): Promise<void> {
	const item = ITEMS[key];
	const { uri, webRoot } = await referenceContext();
	const current = uri && await resolvePath(key, uri, webRoot);
	const [picked] = await vscode.window.showOpenDialog({
		title: `${item.label}: ${item.example}`, openLabel: '선택', defaultUri: current ? vscode.Uri.file(item.folder ? current : path.dirname(current)) : undefined,
		canSelectFiles: !item.folder, canSelectFolders: item.folder, canSelectMany: false, filters: item.filters,
	}) ?? [];
	if (!picked) {
		return;
	}
	if (key !== 'eclipseInstallPath') {
		await save(key, picked.fsPath);
		return;
	}
	// 설치본이 아닌 폴더를 저장하면 자동으로 고르기도 막히므로, 그 밑에서 설치본을 찾은 경우에만 저장한다
	const root = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '선택한 폴더에서 WebSquare5 설치본을 찾는 중입니다…' },
		() => installUnder(picked.fsPath));
	if (root) {
		// 직접 고른 폴더가 이 프로젝트에서 바로 쓰이게, 이 프로젝트에서 따로 골라 둔 설치본은 지운다
		await workspaceMemo?.update(CHOSEN, undefined);
		await save(key, root);
	} else if (await vscode.window.showWarningMessage(`선택한 폴더에서 WebSquare5 설치본(WebSquareConfig.xml)을 찾지 못해 저장하지 않았습니다: ${picked.fsPath}`, '다시 선택') === '다시 선택') {
		await choose(key);
	}
}

function referenceUri(): vscode.Uri | undefined {
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	return input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText ? input.uri : vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function referenceContext(): Promise<{ uri?: vscode.Uri; webRoot?: string }> {
	const uri = referenceUri();
	return { uri, webRoot: uri && await findWebRoot(uri.fsPath) };
}

/** 설치본을 고를 때 기준이 되는 위치: 지금 보는 화면의 웹 루트, 없으면 첫 작업 폴더 */
async function nearRoot(): Promise<string | undefined> {
	const { uri, webRoot } = await referenceContext();
	return uri && (webRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
}

async function updateSetupContext(): Promise<void> {
	const { uri, webRoot } = await referenceContext();
	if (uri && webRoot) {
		await installRoot(uri, webRoot, true);
	}
	await Promise.all((Object.keys(ITEMS) as SetupKey[]).map(async key => vscode.commands.executeCommand(
		'setContext', `for-websquare5.found.${key}`, !!uri && !!await resolvePath(key, uri, webRoot))));
}

export function registerSetup(context: vscode.ExtensionContext): void {
	globalMemo = context.globalState;
	workspaceMemo = context.workspaceState;
	// 확장 테스트 중에는 PC 드라이브를 뒤지지 않는다(테스트가 만든 설정만 본다)
	autoDiscover = context.extensionMode !== vscode.ExtensionMode.Test;
	context.subscriptions.push(
		installChanged,
		vscode.commands.registerCommand('for-websquare5.setup', async () => {
			const { uri, webRoot } = await referenceContext();
			if (uri && webRoot) {
				await installRoot(uri, webRoot, true);
			}
			const current = chosen();
			const rows = await Promise.all((Object.keys(ITEMS) as SetupKey[]).map(async key => {
				const found = uri && await resolvePath(key, uri, webRoot);
				const how = !!uri && found === configuredPath(key, uri, webRoot) ? '선택됨'
					: key !== 'eclipseInstallPath' ? '설치 폴더에서 찾음'
						: current?.picked && current.root === found ? '이 프로젝트에서 선택함' : '자동으로 찾음';
				return { key, label: `${found ? '$(check)' : '$(warning)'} ${ITEMS[key].label}`, description: found ? how : '선택 필요', detail: found ?? `${ITEMS[key].folder ? '폴더' : '파일'} 위치 예시: ${ITEMS[key].example}` };
			}));
			const search = { key: undefined, label: '$(search) 설치 폴더 자동으로 찾기', description: '', detail: '로컬 드라이브(C:·D: 등)에서 WebSquare5 설치본을 찾아 이 프로젝트에 쓸 것을 고릅니다' };
			const row = await vscode.window.showQuickPick([...rows, search], { title: 'WebSquare5 환경 설정', placeHolder: '설정할 파일 또는 폴더를 선택하세요' });
			if (row === search) {
				await searchNow();
			} else if (row?.key) {
				await choose(row.key);
			}
		}),
		vscode.commands.registerCommand('for-websquare5.choose', (key: SetupKey) => choose(key)),
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('for-websquare5')) {
				clearAutoCache();
				void updateSetupContext();
			}
		}),
	);
	void updateSetupContext();
}
