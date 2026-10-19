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
]);

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
	let level = [...new Set(roots.map(r => path.resolve(r)))];
	for (let depth = 0; level.length && depth <= maxDepth; depth++) {
		const next: string[] = [];
		let at = 0, stopped = false;
		const worker = async () => {
			while (at < level.length && !stopped) {
				if (Date.now() > deadline || cancelled()) {
					stopped = true;
					return;
				}
				const dir = level[at++];
				const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
				if (isPlugins(dir, entries.map(e => e.name))) {
					installs.push(path.dirname(dir));
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
		level = next;
	}
	return { installs, complete: true };
}

/** 이 PC의 로컬 드라이브 전체에서 찾기. 드라이브 목록(PowerShell, 1초쯤)을 기다리는 동안 시스템 드라이브부터 훑는다 */
export async function findLocalInstalls(options: FindOptions = {}): Promise<{ installs: string[]; complete: boolean }> {
	const system = process.platform === 'win32' ? `${process.env.SystemDrive ?? 'C:'}\\`.toUpperCase() : undefined;
	const results = await Promise.all([
		system && await exists(system) ? findInstalls([system], options) : { installs: [], complete: true },
		searchRoots().then(roots => findInstalls(roots.filter(r => r.toUpperCase() !== system), options)),
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

/** 훑을 곳: Windows는 로컬 고정 드라이브(C:·D: 등, 네트워크·이동식 제외), 그 밖에는 홈·/opt·/Applications */
async function searchRoots(): Promise<string[]> {
	if (process.platform !== 'win32') {
		const candidates = [os.homedir(), '/opt', '/Applications'];
		return (await Promise.all(candidates.map(async dir => await exists(dir) ? dir : undefined))).filter(dir => dir !== undefined);
	}
	// 드라이브 종류는 PowerShell(CIM)로: DriveType 3 = 로컬 디스크. 숫자라 OS 언어와 상관없다
	const fixed = await new Promise<string[]>(resolve => execFile('powershell.exe',
		['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3").DeviceID'],
		{ timeout: 10_000, windowsHide: true },
		(error, stdout) => resolve(error ? [] : stdout.split(/\r?\n/).map(s => s.trim().toUpperCase()).filter(s => /^[A-Z]:$/.test(s)))));
	const drives = (fixed.length ? fixed : ['C:', 'D:']).sort().map(d => d + '\\');
	return (await Promise.all(drives.map(async d => await exists(d) ? d : undefined))).filter(d => d !== undefined);
}
