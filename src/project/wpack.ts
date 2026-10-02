import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { childTags, readWebConfig } from './config';
import { exists, findDirs } from './paths';

interface WpackConfig {
	destRoot: string;
	scopeCommon?: string;
}

export async function readWpackConfig(webRoot: string): Promise<WpackConfig | undefined> {
	const wpack = childTags(await readWebConfig(webRoot)).flatMap(childTags).find(e => e.name === 'wpack');
	if (wpack?.attribs.use !== 'true') {
		return undefined;
	}
	const value = (name: string) => childTags(wpack).find(e => e.name === name);
	const common = value('common');
	return {
		destRoot: value('destRoot')?.attribs.value || '_wpack_',
		scopeCommon: common?.attribs.value === 'true' && common.attribs.name ? common.attribs.name : undefined,
	};
}

const WPACK_NAME = 'standalone_wpack-win.exe';

export async function findWpack(eclipseRoot: string): Promise<string | undefined> {
	const dirs = await findDirs(eclipseRoot, (dir, names) =>
		(path.basename(dir) === 'w-pack' && names.includes('index.js')) || names.includes(WPACK_NAME));
	for (const dir of dirs) {
		if (await exists(path.join(dir, WPACK_NAME))) {
			return path.join(dir, WPACK_NAME);
		}
	}
	const wpack = dirs.find(dir => path.basename(dir) === 'w-pack');
	return wpack && path.join(wpack, 'index.js');
}

export async function eclipseDeployRoots(webRoot: string): Promise<string[]> {
	for (let dir = path.dirname(path.resolve(webRoot)); dir !== path.dirname(dir); dir = path.dirname(dir)) {
		const server = path.join(dir, '.metadata', '.plugins', 'org.eclipse.wst.server.core');
		if (await exists(server)) {
			const project = path.relative(dir, webRoot).split(path.sep)[0];
			const roots = (await readdir(server)).filter(n => /^tmp\d+$/.test(n)).map(n => path.join(server, n, 'wtpwebapps', project));
			const found: string[] = [];
			for (const r of roots) {
				if (await exists(r)) {
					found.push(r);
				}
			}
			return found;
		}
	}
	return [];
}

export async function convert(exe: string, config: WpackConfig, relPath: string, xml: string): Promise<string> {
	const tmp = await mkdtemp(path.join(os.tmpdir(), 'ws5-wpack-'));
	try {
		const src = path.join(tmp, 'src'), dest = path.join(tmp, 'dest');
		await mkdir(path.dirname(path.join(src, relPath)), { recursive: true });
		await writeFile(path.join(src, relPath), xml);
		const script = path.basename(exe).toLowerCase() === 'index.js';
		const node = path.resolve(path.dirname(exe), '..', '..', 'node.exe');
		if (script && !await exists(node)) {
			throw new Error(`w-pack/index.js 실행용 Node를 찾지 못했습니다: ${node}`);
		}
		const args = [...(script ? [exe] : []), '--baseDir', src, '--src', src, '--dest', dest, '--js', '0', '--css', '0', '-nb', 'true'];
		if (config.scopeCommon) {
			args.push(script ? '-cm' : '-sc', config.scopeCommon);
		}
		const output = await new Promise<string>((resolve, reject) => {
			execFile(script ? node : exe, args, { cwd: path.dirname(exe), timeout: 60_000, windowsHide: true }, (err, stdout, stderr) =>
				err ? reject(new Error(`${err.message}\n${stdout}${stderr}`)) : resolve(stdout + stderr));
		});
		const js = path.join(dest, relPath.replace(/\.xml$/i, '.js'));
		if (!await exists(js)) {
			throw new Error(`변환 결과 없음\n${output}`);
		}
		return await readFile(js, 'utf8');
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
}

export async function publish(webRoot: string, config: WpackConfig, relPath: string, xml: string, js: string): Promise<string[]> {
	const jsRel = path.join(config.destRoot, relPath.replace(/\.xml$/i, '.js'));
	const targets: [string, string][] = [[path.join(webRoot, jsRel), js]];
	for (const deploy of await eclipseDeployRoots(webRoot)) {
		targets.push([path.join(deploy, jsRel), js], [path.join(deploy, relPath), xml]);
	}
	for (const [file, content] of targets) {
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, content);
	}
	return targets.map(t => t[0]);
}
