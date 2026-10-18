import { execFile, fork, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { errorMessage } from '../core/errors';
import { childTags, readWebConfig } from './config';
import { exists, findDirs, serial } from './paths';

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

/** w-pack/index.js를 실행할 플러그인 Node(…/node/node.exe). index.js는 …/node/node_modules/w-pack 안에 있다 */
const nodeFor = (script: string) => path.resolve(path.dirname(script), '..', '..', 'node.exe');

/**
 * 변환기 자동 탐색. Eclipse 플러그인이 쓰는 최신 w-pack/index.js를 먼저 고른다(오래되거나 손상된 단독 exe보다 낫다).
 * 실행할 node.exe가 없으면 standalone exe로, 그것도 없으면 index.js를 그대로 돌려줘 변환할 때 이유를 알린다
 */
export async function findWpack(eclipseRoot: string): Promise<string | undefined> {
	const dirs = await findDirs(eclipseRoot, (dir, names) =>
		(path.basename(dir) === 'w-pack' && names.includes('index.js')) || names.includes(WPACK_NAME),
		8, (name, dir) => path.basename(dir) === 'node_modules' && name !== 'w-pack');
	const scripts: string[] = [];
	for (const dir of dirs) {
		// 폴더 이름이 w-pack이어도 exe만 있는 곳(index.js 없음)이 있다
		if (path.basename(dir) === 'w-pack' && await exists(path.join(dir, 'index.js'))) {
			scripts.push(path.join(dir, 'index.js'));
		}
	}
	for (const script of scripts) {
		if (await exists(nodeFor(script))) {
			return script;
		}
	}
	for (const dir of dirs) {
		if (await exists(path.join(dir, WPACK_NAME))) {
			return path.join(dir, WPACK_NAME);
		}
	}
	return scripts[0];
}

export async function eclipseDeployRoots(webRoot: string): Promise<string[]> {
	for (let dir = path.dirname(path.resolve(webRoot)); dir !== path.dirname(dir); dir = path.dirname(dir)) {
		const server = path.join(dir, '.metadata', '.plugins', 'org.eclipse.wst.server.core');
		if (await exists(server)) {
			const project = path.relative(dir, webRoot).split(path.sep)[0];
			const roots = (await readdir(server)).filter(n => /^tmp\d+$/.test(n)).map(n => path.join(server, n, 'wtpwebapps', project));
			return (await Promise.all(roots.map(async r => await exists(r) ? r : undefined))).filter((r): r is string => !!r);
		}
	}
	return [];
}

/** 변환기 실행 인자. 공통 함수 치환(scopeCommon)은 exe·index.js 모두 -sc다(-cm은 다른 옵션이라 $p가 안 붙는다) */
export function wpackArgs(exe: string, config: WpackConfig, src: string, dest: string): string[] {
	const script = path.basename(exe).toLowerCase() === 'index.js';
	const args = [...(script ? [exe] : []), '--baseDir', src, '--src', src, '--dest', dest, '--js', '0', '--css', '0', '-nb', 'true'];
	if (config.scopeCommon) {
		args.push('-sc', config.scopeCommon);
	}
	return args;
}

/** CLI 인자와 같은 뜻의 상주 변환 옵션(w-pack main 객체 속성 이름·문자열 값) */
function serverOptions(config: WpackConfig, src: string, dest: string): Record<string, string> {
	return { module: 'w-pack', baseDir: src, src, dest, js: '0', css: '0', noFixBaseDir: 'true', ...config.scopeCommon && { scopeCommon: config.scopeCommon } };
}

interface Server { child: ChildProcess; next: number; waiting: Map<number, { resolve(): void; reject(e: Error): void }> }

/** w-pack/index.js마다 상주 변환 프로세스 하나(wpackServer.js). 한 번 실패한 변환기는 CLI로만 */
const servers = new Map<string, Server>();
const serverQueues = new Map<string, Promise<unknown>>();
const broken = new Set<string>();
const SERVER_FILE = path.join(__dirname, 'wpackServer.js');

function startServer(script: string): Server | undefined {
	const running = servers.get(script);
	if (running) {
		return running;
	}
	const node = nodeFor(script);
	// execArgv: 확장 호스트(Electron)의 실행 옵션을 물려받으면 설치본 Node가 모르는 옵션이라 바로 끝난다
	const child = fork(SERVER_FILE, [path.dirname(script)], { execPath: node, execArgv: [], cwd: path.dirname(script), silent: true, windowsHide: true });
	const server: Server = { child, next: 0, waiting: new Map() };
	let log = '';
	child.stdout?.resume();
	child.stderr?.on('data', (d: Buffer) => { log = (log + d.toString()).slice(-4000); });
	child.on('message', (msg: { id: number; error?: string }) => {
		const job = server.waiting.get(msg.id);
		server.waiting.delete(msg.id);
		if (msg.error) { job?.reject(new Error(msg.error)); } else { job?.resolve(); }
	});
	const stop = (e: Error) => {
		if (servers.get(script) === server) { servers.delete(script); }
		server.waiting.forEach(job => job.reject(new Error(`${e.message}\n${log}`)));
		server.waiting.clear();
	};
	child.on('exit', code => stop(new Error(`wpack 상주 변환 종료(${code})`)));
	child.on('error', stop);
	servers.set(script, server);
	return server;
}

/** 상주 변환으로 src → dest. 60초 안에 끝나지 않으면 프로세스를 끝내고 실패 */
function serverConvert(script: string, options: Record<string, string>): Promise<void> {
	return serial(serverQueues, script, () => new Promise<void>((resolve, reject) => {
		if (broken.has(script)) { reject(new Error('wpack 상주 변환 비활성화')); return; }
		const server = startServer(script)!;
		const id = ++server.next;
		const timer = setTimeout(() => { server.child.kill(); reject(new Error('wpack 상주 변환 시간 초과')); }, 60_000);
		server.waiting.set(id, { resolve: () => { clearTimeout(timer); resolve(); }, reject: e => { clearTimeout(timer); reject(e); } });
		server.child.send({ id, options });
	}));
}

/** 첫 변환을 기다리지 않게 미리 띄운다(화면 편집기를 열 때). 쓸 수 없는 변환기면 아무것도 안 함 */
export async function warmWpack(exe: string | undefined): Promise<void> {
	if (exe && path.basename(exe).toLowerCase() === 'index.js' && !broken.has(exe) && await exists(SERVER_FILE) && await exists(nodeFor(exe))) {
		startServer(exe);
	}
}

export function disposeWpack(): void {
	servers.forEach(server => server.child.kill());
	servers.clear();
	serverQueues.clear();
}

export async function convert(exe: string, config: WpackConfig, relPath: string, xml: string): Promise<string> {
	const tmp = await mkdtemp(path.join(os.tmpdir(), 'ws5-wpack-'));
	try {
		const src = path.join(tmp, 'src'), dest = path.join(tmp, 'dest');
		await mkdir(path.dirname(path.join(src, relPath)), { recursive: true });
		await writeFile(path.join(src, relPath), xml);
		const script = path.basename(exe).toLowerCase() === 'index.js';
		const node = nodeFor(exe);
		if (script && !await exists(node)) {
			throw new Error(`w-pack/index.js 실행용 Node를 찾지 못했습니다: ${node}`);
		}
		let output = '';
		if (script && !broken.has(exe) && await exists(SERVER_FILE)) {
			try {
				await serverConvert(exe, serverOptions(config, src, dest));
			} catch (e) {
				// 상주 변환이 안 되는 설치본(w-pack 내부 구조가 다름 등): 이번 것부터 CLI로
				broken.add(exe);
				servers.get(exe)?.child.kill();
				output = `상주 변환 실패, CLI로 변환: ${errorMessage(e)}\n`;
			}
		}
		const js = path.join(dest, relPath.replace(/\.xml$/i, '.js'));
		if (await exists(js)) {
			return await readFile(js, 'utf8');
		}
		const args = wpackArgs(exe, config, src, dest);
		output += await new Promise<string>((resolve, reject) => {
			execFile(script ? node : exe, args, { cwd: path.dirname(exe), timeout: 60_000, windowsHide: true }, (err, stdout, stderr) =>
				err ? reject(new Error(`${err.message}\n${stdout}${stderr}`)) : resolve(stdout + stderr));
		});
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
	await Promise.all(targets.map(async ([file, content]) => {
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, content);
	}));
	return targets.map(t => t[0]);
}
