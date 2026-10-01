import { access, readdir } from 'node:fs/promises';
import * as path from 'node:path';

export const exists = (p: string) => access(p).then(() => true, () => false);

export const ENGINE_PAGE = '/websquare/websquare.html';

export const configFile = (webRoot: string) => path.join(webRoot, 'websquare', 'config.xml');

export function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
	let result = cache.get(key);
	if (!result) {
		result = load();
		cache.set(key, result);
		result.catch(() => cache.delete(key));
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

export async function findDirs(root: string, test: (dir: string, names: string[]) => boolean, maxDepth = 8): Promise<string[]> {
	const results: string[] = [];
	let level = [root];
	let visited = 0;
	for (let depth = 0; level.length && depth <= maxDepth && visited < 20_000; depth++) {
		const next: string[] = [];
		for (const dir of level) {
			if (visited++ >= 20_000) {
				break;
			}
			const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
			const names = entries.map(e => e.name);
			if (test(dir, names)) {
				results.push(dir);
			}
			next.push(...entries.filter(e => e.isDirectory()).map(e => path.join(dir, e.name)));
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

export const webPath = (webRoot: string, file: string) => '/' + path.relative(webRoot, file).split(path.sep).join('/');

export const fromWebPath = (webRoot: string, href: string, from: string) =>
	path.join(webRoot, decodeURIComponent(new URL(href, 'http://root' + encodeURI(from)).pathname));
