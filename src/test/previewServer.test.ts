import * as assert from 'assert';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { PreviewServer, type Preview } from '../project/previewServer';
import type { PreviewPage } from '../project/snapshot';

const page = (text: string): PreviewPage => ({ title: 't', html: `<div class="wse-page"><p>${text}</p></div>`, css: ['.wse-page p{color:red}'] });

/** 서버 주소(preview.url)에 상대 경로로 요청한다. headers로 Host 등을 바꿀 수 있다 */
function get(url: string, headers: http.OutgoingHttpHeaders = {}): Promise<{ status: number; type?: string; body: string }> {
	return new Promise((resolve, reject) => {
		http.get(url, { headers }, res => {
			let body = '';
			res.setEncoding('utf8').on('data', chunk => body += chunk).on('end', () => resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'], body }));
		}).on('error', reject);
	});
}

suite('미리보기 서버', () => {
	let root: string, server: PreviewServer, preview: Preview, closed: number;
	setup(async () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-preview-'));
		fs.mkdirSync(path.join(root, 'img'));
		fs.writeFileSync(path.join(root, 'img', 'a.png'), 'PNG');
		fs.writeFileSync(path.join(root, 'screen.xml'), '<secret/>');
		fs.writeFileSync(path.join(path.dirname(root), 'ws5-outside.png'), 'OUT');
		server = new PreviewServer(200, 200);
		closed = 0;
		preview = await server.open(root, () => closed++);
	});
	teardown(() => {
		server.dispose();
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(path.join(path.dirname(root), 'ws5-outside.png'), { force: true });
	});
	const at = (rest: string) => new URL(rest, preview.url).href;

	test('첫 publish 전에는 404, 뒤에는 페이지를 내준다', async () => {
		assert.strictEqual((await get(preview.url)).status, 404);
		preview.publish(page('본문1'));
		const res = await get(preview.url);
		assert.strictEqual(res.status, 200);
		assert.ok(res.type?.startsWith('text/html') && res.body.includes('<p>본문1</p>'), res.body);
	});

	test('토큰이 틀리거나 Host가 로컬이 아니면 거부', async () => {
		preview.publish(page('x'));
		assert.strictEqual((await get(preview.url.replace(/\/p\/[0-9a-f]{32}\//, '/p/' + '0'.repeat(32) + '/'))).status, 404);
		assert.strictEqual((await get(preview.url, { Host: 'evil.example' })).status, 403);
	});

	test('웹 루트 안의 그림·폰트만 읽기 전용으로 내준다', async () => {
		preview.publish(page('x'));
		const ok = await get(at(`${path.posix.basename(preview.fileBase)}/img/a.png`));
		assert.deepStrictEqual([ok.status, ok.type, ok.body], [200, 'image/png', 'PNG']);
		assert.strictEqual((await get(at('f/screen.xml'))).status, 404, '허용하지 않는 확장자');
		assert.strictEqual((await get(at('f/..%2fws5-outside.png'))).status, 404, '웹 루트 밖(인코딩된 ..)');
		assert.strictEqual((await get(at('f/%2e%2e/ws5-outside.png'))).status, 404, '웹 루트 밖(%2e%2e)');
		assert.strictEqual((await get(at('f/img/none.png'))).status, 404, '없는 파일');
	});

	test('열린 브라우저(SSE)에 처음과 갱신 화면을 보낸다', async () => {
		preview.publish(page('처음'));
		const received: string[] = [];
		const req = http.get(at('events'), res => res.setEncoding('utf8').on('data', chunk => received.push(chunk)));
		await new Promise(resolve => setTimeout(resolve, 100));
		preview.publish(page('고침'));
		await new Promise(resolve => setTimeout(resolve, 100));
		req.destroy();
		const all = received.join('');
		assert.ok(all.includes('처음') && all.includes('고침'), all);
		assert.strictEqual(all.match(/^data: /gm)?.length, 2);
	});

	test('CSS 배열이 그대로면 화면만 보낸다', async () => {
		const first = page('처음');
		preview.publish(first);
		const received: string[] = [];
		const req = http.get(at('events'), res => res.setEncoding('utf8').on('data', chunk => received.push(chunk)));
		await new Promise(resolve => setTimeout(resolve, 100));
		preview.publish({ ...first, html: '<div class="wse-page">같은 CSS</div>' });
		preview.publish({ ...first, html: '<div class="wse-page">새 CSS</div>', css: ['.x{}'] });
		await new Promise(resolve => setTimeout(resolve, 100));
		req.destroy();
		const messages = received.join('').split(/\n\n/).filter(m => m.startsWith('data: ')).map(m => JSON.parse(m.slice(6)) as { styles?: string });
		assert.deepStrictEqual(messages.map(m => m.styles !== undefined), [true, false, true], '연결 직후 전체, 같은 CSS는 화면만, 새 CSS는 전체');
	});

	test('브라우저가 연결하지 않거나 모두 닫히면 끝나고 알린다', async () => {
		preview.publish(page('x'));
		await new Promise(resolve => setTimeout(resolve, 400));
		assert.strictEqual(closed, 1, '연결 없이 대기 시간이 지나면 끝');
		await assert.rejects(get(preview.url));

		const second = await server.open(root, () => closed++);
		second.publish(page('y'));
		const req = http.get(new URL('events', second.url).href, res => res.resume());
		await new Promise(resolve => setTimeout(resolve, 100));
		req.destroy();
		await new Promise(resolve => setTimeout(resolve, 400));
		assert.strictEqual(closed, 2, '브라우저를 닫으면 끝');
	});

	test('dispose는 알림 없이 모두 끝낸다', async () => {
		preview.publish(page('x'));
		server.dispose();
		assert.strictEqual(closed, 0);
		await assert.rejects(get(preview.url));
	});
});
