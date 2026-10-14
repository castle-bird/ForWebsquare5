/**
 * wpack 상주 변환 프로세스. 사용자 설치본의 node.exe로 fork해서 w-pack 모듈을 한 번만 불러 두고 요청마다 변환한다.
 * w-pack CLI(index.js)는 변환마다 Node를 띄우고 그 안에서 워커를 또 fork해서(cluster) 한 번에 1초 가까이 걸린다.
 * 여기서는 CLI와 같은 마스터 로직(src/util/main.js)을 그대로 쓰고, 워커만 같은 프로세스 안에서 돌린다.
 * argv[2]: w-pack 폴더(index.js가 있는 곳). 요청 { id, options }(CLI 옵션과 같은 이름·값) → 응답 { id } 또는 { id, error }
 */
import * as path from 'node:path';

type Message = { done?: unknown } | undefined;
type Listener = (msg: Message) => void;

const dir = process.argv[2];
const load = (rel: string): unknown => require(path.join(dir, rel));
const cluster = require('cluster') as { fork: () => unknown; disconnect: (cb?: () => void) => void };
const reply = process.send!.bind(process) as (msg: unknown) => boolean;

load('src/util/logger'); // main.js가 쓰는 전역 logger()
const ProcessControl = load('src/util/processControl') as new () => { work(work: unknown): Promise<void> };
const mainFile = require.resolve(path.join(dir, 'src/util/main'));

// 같은 프로세스 안 워커가 process.send로 보내는 진행·끝 알림은 부모(확장)가 아니라 변환 중인 작업으로
let toJob: Listener | undefined;
process.send = ((msg: unknown, ...rest: unknown[]) => {
	if (toJob) {
		toJob(msg as Message);
		return true;
	}
	return (reply as (...args: unknown[]) => boolean)(msg, ...rest);
}) as typeof process.send;
let fork: () => unknown = () => { throw new Error('fork'); };
cluster.fork = () => fork();
cluster.disconnect = () => undefined; // 끝 처리(endFunc)는 프로세스 종료 코드·요약 로그뿐이라 건너뛴다

async function run(options: Record<string, string>): Promise<void> {
	// main.js는 모듈 전역에 끝난 워커 수 등을 세므로 실행마다 새로 불러온다(의존 모듈은 캐시 그대로)
	delete require.cache[mainFile];
	const Main = require(mainFile) as new () => Record<string, unknown> & { start(): Promise<void> };
	const main = new Main();
	Object.assign(main, options);
	let forked = false;
	const finished = new Promise<void>((resolve, reject) => {
		fork = () => {
			forked = true;
			const listeners: Listener[] = [];
			return {
				send(work: unknown) {
					toJob = msg => {
						listeners.forEach(l => l(msg));
						if (msg && msg.done !== undefined) {
							toJob = undefined;
							resolve();
						}
					};
					new ProcessControl().work(work).catch(reject);
				},
				on(event: string, listener: Listener) {
					if (event === 'message') { listeners.push(listener); }
				},
			};
		};
	});
	await main.start();
	if (forked) {
		await finished;
	}
}

process.on('message', (msg: { id: number; options: Record<string, string> }) => {
	run(msg.options).then(() => reply({ id: msg.id }), (e: unknown) => {
		toJob = undefined;
		reply({ id: msg.id, error: e instanceof Error ? e.stack ?? e.message : String(e) });
	});
});
// 확장이 끝나면(IPC 끊김) 같이 끝난다
process.on('disconnect', () => process.exit(0));
