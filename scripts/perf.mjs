// 성능 측정(테스트 아님): 운영 빌드(dist) 웹뷰에 합성 화면을 넣고 첫 표시·문서 갱신·선택·탭 전환 시간을 잰다.
// 확장 호스트 쪽 화면 파싱 시간과 보내는 문서 크기도 잰다. 결과는 같은 PC·같은 조건에서 전후 비교에만 쓴다.
// 사용: node scripts/perf.mjs [컴포넌트 수...]   (기본 300 1000 3000, 먼저 node esbuild.js --production)
import { createServer } from 'node:http';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const sizes = process.argv.slice(2).map(Number).filter(n => n > 0);
const COUNTS = sizes.length ? sizes : [300, 1000, 3000];
const REPEAT = 5;
const XF = 'http://www.w3.org/2002/xforms', W2 = 'http://www.inswave.com/websquare';
const DEFS = [
	{ id: 'body', ns: 'http://www.w3.org/1999/xhtml', realType: 'body' },
	{ id: 'group', ns: XF, realType: 'group' }, { id: 'textbox', ns: W2, realType: 'textbox' },
	{ id: 'input', ns: XF, realType: 'input' }, { id: 'trigger', ns: XF, realType: 'trigger' },
	{ id: 'select1', ns: XF, realType: 'selectbox' },
].map(d => ({ ...d, parents: [], bases: [], events: [{ name: 'onclick', signature: 'onclick(e)', description: '' }],
	properties: ['id', 'label', 'style', 'class', 'disabled'].map((name, order) => ({ name, category: '', order, description: '' })) }));

/** 컴포넌트 count개(10개씩 group으로 묶음)인 화면 XML */
function screen(count, label = 'Label') {
	const kids = [];
	for (let i = 0; i < count; i++) {
		const id = `c${i}`;
		kids.push([
			`<w2:textbox id="${id}" label="${label} ${i}" style="width:120px;height:23px;"/>`,
			`<xf:input id="${id}" style="width:150px;height:23px;" ev:onclick="scwin.${id}_onclick"/>`,
			`<xf:select1 id="${id}" appearance="minimal" style="width:120px;"><xf:choices><xf:item><xf:label><![CDATA[A]]></xf:label><xf:value><![CDATA[a]]></xf:value></xf:item></xf:choices></xf:select1>`,
			`<xf:trigger id="${id}" type="button" style="width:80px;"><xf:label><![CDATA[Btn ${i}]]></xf:label></xf:trigger>`,
		][i % 4]);
	}
	const groups = [];
	for (let i = 0; i < kids.length; i += 10) { groups.push(`<xf:group id="grp${i}" style="padding:4px;">\n${kids.slice(i, i + 10).join('\n')}\n</xf:group>`); }
	return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:w2="${W2}" xmlns:xf="${XF}">
<head><w2:type>COMPONENT</w2:type><xf:model><w2:dataCollection baseNode="map"/></xf:model>
<script type="text/javascript" lazy="false"><![CDATA[scwin.onpageload = function() {};]]></script></head>
<body ev:onpageload="scwin.onpageload">
${groups.join('\n')}
</body></html>`;
}

// 확장 호스트가 문서마다 하는 일: 파싱·정의 연결·Script 꺼내기(documentMessage와 같은 함수)
const hostFile = path.join(root, 'out', 'perf', 'host.cjs');
await build({
	stdin: { contents: `export { parseXml } from './src/core/xmlModel'; export { annotate } from './src/project/components'; export { scriptBody } from './src/core/edit';`, resolveDir: root, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', outfile: hostFile, logLevel: 'silent',
});
const host = (await import('node:module')).createRequire(import.meta.url)(hostFile);
const message = (text, version) => {
	const tree = host.parseXml(text);
	host.annotate(tree, DEFS);
	const body = host.scriptBody(text, tree);
	return { type: 'document', version, text, root: tree, script: { text: typeof body === 'string' ? '' : body.text } };
};
const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const time = (fn, n = REPEAT) => median(Array.from({ length: n }, () => { const t = performance.now(); fn(); return performance.now() - t; }));

if (!existsSync(path.join(dist, 'webview.js'))) { throw new Error('dist/webview.js가 없습니다. node esbuild.js --production 먼저 실행'); }
const chrome = process.env.CHROME_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
// 확장의 웹뷰 HTML(extension.ts html)과 같은 CSP. 확장 메시지는 아래 가짜 acquireVsCodeApi가 받는다
const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'nonce-perf'; font-src 'self'; img-src 'self' data:; script-src 'nonce-perf';">
<link rel="stylesheet" href="/webview.css"></head><body class="vscode-dark"><div id="root"></div>
<script nonce="perf">window.sent=[];window.acquireVsCodeApi=()=>({postMessage(m){window.sent.push(m.type);}});window.send=d=>window.dispatchEvent(new MessageEvent('message',{data:d}));
window.longTasks=0;new PerformanceObserver(l=>l.getEntries().forEach(e=>window.longTasks+=e.duration)).observe({type:'longtask',buffered:true});
window.idle=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,0))));
window.shadow=()=>document.querySelector('.canvas-host')?.shadowRoot;
window.until=async(ok,label)=>{const end=performance.now()+20000;while(!ok()){if(performance.now()>end){throw new Error('시간 초과: '+label+' (캔버스 '+(window.shadow()?'있음':'없음')+', 요소 '+(window.shadow()?.querySelectorAll('[data-wse]').length??0)+', 보낸 메시지 '+window.sent.join(',')+')');}await new Promise(r=>setTimeout(r,1));}};</script>
<script nonce="perf" src="/webview.js"></script></body></html>`;
const server = createServer(async (req, res) => {
	const name = path.basename(new URL(req.url, 'http://x').pathname);
	const file = path.join(dist, name);
	if (name && existsSync(file)) {
		res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
		res.end(await fs.readFile(file));
	} else {
		res.setHeader('Content-Type', 'text/html');
		res.end(html);
	}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, pipe: true });
const rows = [];
try {
	for (const count of COUNTS) {
		const text = screen(count), changed = screen(count, 'Changed');
		const row = { count, xmlKB: Math.round(text.length / 1024) };
		row.hostMs = time(() => message(text, 1));
		row.msgKB = Math.round(JSON.stringify(message(text, 1)).length / 1024);

		const page = await browser.newPage();
		await page.setViewport({ width: 1400, height: 900 });
		const errors = [];
		page.on('pageerror', e => errors.push(e.message));
		page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.error('[console]', m.text()); } });
		const cdp = await page.createCDPSession();
		await cdp.send('Performance.enable');
		const loadStart = performance.now();
		await page.goto(`http://127.0.0.1:${server.address().port}/`);
		await page.waitForSelector('.tab-bar button');
		row.mountMs = Math.round(performance.now() - loadStart);
		const script = (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'ScriptDuration').value;
		row.scriptMs = Math.round(script * 1000);

		// 첫 문서: 정의·문서를 받고 캔버스에 다 그릴 때까지
		row.firstMs = await page.evaluate(async (defs, doc, expected) => {
			const t = performance.now();
			window.send({ type: 'definitions', defs });
			window.send(doc);
			await window.until(() => (window.shadow()?.querySelectorAll('[data-wse]').length ?? 0) >= expected, '첫 문서');
			await window.idle();
			return performance.now() - t;
		}, DEFS, message(text, 1), count);

		// 문서 갱신(속성 하나 바꾼 것과 같은 크기의 일): 확장이 새로 파싱해 보낸 문서를 다시 그릴 때까지
		const updates = [];
		for (let i = 0; i < REPEAT; i++) {
			const doc = message(i % 2 ? text : changed, 2 + i), want = i % 2 ? 'Label 0' : 'Changed 0';
			updates.push(await page.evaluate(async (d, w) => {
				const t = performance.now();
				window.send(d);
				await window.until(() => window.shadow().querySelector('[data-wse]#c0')?.textContent?.includes(w), '문서 갱신');
				await window.idle();
				return performance.now() - t;
			}, doc, want));
		}
		row.updateMs = median(updates);

		// 캔버스 클릭 → Property 패널에 그 id가 보일 때까지
		const selects = [];
		for (let i = 0; i < REPEAT; i++) {
			const id = `c${4 * (i + 1) + 2}`; // select1(같은 종류)만 고른다
			const point = await page.evaluate(sel => {
				const el = window.shadow().querySelector(sel);
				el.scrollIntoView({ block: 'center' });
				const r = el.getBoundingClientRect();
				window.clickAt = undefined;
				addEventListener('pointerdown', e => { window.clickAt = e.timeStamp; }, { once: true, capture: true });
				return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
			}, `[data-wse]#${id}`);
			await page.mouse.click(point.x, point.y);
			selects.push(await page.evaluate(async want => {
				await window.until(() => [...document.querySelectorAll('.kv .value')].some(v => v.title === want), '선택');
				await window.idle();
				return performance.now() - window.clickAt;
			}, id));
		}
		row.selectMs = median(selects);

		// 탭 전환: Design → Source(화면 XML 전체 CodeMirror) → Design
		const tabMs = name => page.evaluate(async tab => {
			const button = [...document.querySelectorAll('.canvas-frame .tab-bar button')].find(b => b.textContent === tab);
			const t = performance.now();
			button.click();
			await new Promise(r => setTimeout(r, 0));
			await window.until(() => tab === 'Source' ? document.querySelector('.tab-body:not([hidden]) .cm-content') : window.shadow()?.querySelector('[data-wse]'), tab);
			await window.idle();
			return performance.now() - t;
		}, name);
		row.toSourceMs = await tabMs('Source');
		row.toDesignMs = await tabMs('Design');
		row.longTaskMs = await page.evaluate(() => window.longTasks);
		row.heapMB = Math.round((await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'JSHeapUsedSize').value / 1048576);
		if (errors.length) { row.errors = errors.join(' | '); }
		rows.push(row);
		await page.close();
	}
} finally {
	await browser.close();
	server.close();
}
const round = v => typeof v === 'number' ? Math.round(v) : v;
console.table(rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, round(v)]))));
const files = (await fs.readdir(dist)).filter(f => /\.(js|css)$/.test(f));
console.log('dist:', (await Promise.all(files.map(async f => `${f} ${Math.round((await fs.stat(path.join(dist, f))).size / 1024)}KB`))).join(', '));
