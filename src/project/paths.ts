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

/** skip: 들어가지 않을 하위 폴더(찾는 것이 그 안에 있을 리 없는 큰 폴더를 건너뛰어 빠르게) */
export async function findDirs(root: string, test: (dir: string, names: string[]) => boolean, maxDepth = 8, skip?: (name: string, dir: string) => boolean): Promise<string[]> {
	const results: string[] = [];
	let level = [root];
	let visited = 0;
	for (let depth = 0; level.length && depth <= maxDepth && visited < 20_000; depth++) {
		const batch = level.slice(0, 20_000 - visited);
		visited += batch.length;
		const loaded = await Promise.all(batch.map(async dir => ({
			dir,
			entries: await readdir(dir, { withFileTypes: true }).catch(() => []),
		})));
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

export function fromWebPath(webRoot: string, href: string, from: string): string {
	const base = 'http://root' + (from.startsWith('/') ? '' : '/') + from.split('/').map(encodeURIComponent).join('/');
	const url = new URL(href, base);
	const file = url.origin === 'http://root' ? path.resolve(path.join(webRoot, decodeURIComponent(url.pathname))) : '';
	if (!file || !isInside(file, path.resolve(webRoot))) {
		throw new Error('웹 루트 밖의 경로는 사용할 수 없습니다.');
	}
	return file;
}
