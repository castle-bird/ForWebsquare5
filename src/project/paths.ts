import { access, readdir } from 'node:fs/promises';
import * as path from 'node:path';

export const exists = (p: string) => access(p).then(() => true, () => false);

/** 생성·배포 폴더: XML 변경 감시와 공통 JS 다시 읽기에서 제외 */
export const GENERATED_DIRS = ['node_modules', '.git', '.metadata', 'target', 'build', 'bin', 'WEB-INF', 'META-INF'].map(name => name.replace('.', '\\.')).join('|');

export const ENGINE_PAGE = '/websquare/websquare.html';

export const configFile = (webRoot: string) => path.join(webRoot, 'websquare', 'config.xml');

export function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
	let result = cache.get(key);
	if (!result) {
		result = load();
		cache.set(key, result);
		result.catch(() => { if (cache.get(key) === result) { cache.delete(key); } });
	}
	return result;
}

/** 같은 키의 작업은 앞 작업이 끝난 뒤 하나씩(앞 작업이 실패해도 이어서). 남은 작업이 없으면 키를 지운다 */
export function serial<T>(queues: Map<string, Promise<unknown>>, key: string, job: () => Promise<T>): Promise<T> {
	const run = (queues.get(key) ?? Promise.resolve()).then(job);
	const tail = run.then(() => undefined, () => undefined);
	queues.set(key, tail);
	void tail.then(() => queues.get(key) === tail && queues.delete(key));
	return run;
}

export const numeric = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/** 동시 실행 수를 limit(최소 1)으로 제한해 items 순서대로 결과를 모은다 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i]);
		}
	};
	const count = Math.min(Math.max(1, Math.floor(limit)), items.length);
	await Promise.all(Array.from({ length: count }, worker));
	return results;
}

/** skip: 들어가지 않을 하위 폴더(찾는 것이 그 안에 있을 리 없는 큰 폴더를 건너뛰어 빠르게) */
export async function findDirs(root: string, test: (dir: string, names: string[]) => boolean, maxDepth = 8, skip?: (name: string, dir: string) => boolean): Promise<string[]> {
	const results: string[] = [];
	let level = [root];
	let visited = 0;
	for (let depth = 0; level.length && depth <= maxDepth && visited < 20_000; depth++) {
		const batch = level.slice(0, 20_000 - visited);
		visited += batch.length;
		const loaded = await mapLimit(batch, 32, async dir => ({
			dir,
			entries: await readdir(dir, { withFileTypes: true }).catch(() => []),
		}));
		const next: string[] = [];
		for (const { dir, entries } of loaded) {
			if (test(dir, entries.map(e => e.name))) {
				results.push(dir);
			}
			for (const e of entries) {
				if (e.isDirectory() && !skip?.(e.name, dir)) {
					next.push(path.join(dir, e.name));
				}
			}
		}
		level = next;
	}
	return results;
}

export async function findWebRoot(file: string): Promise<string | undefined> {
	for (let dir = path.dirname(path.resolve(file)); ; dir = path.dirname(dir)) {
		if (await exists(configFile(dir))) {
			return dir;
		}
		if (dir === path.dirname(dir)) {
			return undefined;
		}
	}
}

/** file이 dir 안에 있거나 dir 자체인지(Windows는 대소문자 무시) */
export function isInside(file: string, dir: string): boolean {
	const relative = path.relative(dir, file);
	return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

export const webPath = (webRoot: string, file: string) => '/' + path.relative(webRoot, file).split(path.sep).join('/');

/** 컨텍스트 경로 설정값을 `/myapp` 꼴로 정리해 긴 것부터(`/app/admin`이 `/app`보다 먼저 맞게). 빈 값·`/`는 버린다 */
export function contextPaths(value: unknown): string[] {
	const paths = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string')
		.map(v => '/' + v.split(/[\\/]/).filter(Boolean).join('/')).filter(p => p !== '/');
	return [...new Set(paths)].sort((a, b) => b.length - a.length);
}

let contextOf: (webRoot: string) => readonly string[] = () => [];

/** 웹 루트별 컨텍스트 경로(서버 주소 앞 접두사, Eclipse의 Context Root)를 알려 줄 함수. vscode 계층이 설정에서 읽어 넣는다 */
export function useContextPaths(fn: (webRoot: string) => readonly string[]): void {
	contextOf = fn;
}

/** 컨텍스트 경로로 시작하면 떼고 웹 루트 기준 경로로(대소문자 구분, `/myappX`는 그대로) */
function stripContext(webRoot: string, pathname: string): string {
	const context = contextOf(webRoot).find(c => pathname === c || pathname.startsWith(c + '/'));
	return context ? pathname.slice(context.length) || '/' : pathname;
}

export function fromWebPath(webRoot: string, href: string, from: string): string {
	const base = 'http://root' + (from.startsWith('/') ? '' : '/') + from.split('/').map(encodeURIComponent).join('/');
	const url = new URL(href, base);
	if (url.origin !== 'http://root') {
		throw new Error('웹 루트 밖의 경로는 사용할 수 없습니다.');
	}
	const pathname = decodeURIComponent(url.pathname);
	// 상대 URL의 기준 주소는 이미 웹 루트 기준이므로 컨텍스트를 다시 떼지 않는다.
	const localPath = href.trimStart().startsWith('/') ? stripContext(webRoot, pathname) : pathname;
	const file = path.resolve(path.join(webRoot, localPath));
	if (!isInside(file, path.resolve(webRoot))) {
		throw new Error('웹 루트 밖의 경로는 사용할 수 없습니다.');
	}
	return file;
}
