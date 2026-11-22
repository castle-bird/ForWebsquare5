// WebSquare5 설치본(Eclipse·WebSquare Studio) 자동 탐색: 설정이 없을 때 로컬 드라이브를 얕게 훑어 플러그인 폴더를 찾는다.
// 설치 위치는 사람마다 달라서(C:·D:, 폴더 이름도 제각각) 경로를 추측하지 않고 폴더 안의 표지로 알아본다
import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { exists, isInside } from './paths';
export { isInside };

/** 훑지 않는 폴더(소문자): 시스템·사용자 앱 데이터·의존성·빌드 결과. 점으로 시작하는 폴더와 바로가기(junction)도 들어가지 않는다 */
const SKIP = new Set([
	'windows', 'windows.old', 'programdata', 'appdata', '$recycle.bin', 'system volume information', 'recovery', 'perflogs',
	'msocache', '$windows.~bt', '$windows.~ws', 'onedrivetemp', 'node_modules', 'bower_components', 'target', 'build',
	'dist', 'out', 'coverage', 'vendor', 'packages', '__pycache__', 'venv', '$sysreset', 'inetpub', 'intel', 'amd', 'nvidia',
]);

/** 같은 깊이에서 뒤로 미루는 폴더(소문자): 설치본이 있을 가능성이 낮고 하위 파일이 많은 폴더 */
const LOW_PRIORITY = new Set([
	'program files', 'program files (x86)', 'users', 'downloads', 'documents', 'pictures', 'videos', 'music', 'desktop', 'onedrive',
]);

/** 같은 깊이에서 먼저 볼 폴더 이름 패턴 */
const HINT_DIR = /websquare|inswave|egov|eclipse|studio|dev|tool|ide|work/i;

/** 같은 depth 안에서의 방문 우선순위(0: 최우선, 1: 일반, 2: 후순위) */
function dirPriority(dir: string): number {
	const name = path.basename(dir).toLowerCase();
	if (name === 'plugins' || HINT_DIR.test(name)) {
		return 0;
	}
	if (LOW_PRIORITY.has(name)) {
		return 2;
	}
	return 1;
}

/** Eclipse의 plugins 폴더에 WebSquare5 플러그인(com.inswave.*)이 있으면 그 Eclipse 폴더가 설치본이다 */
const isPlugins = (dir: string, names: string[]) => path.basename(dir).toLowerCase() === 'plugins' && names.some(n => n.startsWith('com.inswave.'));

export interface FindOptions {
	/** roots에서 몇 단계 아래까지 볼지. C:\eclipse\plugins는 2, C:\개발팩\bin\websquare\plugins는 4 */
	maxDepth?: number;
	/** 이 시각(Date.now 기준)이 지나면 그때까지 찾은 것만 돌려준다 */
	deadline?: number;
	cancelled?: () => boolean;
}

/**
 * roots 밑을 얕은 곳부터 훑어 설치본(Eclipse 폴더) 목록을 돌려준다. complete=false면 시간 초과·취소로 다 보지 못했다.
 * 디스크 읽기는 몇 개씩 동시에 한다(한 폴더씩 기다리면 드라이브 전체가 느리다)
 */
export async function findInstalls(roots: string[], { maxDepth = 6, deadline = Infinity, cancelled = () => false }: FindOptions = {}): Promise<{ installs: string[]; complete: boolean }> {
	const installs: string[] = [];
	const foundRoots = new Set<string>();
	const isUnderFoundRoot = (dir: string) => {
		for (const root of foundRoots) {
			if (isInside(dir, root)) {
				return true;
			}
		}
		return false;
	};
	let level = [...new Set(roots.map(r => path.resolve(r)))];
	for (let depth = 0; level.length && depth <= maxDepth; depth++) {
		if (level.length > 1) {
			level.sort((a, b) => dirPriority(a) - dirPriority(b));
		}
		const next: string[] = [];
		let at = 0, stopped = false;
		const worker = async () => {
			while (at < level.length && !stopped) {
				if (Date.now() > deadline || cancelled()) {
					stopped = true;
					return;
				}
				const dir = level[at++];
				if (isUnderFoundRoot(dir)) {
					continue;
				}
				const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
				if (isPlugins(dir, entries.map(e => e.name))) {
					const installRoot = path.dirname(dir);
					installs.push(installRoot);
					foundRoots.add(installRoot);
					continue;
				}
				for (const e of entries) {
					if (e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name.toLowerCase())) {
						next.push(path.join(dir, e.name));
					}
				}
			}
		};
		await Promise.all(Array.from({ length: 16 }, worker));
		if (stopped) {
			return { installs, complete: false };
		}
		level = foundRoots.size ? next.filter(d => !isUnderFoundRoot(d)) : next;
	}
	return { installs, complete: true };
}

/** 이 PC의 로컬 드라이브 전체에서 찾기. Windows는 시스템 드라이브(C:\)를 즉시 훑고, 추가 드라이브가 있을 때만 PowerShell로 고정 드라이브를 거른다 */
export async function findLocalInstalls(options: FindOptions = {}): Promise<{ installs: string[]; complete: boolean }> {
	if (process.platform !== 'win32') {
		return findInstalls(await searchNonWindowsRoots(), options);
	}
	const system = `${(process.env.SystemDrive ?? 'C:').toUpperCase()}\\`;
	const immediate = [system];
	const results = await Promise.all([
		await exists(system) ? findInstalls(immediate, options) : { installs: [], complete: true },
		searchExtraWindowsRoots(immediate).then(ds => ds.length ? findInstalls(ds, options) : { installs: [], complete: true }),
	]);
	return { installs: results.flatMap(r => r.installs), complete: results.every(r => r.complete) };
}

/** Java properties 값의 이스케이프 풀기(\:·\\·\n·\uXXXX — 한글 경로는 \uXXXX로 저장된다) */
export function unescapeProperty(value: string): string {
	return value.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c: string) =>
		c.length === 5 ? String.fromCharCode(parseInt(c.slice(1), 16)) : ({ n: '\n', t: '\t', r: '\r', f: '\f' } as Record<string, string>)[c] ?? c);
}

/**
 * 설치본(Eclipse 폴더)을 쓴 흔적: lastUsed는 마지막 실행 시각(실행할 때마다 configuration/org.eclipse.osgi가 바뀐다),
 * workspaces는 그 Eclipse로 연 작업 공간(configuration/.settings/org.eclipse.ui.ide.prefs의 RECENT_WORKSPACES). 못 읽으면 0·빈 목록
 */
export async function eclipseUsage(root: string): Promise<{ lastUsed: number; workspaces: string[] }> {
	const configuration = path.join(root, 'configuration');
	const times = await Promise.all([path.join(configuration, 'org.eclipse.osgi'), configuration].map(p => stat(p).then(s => s.mtimeMs, () => 0)));
	const prefs = await readFile(path.join(configuration, '.settings', 'org.eclipse.ui.ide.prefs'), 'latin1').catch(() => '');
	const line = prefs.split(/\r?\n/).find(l => l.startsWith('RECENT_WORKSPACES='));
	const workspaces = line ? unescapeProperty(line.slice('RECENT_WORKSPACES='.length)).split('\n').map(s => s.trim()).filter(Boolean) : [];
	return { lastUsed: Math.max(...times), workspaces };
}

/** 비-Windows 탐색 루트: 홈·/opt·/Applications */
async function searchNonWindowsRoots(): Promise<string[]> {
	const candidates = [os.homedir(), '/opt', '/Applications'];
	return (await Promise.all(candidates.map(async dir => await exists(dir) ? dir : undefined))).filter(dir => dir !== undefined);
}

/** PowerShell CIM(DriveType 3 = 로컬 디스크)으로 고정 드라이브 목록 조회 */
function fixedWindowsDrives(): Promise<string[]> {
	return new Promise<string[]>(resolve => execFile('powershell.exe',
		['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3").DeviceID'],
		{ timeout: 10_000, windowsHide: true },
		(error, stdout) => resolve(error ? [] : stdout.split(/\r?\n/).map(s => s.trim().toUpperCase()).filter(s => /^[A-Z]:$/.test(s)))));
}

/** 시스템 드라이브 외 드라이브가 있을 때만 PowerShell CIM으로 로컬 고정 드라이브를 걸러낸다 */
async function searchExtraWindowsRoots(immediate: string[]): Promise<string[]> {
	const immediateSet = new Set(immediate.map(r => r.toUpperCase()));
	const fsutil = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'fsutil.exe');
	const fsutilDrives = await new Promise<string[] | undefined>(resolve => execFile(fsutil, ['fsinfo', 'drives'],
		{ timeout: 3000, windowsHide: true },
		(error, stdout) => {
			if (error) {
				resolve(undefined);
				return;
			}
			const found = [...new Set(stdout.toUpperCase().match(/[A-Z]:/g) ?? [])];
			resolve(found.length ? found : undefined);
		}));
	if (fsutilDrives && fsutilDrives.every(d => immediateSet.has(d + '\\'))) {
		return [];
	}
	const fixed = await fixedWindowsDrives();
	const extra = fixed.map(d => d + '\\').filter(d => !immediateSet.has(d)).sort();
	return (await Promise.all(extra.map(async d => await exists(d) ? d : undefined))).filter(d => d !== undefined);
}
