// 로컬 미리보기 서버: 127.0.0.1의 임의 포트에서 현재 화면 스냅샷만 내보낸다(WAS 아님).
// 화면마다 추측할 수 없는 주소(/p/<토큰>/)를 주고, 화면이 바뀌면 열린 브라우저에 SSE로 새 화면을 보낸다.
// 그림·폰트는 웹 루트 안의 정해진 확장자만 읽기 전용으로 내준다.
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { isInside } from './paths';
import { pageHtml, updatePayload, type PreviewPage } from './snapshot';

const ASSET_TYPES: Record<string, string> = {
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
	'.ico': 'image/x-icon', '.bmp': 'image/bmp', '.css': 'text/css; charset=utf-8',
	'.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject',
};
/** 브라우저를 열고 연결하기까지 기다리는 시간 */
const FIRST_CONNECT_MS = 30_000;
/** 열린 브라우저가 모두 닫힌 뒤(새로고침 중 재연결 여유) 미리보기를 끝내기까지 */
const IDLE_MS = 10_000;
const PING_MS = 25_000;

export interface Preview {
	/** 브라우저로 열 주소 */
	url: string;
	/** 웹 루트 파일(그림·폰트)을 내주는 경로(CSS·HTML 안의 주소를 이것으로 바꾼다) */
	fileBase: string;
	/** 화면을 정한다: 열린 브라우저가 있으면 새 화면을 바로 보낸다 */
	publish(page: PreviewPage): void;
	close(): void;
}

interface Entry {
	id: string;
	webRoot: string;
	page?: PreviewPage;
	clients: Set<ServerResponse>;
	timer?: NodeJS.Timeout;
	onClosed(): void;
}

export class PreviewServer {
	private listening?: Promise<Server>;
	private readonly entries = new Map<string, Entry>();
	private port = 0;

	/** 시간은 테스트에서만 바꾼다 */
	constructor(private readonly firstConnectMs = FIRST_CONNECT_MS, private readonly idleMs = IDLE_MS) {}

	/** onClosed: 브라우저가 닫혀 미리보기가 끝났을 때(끝난 뒤에는 publish가 아무것도 하지 않는다). 첫 publish 전에는 요청에 404 */
	async open(webRoot: string, onClosed: () => void): Promise<Preview> {
		await this.start();
		const id = randomBytes(16).toString('hex');
		const entry: Entry = { id, webRoot, clients: new Set(), onClosed };
		this.entries.set(id, entry);
		this.idleAfter(entry, this.firstConnectMs);
		const base = `/p/${id}`;
		return {
			url: `http://127.0.0.1:${this.port}${base}/`,
			fileBase: `${base}/f`,
			publish: next => {
				if (!this.entries.has(id)) { return; }
				// 같은 CSS 배열이면(BrowserPreview가 바뀌지 않은 CSS는 이전 배열을 그대로 넘긴다) 화면만 보낸다
				const withStyles = entry.page?.css !== next.css || entry.page.imports !== next.imports;
				entry.page = next;
				if (!entry.clients.size) { return; }
				const payload = updatePayload(next, withStyles);
				for (const client of entry.clients) { this.send(client, payload); }
			},
			close: () => this.finish(entry, false),
		};
	}

	/** 열린 미리보기가 모두 끝나면 서버도 끈다 */
	dispose(): void {
		for (const entry of [...this.entries.values()]) { this.finish(entry, false); }
	}

	private start(): Promise<Server> {
		this.listening ??= new Promise<Server>((resolve, reject) => {
			const server = createServer((req, res) => this.handle(req, res));
			server.once('error', reject);
			server.listen(0, '127.0.0.1', () => {
				this.port = (server.address() as AddressInfo).port;
				resolve(server);
			});
		});
		this.listening.catch(() => { this.listening = undefined; });
		return this.listening;
	}

	private idleAfter(entry: Entry, ms: number): void {
		clearTimeout(entry.timer);
		entry.timer = setTimeout(() => this.finish(entry, true), ms);
	}

	private finish(entry: Entry, notify: boolean): void {
		if (!this.entries.delete(entry.id)) { return; }
		clearTimeout(entry.timer);
		for (const client of entry.clients) { client.end(); }
		entry.clients.clear();
		if (notify) { entry.onClosed(); }
		if (!this.entries.size) {
			const server = this.listening;
			this.listening = undefined;
			void server?.then(s => { s.close(); s.closeAllConnections(); });
		}
	}

	private send(res: ServerResponse, data: string): void {
		res.write(`data: ${data}\n\n`);
	}

	private handle(req: IncomingMessage, res: ServerResponse): void {
		const deny = (code: number) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(); };
		// 로컬 주소로 부른 요청만(DNS 리바인딩 방어)
		if (req.method !== 'GET' || ![`127.0.0.1:${this.port}`, `localhost:${this.port}`].includes(req.headers.host ?? '')) { return deny(403); }
		const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
		// 브라우저가 알아서 찾는 아이콘: 콘솔에 404가 남지 않게 빈 응답
		if (pathname === '/favicon.ico') { return deny(204); }
		const match = /^\/p\/([0-9a-f]{32})\/(.*)$/.exec(pathname);
		const entry = match && this.entries.get(match[1]);
		if (!match || !entry?.page) { return deny(404); }
		const rest = match[2];
		if (rest === '') {
			const nonce = randomBytes(16).toString('base64');
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
			res.end(pageHtml(entry.page, nonce));
		} else if (rest === 'events') {
			res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive' });
			clearTimeout(entry.timer);
			entry.clients.add(res);
			this.send(res, updatePayload(entry.page));
			const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
			res.on('close', () => {
				clearInterval(ping);
				entry.clients.delete(res);
				if (!entry.clients.size && this.entries.has(entry.id)) { this.idleAfter(entry, this.idleMs); }
			});
		} else if (rest.startsWith('f/')) {
			this.serveFile(entry.webRoot, rest.slice(2), res, deny);
		} else {
			deny(404);
		}
	}

	private serveFile(webRoot: string, encoded: string, res: ServerResponse, deny: (code: number) => void): void {
		let relative: string;
		try {
			relative = decodeURIComponent(encoded);
		} catch {
			return deny(400);
		}
		const type = ASSET_TYPES[path.extname(relative).toLowerCase()];
		const file = path.resolve(webRoot, relative);
		if (!type || relative.includes('\0') || !isInside(file, path.resolve(webRoot))) { return deny(404); }
		void stat(file).then(info => {
			if (!info.isFile()) { return deny(404); }
			res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
			createReadStream(file).on('error', () => res.destroy()).pipe(res);
		}, () => deny(404));
	}
}
