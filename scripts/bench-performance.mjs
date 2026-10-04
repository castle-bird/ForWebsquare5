// 합성 XML과 실제 React 웹뷰를 사용한다. 대기 시간을 뺀 Chrome TaskDuration 중앙값(ms).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import cspPatchesPlugin from './csp-patches-plugin.cjs';

const chrome = process.env.CHROME_PATH ?? [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync);
assert.ok(chrome, 'CHROME_PATH에 Chrome/Edge 실행 파일을 지정해 주세요.');
// --baseline은 HEAD의 src를 읽어 같은 브라우저·의존성·측정 코드로 비교한다.
const baseline = process.argv.includes('--baseline');
const output = process.argv.slice(2).find(arg => arg !== '--baseline');
const baselinePlugin = { name: 'baseline', setup(b) {
	if (baseline) { b.onLoad({ filter: /[/\\]src[/\\].*\.tsx?$/ }, async args => {
		if (!args.path.startsWith(path.resolve('src') + path.sep)) { return; }
		const file = path.relative(process.cwd(), args.path).split(path.sep).join('/');
		const { stdout } = await promisify(execFile)('git', ['show', 'HEAD:' + file]);
		return { contents: stdout, loader: file.endsWith('.tsx') ? 'tsx' : 'ts' };
	}); }
} };
const bundle = await build({
	stdin: { contents: `
		import './src/webview/main';
		import {parseXml} from './src/core/xmlModel';
		import {screenProblems, problemAncestors} from './src/core/check';
		import {useEditorStore} from './src/webview/store';
		const ns = 'http://www.inswave.com/websquare';
		const defs = ['input', 'group'].map(id => ({ id, ns, realType: id, parents: [], bases: [], properties: [], events: [] }));
		window.send = data => window.dispatchEvent(new MessageEvent('message', {data}));
		window.settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)))));
		let version = 0;
		window.prepare = (count, marked) => {
			const inputs = Array.from({length:count}, (_, i) => '<w2:input id="i' + i + '" style="display:block;width:160px;height:24px"' + (marked ? ' ref="data:dma.x" ev:onclick="scwin.missing"' : '') + '/>').join('');
			const text = '<html xmlns:w2="' + ns + '" xmlns:ev="urn:test"><head><script><![CDATA[scwin.ok = function() {};]]></script></head><body><w2:group>' + inputs + '</w2:group></body></html>';
			const start = performance.now();
			const root = parseXml(text);
			const annotate = n => { const def = defs.findIndex(d => n.tag === 'w2:' + d.id); if (def >= 0) { n.def = def; } n.children.forEach(annotate); };
			annotate(root);
			const parsed = performance.now() - start;
			const checksStart = performance.now();
			problemAncestors(root, screenProblems(root));
			window.prepared = {type:'document', version:++version, text, root, script:{text:'scwin.ok = function() {};'}};
			return {parsed, checks: performance.now() - checksStart};
		};
		window.select = i => useEditorStore.getState().setSelected(window.prepared.root.children[1].children[0].children[i].index);
		window.defs = defs;
	`, resolveDir: process.cwd(), loader: 'ts' },
	bundle: true, minify: true, write: false, outdir: 'perf-bundle', entryNames: 'perf', jsx: 'automatic',
	plugins: [baselinePlugin, { name: 'canvas-css', setup(b) { b.onLoad({ filter: /[/\\]canvas\.css$/ }, async args => ({ contents: await fs.readFile(args.path, 'utf8'), loader: 'text' })); } }, cspPatchesPlugin],
	loader: { '.ttf': 'file', '.svg': 'dataurl' },
});
const assets = new Map(bundle.outputFiles.map(f => ['/' + path.basename(f.path), f.contents]));
const html = `<!doctype html><html><head><link rel="stylesheet" href="/perf.css">
<style>body{--vscode-font-size:14px;--vscode-foreground:#ddd;--vscode-editor-background:#222;--vscode-sideBar-background:#333;--vscode-panel-border:#555}</style>
</head><body><div id="root"></div><script>window.acquireVsCodeApi=()=>({postMessage(){}})</script><script src="/perf.js"></script></body></html>`;
const server = createServer((req, res) => {
	const name = new URL(req.url, 'http://localhost').pathname;
	res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.ttf') ? 'font/ttf' : 'text/html');
	res.end(assets.get(name) ?? html);
});
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const report = [];
const hostBundle = await build({ stdin: { contents: "export {parseXml} from './src/core/xmlModel'; export {annotate} from './src/project/components'; export {attachFrames} from './src/project/frames';", resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [baselinePlugin] });
const host = { exports: {} };
new Function('require', 'module', 'exports', hostBundle.outputFiles[0].text)(createRequire(import.meta.url), host, host.exports);
const frames = [];
const frameDir = await fs.mkdtemp(path.join(tmpdir(), 'ws5-perf-'));
try {
	const target = '<html><body>' + '<input/>'.repeat(500) + '</body></html>';
	const defs = [{id:'wframe', ns:'urn:test', realType:'wframe', parents:[], bases:[]}];
	await fs.writeFile(path.join(frameDir, 'sub.xml'), target);
	for (const count of [1, 5, 10]) {
		const times = [];
		for (let i = 0; i < 7; i++) {
			const root = host.exports.parseXml('<html xmlns:w2="urn:test"><body>' + '<w2:wframe src="sub.xml"/>'.repeat(count) + '</body></html>');
			host.exports.annotate(root, defs);
			const start = performance.now();
			await host.exports.attachFrames(root, path.join(frameDir, 'main.xml'), frameDir, defs);
			assert.ok(root.children[0].children.every(n => n.frame?.children.length === 500));
			if (i > 1) { times.push(performance.now() - start); }
		}
		frames.push({ count, childNodes: 500, milliseconds: median(times) });
	}
} finally {
	assert.equal(path.dirname(frameDir), path.resolve(tmpdir()));
	assert.ok(path.basename(frameDir).startsWith('ws5-perf-'));
	await fs.rm(frameDir, { recursive: true, force: true });
}
console.log('frames', frames);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
	browser = await puppeteer.launch({ executablePath: chrome, headless: true, pipe: true });
	for (const [count, marked] of [[200, false], [1000, false], [3000, false], [1000, true]]) {
		const page = await browser.newPage();
		await page.setViewport({ width: 1200, height: 800 });
		const errors = [];
		page.on('pageerror', e => errors.push(e.message));
		await page.goto(`http://127.0.0.1:${server.address().port}`);
		await page.waitForFunction(() => !!window.prepare);
		await page.evaluate(async () => { await window.settle(); window.send({type:'definitions', defs:window.defs}); await window.settle(); });
		const update = [], parse = [], checks = [], selection = [], scroll = [];
		const measure = async action => {
			const before = await page.metrics();
			await page.evaluate(async action => { action === 'document' ? window.send(window.prepared) : action === 'select' ? window.select(1 + window.prepared.version % 2) : document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-page').scrollTop += 100; await window.settle(); }, action);
			return ((await page.metrics()).TaskDuration - before.TaskDuration) * 1000;
		};
		for (let i = 0; i < 7; i++) {
			const prepared = await page.evaluate((n, m) => window.prepare(n, m), count, marked);
			const time = await measure('document');
			if (i > 1) { update.push(time); parse.push(prepared.parsed); checks.push(prepared.checks); }
		}
		await page.evaluate(() => document.querySelector('.pane .codicon-expand-all').click());
		await page.evaluate(() => window.settle());
		for (let i = 0; i < 7; i++) {
			await page.evaluate(() => window.prepared.version++);
			const time = await measure('select');
			if (i > 1) { selection.push(time); }
			const scrollTime = await measure('scroll');
			if (i > 1) { scroll.push(scrollTime); }
		}
		assert.deepEqual(errors, []);
		const row = { count, marked, parse: median(parse), checks: median(checks), update: median(update), selection: median(selection), scroll: median(scroll) };
		report.push(row);
		console.log(JSON.stringify(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v]))));
		await page.close();
	}
	if (output) { await fs.writeFile(output, JSON.stringify({ baseline, browser: await browser.version(), frames, report }, null, 2)); }
} finally {
	await browser?.close();
	await new Promise(resolve => server.close(resolve));
}
