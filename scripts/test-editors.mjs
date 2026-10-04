// 실제 웹뷰 구성과 CSP 아래에서 선택/키보드/자동완성을 검증한다.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import cspPatchesPlugin from './csp-patches-plugin.cjs';

const chrome = process.env.CHROME_PATH ?? [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync);
assert.ok(chrome, 'CHROME_PATH에 Chrome/Edge 실행 파일을 지정해 주세요.');

const inlineCssPlugin = {
	name: 'inline-css',
	setup(b) {
		b.onLoad({ filter: /[/\\]canvas\.css$/ }, async (args) => {
			const text = await fs.readFile(args.path, 'utf8');
			return { contents: text, loader: 'text' };
		});
	},
};

const bundle = await build({
	stdin: { contents: `
		import './src/webview/main';
		import {EditorView} from '@codemirror/view';
		import {forEachDiagnostic} from '@codemirror/lint';
		import {indentUnit} from '@codemirror/language';
		import {toSnippet} from './src/webview/editor/remoteCompletion';
		window.toSnippet = toSnippet;
		import {parseXml} from './src/core/xmlModel';
		window.parseXml = parseXml;
		window.editor = () => EditorView.findFromDOM(document.querySelector('.tab-body:not([hidden]) .cm-content'));
		window.indentUnit = indentUnit;
		window.tab = (name, bar = '.canvas-frame') => [...document.querySelectorAll(bar + ' .tab-bar button')].find(b => b.textContent === name);
		window.diagnostics = () => { const out = []; forEachDiagnostic(window.editor().state, (d, from) => out.push({ from, message: d.message })); return out; };
		const text = '<html xmlns:w2="urn:test" xmlns:xf="http://www.w3.org/2002/xforms"><body><w2:input id="ipt_name" label="Name"/><w2:wframe id="wfm_sub" src="sub.xml"/></body><head><xf:model><w2:dataCollection baseNode="map"/></xf:model></head></html>';
		const root = parseXml(text);
		window.initialDocument = { type: 'document', version: 1, text, root, script: { text: 'scwin.run = function() {};\\nset(value);\\nset(value);' } };
		root.children[0].children[0].def = 0;
		// 연결 화면: 확장이 붙이는 것처럼 wframe.frame에 다른 화면 body
		const sub = parseXml('<body><w2:input id="ipt_inner" label="Inner"/></body>');
		sub.children[0].def = 0;
		Object.assign(root.children[0].children[1], { def: 1, frame: sub });
		window.send = data => window.dispatchEvent(new MessageEvent('message', {data}));
		setTimeout(() => {
			window.testDefs = [{id:'input', ns:'urn:test', realType:'input', parents:[], bases:[], properties:[{name:'label', category:'', order:0, description:'화면에 보이는 글자'}, {name:'disabled', category:'', order:0, description:'', options:['true', 'false']}], events:[{name:'onclick', signature:'onclick(e)', description:''}]}, {id:'wframe', ns:'urn:test', realType:'wframe', parents:[], bases:[], properties:[], events:[]}, {id:'gridView', ns:'urn:test', realType:'gridView', parents:[], bases:[], properties:[], events:[]}, {id:'select1', ns:'http://www.w3.org/2002/xforms', realType:'selectbox', display:'SelectBox', parents:[], bases:[], properties:[], events:[]}, {id:'select1', ns:'http://www.w3.org/2002/xforms', realType:'radio', display:'Radio', parents:[], bases:[], properties:[], events:[]}, {id:'select', ns:'http://www.w3.org/2002/xforms', realType:'checkbox', parents:[], bases:[], properties:[], events:[]}]; window.send({type:'definitions', defs: window.testDefs});
			window.send({type:'scriptApi', api:{'$p':[{name:'getComponentById', signature:'getComponentById(id)', description:'컴포넌트 조회'}], 'WebSquare.uiplugin.input':[{name:'setValue', signature:'setValue(value)', description:'값 설정'}]}});
			window.send({type:'modules', files:[{path:'/js/common.js', text:'window.app = {};\\n/** 도구 */\\napp.util = {};\\n/**\\n * 값 형식 변환\\n * @param value 값\\n */\\napp.util.format = function(value, pattern) {};\\nvar lib = { VERSION: "1", win: {} };'}]});
			window.send({type:'document', version:1, text, root, script:{text:'scwin.run = function() {};\\nset(value);\\nset(value);'}});
		}, 50);
	`, resolveDir: process.cwd(), loader: 'ts' },
	bundle: true, write: false, outdir: 'test-bundle', entryNames: 'editor',
	plugins: [inlineCssPlugin, cspPatchesPlugin],
	jsx: 'automatic', loader: { '.ttf': 'file', '.svg': 'dataurl' },
});
const assets = new Map(bundle.outputFiles.map(f => ['/' + path.basename(f.path), f.contents]));
const html = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-test'; style-src 'self' 'nonce-test'; font-src 'self'; img-src 'self' data:;">
<link rel="stylesheet" href="/editor.css">
<style nonce="test">body { --vscode-editor-font-family: Consolas, monospace; --vscode-editor-font-size:16px; --vscode-font-size:14px; --vscode-editor-selectionBackground:#264f78; --vscode-editor-lineHighlightBackground:#555555; --vscode-editorIndentGuide-background1:#404040; --vscode-editorIndentGuide-activeBackground1:#707070; --vscode-editor-background:#222; --vscode-sideBar-background:#333; --vscode-foreground:#ddd; --vscode-charts-yellow:#cca700; --vscode-focusBorder:#007fd4; --vscode-symbolIcon-classForeground:#ee9d28; --vscode-symbolIcon-methodForeground:#b180d7; --vscode-button-foreground:#fff; --vscode-button-background:#0078d4; --vscode-input-background:#313131; --vscode-input-border:#3c3c3c; --vscode-input-foreground:#cccccc; --vscode-input-placeholderForeground:#989898; --vscode-panel-border:#2b2b2b; --vscode-descriptionForeground:#9d9d9d; --vscode-list-hoverBackground:#2a2d2e; --vscode-list-activeSelectionBackground:#04395e; --vscode-list-activeSelectionForeground:#ffffff; --vscode-dropdown-background:#313131; --vscode-dropdown-border:#3c3c3c; --vscode-widget-shadow:#0000005c; --vscode-checkbox-background:#313131; --vscode-checkbox-border:#3c3c3c; --vscode-toolbar-hoverBackground:#5a5d5e50; --vscode-badge-background:#616161; --vscode-badge-foreground:#f8f8f8; --vscode-textLink-foreground:#4daafc; } ::-webkit-scrollbar { width: 10px; height: 10px; }</style>
</head><body class="vscode-dark"><div id="root"></div>
<script nonce="test">window.leakedUndo=0; window.leakedSave=0; window.addEventListener('keydown',e=>{if(e.ctrlKey&&/^[zy]$/i.test(e.key)){window.leakedUndo++;} if(e.ctrlKey&&e.key==='s'){window.leakedSave++;}}); const versions={source:1,script:1}; window.addEventListener('message',e=>{if(e.data&&e.data.type==='document'){versions.source=versions.script=e.data.version;} if(e.data&&e.data.type==='linked'&&e.data.version){versions['link:'+e.data.kind]=e.data.version;}}); window.sent=[]; window.acquireVsCodeApi=()=>({postMessage(msg){msg=JSON.parse(JSON.stringify(msg));window.sent.push(msg);if(msg.type==='setCode'){const ok=msg.version===versions[msg.target]; if(ok){versions[msg.target]++;} setTimeout(()=>window.send({type:'codeAck',target:msg.target,ok,version:versions[msg.target]}),5);}else if(msg.type==='findFiles'){if(window.mockFiles){setTimeout(()=>window.send({type:'files',kind:msg.kind,files:window.mockFiles}),5);}}else if(msg.type==='complete'){setTimeout(()=>window.send({type:'completions',id:msg.id,...(window.remoteItems?window.remoteItems(msg):{items:[]})}),5);if(window.remoteDetails){setTimeout(()=>window.send({type:'completionDetails',id:msg.id,items:window.remoteDetails(msg)}),300);}}else if(msg.type==='format'){setTimeout(()=>window.send({type:'formatted',target:msg.target,text:window.formatResult??'formatted();'}),5);}}});</script>
<script nonce="test" src="/editor.js"></script></body></html>`;
const server = createServer((req, res) => {
	const pathname = new URL(req.url, 'http://localhost').pathname;
	const asset = assets.get(pathname);
	res.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.ttf') ? 'font/ttf' : 'text/html');
	res.end(asset ?? html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
	// 스크롤바를 실제로 그려야(VS Code 웹뷰처럼 폭 10px) 스크롤바 때문에 폭이 줄어드는 문제를 잡는다. 헤드리스 기본값은 숨김
	browser = await puppeteer.launch({ executablePath: chrome, headless: true, pipe: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
	const page = await browser.newPage();
	await page.setViewport({ width: 1200, height: 800 });
	const errors = [];
	page.on('pageerror', e => errors.push(e.message));
	page.on('console', msg => { if (msg.type() === 'error') { errors.push(msg.text()); } });
	await page.goto(`http://127.0.0.1:${server.address().port}`);
	await page.waitForSelector('.tab-bar button');
	await page.waitForSelector('.pane .tree-row');
	assert.equal(await page.$$eval('.pane .tree-row', rows => rows.length), 1, 'Outline 초기에는 루트만 표시');
	assert.equal(await page.$eval('.pane .tree-row', row => row.getAttribute('aria-expanded')), 'false');
	await page.evaluate(() => window.tab('Data', '.pane').click());
	// 테마 색 덮어쓰기 팝업: 코드 편집기가 한 번도 안 뜬 처음 Design 탭에서 열어도 미리 보기가 칠해진다
	// (CodeMirror가 넣는 <style>에 CSP nonce가 없으면 막혀서, Script 탭이 먼저 넣어 줘야만 칠해졌다)
	{
		assert.equal(await page.$$eval('.canvas-frame .tab-body .code-editor', e => e.length), 0, '아직 코드 편집기 없음');
		await page.click('.canvas-frame .tab-settings');
		await page.evaluate(() => [...document.querySelectorAll('.context-menu [role="menuitem"]')].find(b => b.textContent === '테마 색 덮어쓰기…').click());
		await page.waitForSelector('.theme-colors-editor[open]');
		const [keyword, fg] = await page.$eval('.theme-colors-editor .theme-preview', p => [
			getComputedStyle([...p.querySelectorAll('.cm-line span')].find(s => s.textContent === 'return')).color, getComputedStyle(p.querySelector('.cm-content')).color]);
		assert.notEqual(keyword, fg, `처음 Design 탭에서도 문법 색: ${keyword}`);
		await page.evaluate(() => [...document.querySelectorAll('.theme-colors-editor .data-editor-actions button')].find(b => b.textContent === '닫기').click());
		await page.waitForFunction(() => !document.querySelector('.theme-colors-editor'));
	}
	assert.equal(await page.$$eval('.pane .tree-row', rows => rows.length), 2, 'Data 초기에는 DataCollection·Submission 루트만 표시');
	// 둘 다 이 픽스처에서는 자식이 없는 루트라 aria-expanded 자체가 안 붙는다 (children 있는 Outline 쪽은 위에서 이미 확인)
	assert.equal(await page.$eval('.pane .tree-row', row => row.getAttribute('aria-expanded')), null);
	const submissionRoot = (await page.$$('.pane .tree-row'))[1];
	await submissionRoot.click();
	assert.ok(await page.$eval('.pane .tree-row:nth-child(2)', row => row.classList.contains('selected')), 'Submission 루트 클릭 선택');
	// 우클릭은 DataCollection처럼 먼저 메뉴("Submission 추가")를 보여주고, 눌러야 팝업이 열린다
	await submissionRoot.click({ button: 'right' });
	await page.waitForSelector('.context-menu');
	assert.deepEqual(await page.$$eval('.context-menu button', buttons => buttons.map(b => b.textContent)), ['Submission 추가']);
	await page.$eval('.context-menu button', button => button.click());
	await page.waitForSelector('.submission-editor[open]');
	assert.equal(await page.$eval('#submission-id', input => input.value), 'submission1');
	assert.equal(await page.$eval('#submission-method', input => input.value), 'post');
	assert.equal(await page.$eval('#submission-mode', input => input.value), 'asynchronous');
	assert.equal(await page.$eval('#submission-media', input => input.value), 'application/json');
	assert.deepEqual(await page.$$eval('.submission-handler button', bs => bs.map(b => b.disabled)), [true, true, true], '추가 팝업: 코드 버튼은 확인 전 비활성');
	await page.$eval('.submission-actions button:last-child', button => button.click());
	await page.waitForFunction(() => window.sent.some(m => m.type === 'addSubmission'));
	assert.equal(await page.evaluate(() => window.sent.find(m => m.type === 'addSubmission').index), 5);
	await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'addSubmission' || m.type === 'editSubmission').popup, ok: true }));
	await page.waitForFunction(() => !document.querySelector('.submission-editor'));
	await submissionRoot.click({ count: 2 });
	await page.waitForSelector('.submission-editor[open]');
	await page.$eval('.submission-actions button:first-child', button => button.click());
	const collection = await page.waitForSelector('.pane .tree-row .tag');
	await collection.click({ button: 'right' });
	await page.waitForSelector('.context-menu');
		assert.deepEqual(await page.$$eval('.context-menu button', buttons => buttons.map(b => b.textContent)),
			['DataList 추가', 'DataMap 추가', 'LinkedDataList 추가', 'AliasDataList 추가', 'AliasDataMap 추가']);
		await page.$eval('.context-menu button', button => button.click());
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'addData')),
			{ type: 'addData', version: 1, index: 6, kind: 'dataList' });
		console.log('Data: 우클릭 메뉴 → DataList 추가 요청 passed');
		await page.evaluate(() => {
			const previous = window.sent.find(m => m.type === 'addData');
			const text = '<html xmlns:w2="urn:test" xmlns:xf="http://www.w3.org/2002/xforms"><body><w2:input id="ipt_name" label="Name"/><w2:wframe id="wfm_sub" src="sub.xml"/></body><head><xf:model><w2:dataCollection baseNode="map"><w2:dataList id="dataList1"><w2:columnInfo/></w2:dataList></w2:dataCollection></xf:model></head></html>';
			window.send({ type: 'document', version: previous.version + 1, text, root: window.parseXml(text), script: { text: '' } });
		});
		await page.waitForSelector('.data-editor[open]');
		assert.equal(await page.$('.data-editor-tabs'), null, 'Column/Data 탭 없음');
		assert.equal(await page.$$('.popup-resize').then(handles => handles.length), 8, '8방향 크기 조절 손잡이');
		assert.deepEqual(await page.$$eval('.data-editor-actions button', buttons => buttons.map(b => b.textContent)), ['닫기', '확인']);
		const centered = await page.evaluate(() => {
			const canvas = document.querySelector('.canvas-frame').getBoundingClientRect();
			const popup = document.querySelector('.data-editor').getBoundingClientRect();
			return Math.abs((popup.left + popup.width / 2) - (canvas.left + canvas.width / 2)) <= 2;
		});
		assert.ok(centered, '팝업은 왼쪽 편집 영역 가운데에서 시작');
		// 가운데(ID 입력칸·모서리 리사이즈 손잡이 밖)를 잡아야 제목줄 드래그가 시작된다
		const title = await page.$eval('.popup-title', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
		const beforeDrag = await page.$eval('.data-editor', el => el.getBoundingClientRect().left);
		await page.mouse.move(title.x, title.y); await page.mouse.down(); await page.mouse.move(title.x + 40, title.y + 20, { steps: 5 }); await page.mouse.up();
		assert.ok(await page.$eval('.data-editor', (el, before) => el.getBoundingClientRect().left > before + 25, beforeDrag), '제목줄로 팝업 이동');
		await page.$eval('.data-editor-tools button', button => button.click());
		await page.click('.data-editor input[aria-label="1행 id"]');
		await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
		await page.keyboard.type('customer');
		await page.keyboard.press('ArrowRight');
		assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '1행 name');
		await page.$eval('.data-editor-tools button', button => button.click());
		const handles = await page.$$eval('.data-row-handle', buttons => buttons.map(button => { const r = button.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
		await page.mouse.move(handles[0].x, handles[0].y); await page.mouse.down();
		await page.mouse.move(handles[1].x, handles[1].y + 6, { steps: 12 }); await page.mouse.up();
		assert.deepEqual(await page.$$eval('.data-editor tbody input[aria-label$=" id"]', inputs => inputs.map(input => input.value)), ['col1', 'customer']);
		const popupBeforeResize = await page.$eval('.data-editor', el => el.getBoundingClientRect().width);
		const corner = await page.$eval('.popup-resize.resize-se', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
		await page.mouse.move(corner.x, corner.y); await page.mouse.down();
		await page.mouse.move(corner.x + 40, corner.y + 30, { steps: 5 }); await page.mouse.up();
		assert.ok(await page.$eval('.data-editor', (el, width) => el.getBoundingClientRect().width > width + 20, popupBeforeResize), '팝업 크기 조절');
		const idWidth = await page.$eval('.data-editor th:nth-child(2)', el => el.getBoundingClientRect().width);
		const columnHandle = await page.$eval('.data-editor th:nth-child(2) .data-col-resizer', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
		await page.mouse.move(columnHandle.x, columnHandle.y); await page.mouse.down();
		await page.mouse.move(columnHandle.x + 35, columnHandle.y, { steps: 5 }); await page.mouse.up();
		assert.ok(await page.$eval('.data-editor th:nth-child(2)', (el, width) => el.getBoundingClientRect().width > width + 20, idWidth), '열 너비 조절');
		await page.$eval('.data-editor-actions button:last-child', button => button.click());
		await page.waitForFunction(() => window.sent.some(m => m.type === 'editDataFields'));
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'editDataFields').fields.map(f => f.id)), ['col1', 'customer']);
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'editDataFields').popup, ok: true }));
		await page.waitForFunction(() => !document.querySelector('.data-editor'));
		await page.$eval('.pane .tree-row .id', id => id.closest('.tree-row').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
		await page.waitForSelector('.data-editor[open]');
		// 행이 늘어 세로 스크롤바가 생겨도 가로 스크롤은 안 생긴다: 열 합계 ≈ 표 폭인 팝업 폭(650px)에서 스크롤바(위 10px, VS Code 웹뷰와 같음)만큼 넘치던 것.
		// 이 팝업은 적용 없이 닫는다
		await page.$eval('.data-editor', el => { el.style.width = '650px'; });
		const wrapScroll = () => page.$eval('.data-editor-table-wrap', el => [el.scrollHeight > el.clientHeight, el.scrollWidth > el.clientWidth]);
		assert.deepEqual(await wrapScroll(), [false, false]);
		for (let i = 0; i < 25; i++) { await page.click('.data-editor-tools button'); }
		assert.deepEqual(await wrapScroll(), [true, false], '세로 스크롤만');
		// 다중 팝업: DataEditor가 열려 있는 상태에서 Submission 팝업도 함께 띄우기
		await submissionRoot.click({ button: 'right' });
		await page.waitForSelector('.context-menu');
		await page.$eval('.context-menu button', button => button.click());
		await page.waitForSelector('.submission-editor[open]');
		assert.equal(await page.$$eval('.popup[open]', popups => popups.length), 2, 'DataEditor와 SubmissionEditor가 동시에 2개 이상 띄워짐');
		// 팝업이 떠 있는 상태에서도 배경의 Outline 탭 전환 및 상호작용 가능 (non-modal)
		await page.evaluate(() => window.tab('Outline', '.pane').click());
		assert.equal(await page.$$eval('.pane .tree-row', rows => rows.length), 1, '팝업 뒤 배경과 상호작용 가능');
		await page.evaluate(() => window.tab('Data', '.pane').click());
		// 타이틀바 닫기 버튼으로 SubmissionEditor 닫기
		await page.$eval('.submission-editor .popup-close', btn => btn.click());
		await page.waitForFunction(() => !document.querySelector('.submission-editor'));
		assert.equal(await page.$$eval('.popup[open]', popups => popups.length), 1, 'SubmissionEditor만 닫히고 DataEditor는 유지');
		// 타이틀바 닫기 버튼으로 DataEditor 닫기
		await page.$eval('.data-editor .popup-close', btn => btn.click());
		await page.waitForFunction(() => !document.querySelector('.data-editor'));
		// 기존 Submission 더블클릭 → 추가 팝업을 수정 모드로 재사용, 값이 채워지고 확인하면 editSubmission
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test" xmlns:xf="http://www.w3.org/2002/xforms"><body/><head><xf:model><xf:submission id="sbm_sel1" action="/api/sel" method="get" mode="synchronous"/></xf:model></head></html>';
			window.sent.length = 0;
			window.send({ type: 'document', version: 50, text, root: window.parseXml(text), script: { text: 'scwin.sbm_sel1_submitdone = function(e) {\n};\n' } });
		});
		await page.evaluate(() => [...document.querySelectorAll('.pane .tree-row')].find(r => r.textContent.includes('Submission'))?.click());
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row')].some(r => r.textContent.includes('sbm_sel1'))
			|| (document.querySelector('.pane .tree-row[aria-expanded="false"]')?.click(), false));
		await page.evaluate(() => [...document.querySelectorAll('.pane .tree-row')].find(r => r.textContent.includes('sbm_sel1')).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
		await page.waitForSelector('.submission-editor[open]');
		assert.equal(await page.$eval('.submission-editor .popup-title', el => el.textContent), 'Submission서브미션 수정');
		assert.deepEqual(await page.$$eval('#submission-id, #submission-action, #submission-method, #submission-mode, #submission-media', els => els.map(e => e.value)), ['sbm_sel1', '/api/sel', 'get', 'synchronous', '']);
		await page.$eval('#submission-action', el => el.focus());
		await page.keyboard.type('2');
		// 수정 팝업 코드 버튼: 비어 있으면 scwin.{id}_{이벤트}. Script에 이미 정의가 있어 그리로 이동, 속성·입력칸은 그 이름으로
		await page.click('.submission-editor button[aria-label="submitdone Script"]');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'ev:submitdone' && m.value === 'scwin.sbm_sel1_submitdone'));
		assert.equal(await page.$eval('#submission-submitdone', el => el.value), 'scwin.sbm_sel1_submitdone');
		await page.screenshot({path:path.join(tmpdir(), 'ws5-submission-events.png')});
		assert.ok(await page.evaluate(() => window.tab('Script').classList.contains('active')), 'Script 탭으로');
		await page.evaluate(() => window.tab('Design').click());
		// 버튼(코드)으로 연 Script도 다른 탭으로 가면 숨기기만(편집기 유지: 커서·Ctrl+Z 기록)
		assert.ok(await page.$('.canvas-frame .tab-body[hidden] .cm-editor'), '코드로 연 Script 탭 유지');
		await page.$eval('.submission-actions .btn-primary', b => b.click());
		await page.waitForFunction(() => window.sent.some(m => m.type === 'editSubmission'));
		const editMsg = await page.evaluate(() => window.sent.find(m => m.type === 'editSubmission'));
		assert.equal(editMsg.fields.action, '/api/sel2');
		assert.equal(editMsg.fields.id, 'sbm_sel1');
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'addSubmission' || m.type === 'editSubmission').popup, ok: true }));
		await page.waitForFunction(() => !document.querySelector('.submission-editor'));
		console.log('Data: Submission 더블클릭 → 수정 팝업·값 채움·수정 요청 passed');
		// 값 바인딩: Data 트리의 dataMap key를 캔버스 컴포넌트에 떨구면 그 컴포넌트 ref에 data:{map}.{key}
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test" xmlns:xf="http://www.w3.org/2002/xforms"><body><w2:input id="ipt_bind" label="B"/></body><head><xf:model><w2:dataCollection baseNode="map"><w2:dataMap id="dataMap1"><w2:keyInfo><w2:key id="m_bucd_from" name="from"/></w2:keyInfo></w2:dataMap></w2:dataCollection></xf:model></head></html>';
			window.sent.length = 0;
			window.send({ type: 'document', version: 60, text, root: window.parseXml(text), script: { text: '' } });
		});
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row')].some(r => r.textContent.includes('m_bucd_from'))
			|| (document.querySelector('.pane .tree-row[aria-expanded="false"] .chevron')?.click(), false));
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('[data-tag="w2:input"]'));
		await page.evaluate(() => {
			const dt = new DataTransfer();
			const row = [...document.querySelectorAll('.pane .tree-row')].find(r => r.textContent.includes('m_bucd_from'));
			row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, composed: true, dataTransfer: dt }));
			const input = document.querySelector('.canvas-host').shadowRoot.querySelector('[data-tag="w2:input"]');
			input.dispatchEvent(new DragEvent('dragover', { bubbles: true, composed: true, cancelable: true, dataTransfer: dt }));
			input.dispatchEvent(new DragEvent('drop', { bubbles: true, composed: true, cancelable: true, dataTransfer: dt }));
		});
		const bind = await page.evaluate(() => window.sent.find(m => m.type === 'setAttr' && m.name === 'ref'));
		assert.equal(bind?.value, 'data:dataMap1.m_bucd_from', JSON.stringify(bind));
		console.log('Data: key → 컴포넌트 드래그 앤 드롭 ref 바인딩 passed');
		// 표시: ref 있으면 초록, ev:* 있으면 빨강 (둘 다면 초록 → 빨강 순)
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test" xmlns:ev="http://www.w3.org/2001/xml-events"><body><w2:input id="a" ref="data:m.k" ev:onclick="scwin.a_onclick"/><w2:input id="b" ev:onblur="scwin.b"/><w2:input id="c"/></body></html>';
			window.send({ type: 'document', version: 70, text, root: window.parseXml(text), script: { text: '' } });
		});
		const badges = () => page.evaluate(() => [...document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-badges')].map(b => [...b.children].map(s => s.className).join(',')));
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-badges').length === 2);
		assert.deepEqual(await badges(), ['bind,event', 'event']);
		console.log('Design: ref·event 표시 점 passed');
		// 표시 점은 중첩 스크롤·요소 크기·위치 이동을 따라가고, DOM 교체 후 새 요소를 감시한다.
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test" xmlns:ev="urn:ev"><body><div xmlns="http://www.w3.org/1999/xhtml" id="badge_clip" style="height:80px;width:200px;overflow:auto"><div id="badge_shift" style="height:20px"/><w2:input id="badge_first" style="display:block;height:24px" ref="data:m.k" ev:onclick="scwin.first"/><div style="height:140px"/><w2:input id="badge_last" style="display:block;height:24px" ref="data:m.k"/></div></body></html>';
			const root = window.parseXml(text);
			const walk = n => { if (n.tag === 'w2:input') { n.def = 0; } n.children.forEach(walk); }; walk(root);
			window.send({ type: 'document', version: 71, text, root, script: { text: '' } });
			window.badgeAligned = id => {
				const shadow = document.querySelector('.canvas-host').shadowRoot, p = shadow.querySelector('.wse-page');
				const el = shadow.getElementById(id), badges = shadow.querySelectorAll('.wse-badges');
				return el && badges.length === 1 && Math.abs(parseFloat(badges[0].style.top) - (el.getBoundingClientRect().top - p.getBoundingClientRect().top)) < 1;
			};
		});
		await page.waitForFunction(() => window.badgeAligned('badge_first'));
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.getElementById('badge_shift').style.height = '32px');
		await page.waitForFunction(() => window.badgeAligned('badge_first'));
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.getElementById('badge_clip').scrollTop = 999);
		await page.waitForFunction(() => window.badgeAligned('badge_last'));
		assert.deepEqual(await badges(), ['bind'], '스크롤 밖 표시 점은 숨김');
		await page.evaluate(() => {
			const shadow = document.querySelector('.canvas-host').shadowRoot;
			const old = shadow.getElementById('badge_last'), replacement = old.cloneNode(true);
			old.replaceWith(replacement);
		});
		await page.waitForFunction(() => window.badgeAligned('badge_last'));
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.getElementById('badge_last').style.height = '40px');
		await page.waitForFunction(() => window.badgeAligned('badge_last'));
		// ResizeObserver가 아닌 위치 이동도 감시(앞 공간과 뒤 공간의 합계 높이는 유지).
		await page.evaluate(() => {
			const shadow = document.querySelector('.canvas-host').shadowRoot, clip = shadow.getElementById('badge_clip');
			clip.scrollTop = 0;
			shadow.getElementById('badge_shift').style.height = '20px';
		});
		await page.waitForFunction(() => window.badgeAligned('badge_first'));
		await page.evaluate(() => {
			const shadow = document.querySelector('.canvas-host').shadowRoot;
			shadow.getElementById('badge_shift').style.height = '28px';
			shadow.getElementById('badge_first').nextElementSibling.style.height = '132px';
		});
		await page.waitForFunction(() => window.badgeAligned('badge_first'));
		console.log('Design: 표시 점 중첩 스크롤·크기·위치 이동·DOM 교체 passed');
		// gridView 바인딩: dataList를 gridView에 떨구면 옵션 팝업 → 확인 시 bindGrid 요청
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test" xmlns:xf="http://www.w3.org/2002/xforms"><body><w2:gridView id="grd"/></body><head><xf:model><w2:dataCollection baseNode="map"><w2:dataList id="dl1"><w2:columnInfo><w2:column id="c1"/><w2:column id="c2"/></w2:columnInfo></w2:dataList></w2:dataCollection></xf:model></head></html>';
			window.sent.length = 0;
			window.send({ type: 'document', version: 80, text, root: window.parseXml(text), script: { text: '' } });
		});
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row')].some(r => r.textContent.includes('dl1'))
			|| (document.querySelector('.pane .tree-row[aria-expanded="false"] .chevron')?.click(), false));
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('[data-tag="w2:gridView"]'));
		await page.evaluate(() => {
			const dt = new DataTransfer();
			const row = [...document.querySelectorAll('.pane .tree-row')].find(r => r.textContent.includes('dl1'));
			row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, composed: true, dataTransfer: dt }));
			const grid = document.querySelector('.canvas-host').shadowRoot.querySelector('[data-tag="w2:gridView"]');
			grid.dispatchEvent(new DragEvent('dragover', { bubbles: true, composed: true, cancelable: true, dataTransfer: dt }));
			grid.dispatchEvent(new DragEvent('drop', { bubbles: true, composed: true, cancelable: true, dataTransfer: dt }));
		});
		await page.waitForSelector('.grid-bind');
		assert.equal(await page.$eval('#grid-bind-mode', el => el.value), 'new');
		await page.evaluate(() => [...document.querySelectorAll('.grid-bind-parts label')].find(l => l.textContent === 'footer').click());
		await page.$eval('.grid-bind .btn-primary', b => b.click());
		const sent = await page.evaluate(() => window.sent);
		assert.equal(sent.find(m => m.type === 'bindGrid')?.mode, 'new', JSON.stringify(sent));
		assert.deepEqual(sent.find(m => m.type === 'bindGrid').extras, { footer: true });
		await page.waitForFunction(() => !document.querySelector('.grid-bind'));
		console.log('Design: dataList → gridView 바인딩 팝업 passed');
		// 그리드 우클릭 → subTotal 추가, footer·subTotal 행이 캔버스에 그려짐
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:gridView id="grd"><w2:gBody id="b"><w2:row id="r"><w2:column id="a"/></w2:row></w2:gBody><w2:subTotal id="s"><w2:row id="sr"><w2:column id="sc" value="소계"/></w2:row></w2:subTotal><w2:footer id="f"><w2:row id="fr"><w2:column id="fc" value="합계"/></w2:row></w2:footer></w2:gridView></body></html>';
			window.sent.length = 0;
			const root = window.parseXml(text);
			root.children[0].children[0].def = 2;
			window.send({ type: 'document', version: 90, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('.w2grid .gridFooterTableDefault'));
		assert.match(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid').textContent), /소계.*합계/);
		await page.evaluate(() => {
			const cell = document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid tbody td');
			cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true, clientX: 50, clientY: 50 }));
		});
		await page.waitForSelector('.context-menu');
		assert.equal(await page.$$eval('.context-menu button', bs => bs.find(b => b.textContent === 'footer 추가').disabled), true, 'footer 있으면 footer 추가 비활성');
		assert.deepEqual(await page.$$eval('.context-menu button', bs => bs.map(b => b.textContent)), ['왼쪽에 Column 추가', '오른쪽에 Column 추가', 'Row 추가', 'Header 추가', 'subTotal 추가', 'footer 추가', '열 왼쪽으로 이동', '열 오른쪽으로 이동', '열 삭제Delete']);
		await page.$eval('.context-menu button:nth-child(2)', b => b.click());
		const addPart = await page.evaluate(() => window.sent.find(m => m.type === 'addGridPart'));
		assert.equal(addPart?.part, 'column');
		assert.equal(addPart?.at, 5, '우클릭한 본문 컬럼 기준');
		// 열 너비 끌기: 기준 칸(gBody 한 줄) 오른쪽 가장자리를 30px 끌면 그 컬럼 width
		await page.evaluate(() => {
			const td = document.querySelector('.canvas-host').shadowRoot.querySelector('[data-wse-resize]');
			const r = td.getBoundingClientRect();
			const at = (type, x) => td.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, button: 0, pointerId: 1, clientX: x, clientY: r.top + 5 }));
			at('pointerdown', r.right - 2); at('pointermove', r.right + 28); at('pointerup', r.right + 28);
		});
		const widthMsg = await page.evaluate(() => window.sent.find(m => m.type === 'setAttr' && m.name === 'width'));
		assert.ok(widthMsg && widthMsg.index === 5 && widthMsg.value === '100', `기본 70 + 30 = 100: ${JSON.stringify(widthMsg)}`);
		console.log('Design: 그리드 우클릭 subTotal·footer 추가·표시 passed');
		// 다단 헤더: 번호 칸(rowSpan 2)에 header 소속, 헤더 row 높이는 가장 높은 row에 맞춤
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:gridView id="grd" rowNumVisible="true" rowStatusVisible="true"><w2:header id="h"><w2:row id="h1"><w2:column id="hc" inputType="checkbox"/></w2:row><w2:row id="h2"><w2:column id="ht" value="zz"/></w2:row></w2:header><w2:gBody id="b"><w2:row id="r"><w2:column id="a"/></w2:row></w2:gBody></w2:gridView></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 2;
			window.send({ type: 'document', version: 91, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => {
			const rows = document.querySelector('.canvas-host')?.shadowRoot?.querySelectorAll('.w2grid thead tr');
			return rows?.length === 2 && rows[0].style.height && rows[0].style.height === rows[1].style.height;
		});
		assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid thead th.gridHeaderTDDefault_rowNumber').getAttribute('data-wse')), '3', '번호 칸 = w2:header');
		// 상태 칸(번호 칸과 같은 header index)에 올려도 헤더 전체가 hover 배경으로 덮인다
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('th.gridHeaderTDDefault_rowStatus').dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true })));
		await page.waitForFunction(() => {
			const s = document.querySelector('.canvas-host').shadowRoot;
			const hover = s.querySelector('.wse-frame.hover')?.getBoundingClientRect(), head = s.querySelector('.w2grid thead').getBoundingClientRect();
			return hover && Math.abs(hover.width - head.width) < 2 && Math.abs(hover.height - head.height) < 2;
		});
		console.log('Design: 다단 헤더 높이·번호/상태 칸 hover passed');
		// inputType 아이콘: 스킨에 없는 타입은 codicon, radio는 실제 입력 모양, select는 스킨 클래스만
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:gridView id="grd"><w2:gBody id="b"><w2:row id="r"><w2:column id="a" inputType="link"/><w2:column id="c" inputType="radio"/><w2:column id="d" inputType="select"/><w2:column id="e" inputType="secret"/></w2:row></w2:gBody></w2:gridView></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 2;
			window.send({ type: 'document', version: 93, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('.w2grid input[type="radio"]'));
		assert.deepEqual(await page.evaluate(() => [...document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.w2grid tbody td')].map(td => td.querySelector('.wse-input-icon')?.title ?? td.className.match(/gridBodyDefault_(?!data\b)(\w+)/)?.[1])), ['link', 'radio', 'select', 'secret']);
		console.log('Design: 그리드 inputType 아이콘 passed');
		// 그리드 열 너비: 그리드가 좁아도 XML width 그대로(가로 스크롤). autoFit="none"도 같고, allColumn·lastColumn은 남는 폭을 채운다
		const gridWidths = (autoFit, width = 300) => page.evaluate(async (autoFit, width) => {
			const text = `<html xmlns:w2="urn:test"><body><w2:gridView id="grd" style="width:${width}px" rowNumVisible="true"${autoFit ? ` autoFit="${autoFit}"` : ''}><w2:header id="h"><w2:row id="h1"><w2:column id="c1" width="100" value="A"/><w2:column id="c2" width="250" value="B"/></w2:row></w2:header><w2:gBody id="b"><w2:row id="r"><w2:column id="d1"/><w2:column id="d2"/></w2:row></w2:gBody></w2:gridView></body></html>`;
			const root = window.parseXml(text);
			root.children[0].children[0].def = 2;
			window.send({ type: 'document', version: 95, text, root, script: { text: '' } });
			await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
			return [...document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.w2grid thead th')].map(th => Math.round(th.getBoundingClientRect().width));
		}, autoFit, width);
		assert.deepEqual(await gridWidths(''), [40, 100, 250], '열 너비 유지');
		assert.deepEqual(await gridWidths('none'), [40, 100, 250], 'autoFit=none은 안 채움');
		const fitAll = await gridWidths('allColumn', 800);
		assert.ok(fitAll[2] > 250 && fitAll[1] > 100, `allColumn은 모든 열로 채움 ${fitAll}`);
		const fitLast = await gridWidths('lastColumn', 800);
		assert.ok(fitLast[0] === 40 && fitLast[1] === 100 && fitLast[2] > 250, `lastColumn은 마지막 열만 ${fitLast}`);
		// 우클릭 Header 추가로 header가 두 줄이 돼도 열 너비는 기존 header 기준 그대로(gBody에 width가 없어도 안 줄어듦), 끌기 손잡이도 그 칸에
		const multi = await page.evaluate(async () => {
			const text = '<html xmlns:w2="urn:test"><body><w2:gridView id="grd" style="width:300px" rowNumVisible="true"><w2:header id="h"><w2:row id="h1"><w2:column id="c1" width="100" value="A"/><w2:column id="c2" width="250" value="B"/></w2:row><w2:row id="h2"><w2:column id="x1" width="100"/><w2:column id="x2" width="100"/></w2:row></w2:header><w2:gBody id="b"><w2:row id="r"><w2:column id="d1"/><w2:column id="d2"/></w2:row></w2:gBody></w2:gridView></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 2;
			window.send({ type: 'document', version: 96, text, root, script: { text: '' } });
			await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
			const s = document.querySelector('.canvas-host').shadowRoot;
			return { widths: [...s.querySelectorAll('.w2grid thead tr:first-child th')].map(th => Math.round(th.getBoundingClientRect().width)),
				handles: [...s.querySelectorAll('.w2grid [data-wse-resize]')].map(e => `${e.id || e.getAttribute('data-wse')}:${e.getAttribute('data-wse-resize')}`) };
		});
		assert.deepEqual(multi.widths, [40, 100, 250], '다단 헤더 열 너비');
		assert.equal(multi.handles.length, 2, `손잡이는 기준 칸 둘: ${multi.handles}`);
		console.log('Design: 그리드 열 너비·autoFit·다단 헤더 passed');
		// Ctrl+클릭 다중 선택: 주 선택 + 점선 테두리
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:input id="m1"/><w2:input id="m2"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children.forEach(c => c.def = 0);
			window.send({ type: 'document', version: 92, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#m2'));
		await page.evaluate(() => {
			const s = document.querySelector('.canvas-host').shadowRoot;
			s.querySelector('#m1').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			s.querySelector('#m2').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, ctrlKey: true }));
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length === 2);
		assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected.extra').length), 1);
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('#m1').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length === 1);
		console.log('Design: Ctrl+클릭 다중 선택 passed');
		// 여러 개 고른 채 Property 값 변경 → 한 요청에 모두(id는 마지막 선택만), Style은 바뀐 CSS 속성만 각자의 style에
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:input id="m1" style="width:10px;top:1px;"/><w2:input id="m2" style="width:20px;top:2px;"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children.forEach(c => c.def = 0);
			window.send({ type: 'document', version: 93, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelectorAll('.canvas-host')[0]?.shadowRoot?.querySelector('#m2[style]') || true);
		await page.evaluate(() => {
			const s = document.querySelector('.canvas-host').shadowRoot;
			s.querySelector('#m1').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			s.querySelector('#m2').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, ctrlKey: true }));
		});
		await page.waitForSelector('.kv select.choice');
		await page.evaluate(() => { window.sent.length = 0; });
		await page.select('.kv select.choice', 'true');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'disabled'));
		const multiMsg = await page.evaluate(() => window.sent.find(m => m.type === 'setAttr'));
		assert.deepEqual({ index: multiMsg.index, value: multiMsg.value, more: multiMsg.more }, { index: 3, value: 'true', more: [{ index: 2, value: 'true' }] }, '두 컴포넌트 한 요청');
		await page.evaluate(() => { window.sent.length = 0; });
		await page.click('.style-area .style-value');
		await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
		await page.keyboard.type('width:99px;top:2px;');
		await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'style'));
		const styleMsg = await page.evaluate(() => window.sent.find(m => m.name === 'style'));
		assert.deepEqual({ value: styleMsg.value, more: styleMsg.more }, { value: 'width:99px;top:2px;', more: [{ index: 2, value: 'width:99px;top:1px;' }] }, 'Style은 바뀐 속성(width)만 다른 컴포넌트에');
		await page.evaluate(() => { window.sent.length = 0; });
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('#m2').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
		console.log('Property: 여러 개 선택 후 값·Style 변경 passed');
		// 바인딩된 그리드의 본문 셀: Property의 id는 dataList 컬럼 id 목록에서 고른다(헤더 셀은 그대로 입력칸)
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test" xmlns:xf="http://www.w3.org/2002/xforms"><head><xf:model><w2:dataCollection><w2:dataList id="dl"><w2:columnInfo><w2:column id="name"/><w2:column id="age"/></w2:columnInfo></w2:dataList></w2:dataCollection></xf:model></head>'
				+ '<body><w2:gridView id="grd" dataList="data:dl"><w2:header id="h"><w2:row id="hr"><w2:column id="hc" value="H"/></w2:row></w2:header><w2:gBody id="b"><w2:row id="br"><w2:column id="nmae"/></w2:row></w2:gBody></w2:gridView></body></html>';
			const root = window.parseXml(text);
			root.children[1].children[0].def = 2;
			window.send({ type: 'document', version: 94, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('.w2grid tbody td'));
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid tbody td').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
		// 입력칸 + 목록(datalist): 직접 입력도, 목록에서 고르기도
		const idValue = () => page.evaluateHandle(() => [...document.querySelectorAll('.kv tr')].find(tr => tr.querySelector('.key')?.textContent === 'id').querySelector('.value, input'));
		await page.waitForFunction(() => [...document.querySelectorAll('.kv tr')].find(tr => tr.querySelector('.key')?.textContent === 'id')?.querySelector('.value.has-list'), {timeout: 3000})
			.catch(() => assert.fail('본문 셀 id에 목록 표시 없음'));
		await (await idValue()).click();
		await page.waitForSelector('.kv input[role="combobox"]');
		const comboItems = () => page.evaluate(() => [...document.querySelectorAll('.combo-list li')].map(l => l.textContent));
		assert.deepEqual([await page.$eval('.kv input[role="combobox"]', i => i.value), ...await comboItems()], ['nmae', 'name', 'age'], '지금 값(오타)이 있어도 dataList 컬럼 전체 목록');
		await page.evaluate(() => { window.sent.length = 0; });
		await page.$eval('.kv input[role="combobox"]', i => i.select());
		await page.keyboard.type('a');
		assert.deepEqual(await comboItems(), ['name', 'age'], '타이핑하면 그 글자를 포함하는 것만');
		await page.keyboard.type('g');
		assert.deepEqual(await comboItems(), ['age']);
		await page.$eval('.kv input[role="combobox"]', i => i.select());
		await page.keyboard.type('custom'); await page.keyboard.press('Enter');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'id' && m.value === 'custom'), {timeout: 3000}).catch(() => assert.fail('직접 입력'));
		await (await idValue()).click();
		await page.waitForSelector('.combo-list li');
		await page.evaluate(() => [...document.querySelectorAll('.combo-list li')].find(l => l.textContent === 'age').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
		await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'id' && m.value === 'age'), {timeout: 3000}).catch(() => assert.fail('목록에서 고르면 바로 반영'));
		assert.equal(await page.$('.kv input[role="combobox"]'), null, '고르면 닫힘');
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid thead th:last-child').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
		await page.waitForFunction(() => !document.querySelector('.kv .value.has-list'));
		console.log('Property: 바인딩된 그리드 셀 id → 입력칸 + dataList 컬럼 목록 passed');
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:input id="m1"/><w2:input id="m2"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children.forEach(c => c.def = 0);
			window.send({ type: 'document', version: 95, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#m2'));
		// 캔버스의 input 컴포넌트를 실제로 클릭(그 안 input에 포커스)해도 Delete가 먹어야 한다. Ctrl+클릭으로 둘 고르면 한 요청에 둘 다
		const inputBox = async id => page.evaluate(id => {
			const r = document.querySelector('.canvas-host').shadowRoot.querySelector(`#${id}`).getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		}, id);
		await page.evaluate(() => { window.sent.length = 0; });
		const b1 = await inputBox('m1'), b2 = await inputBox('m2');
		await page.mouse.click(b1.x, b1.y);
		await page.keyboard.down('Control'); await page.mouse.click(b2.x, b2.y); await page.keyboard.up('Control');
		await page.keyboard.press('Delete');
		const delMsg = await page.evaluate(() => window.sent.find(m => m.type === 'delete'));
		assert.ok(delMsg && [delMsg.index, ...delMsg.more ?? []].length === 2, JSON.stringify(delMsg));
		console.log('Design: 캔버스 input 클릭 후 Delete(다중) passed');
		// Outline: 클릭·Ctrl+클릭 다중 선택(두 행 다 선택 표시, 캔버스와 공유) → Delete·복사·붙여넣기
		await page.evaluate(() => [...document.querySelectorAll('.pane button, .pane [role="tab"]')].find(b => b.textContent.trim() === 'Outline')?.click());
		const outlineRow = id => page.evaluate(id => {
			const r = [...document.querySelectorAll('.pane .tree-row')].find(row => row.querySelector('.id')?.textContent === id).getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		}, id);
		await page.evaluate(() => { window.sent.length = 0; });
		const o1 = await outlineRow('m1'), o2 = await outlineRow('m2');
		await page.mouse.click(o1.x, o1.y);
		await page.keyboard.down('Control'); await page.mouse.click(o2.x, o2.y); await page.keyboard.up('Control');
		assert.equal(await page.evaluate(() => document.querySelectorAll('.pane .tree-row.selected').length), 2, 'Outline 두 행 선택 표시');
		assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length), 2, '캔버스도 두 개');
		await page.keyboard.press('Delete');
		const outlineDel = await page.evaluate(() => window.sent.find(m => m.type === 'delete'));
		assert.ok(outlineDel && [outlineDel.index, ...outlineDel.more ?? []].length === 2, JSON.stringify(outlineDel));
		await page.mouse.click(o1.x, o1.y);
		await page.keyboard.down('Control'); await page.mouse.click(o2.x, o2.y); await page.keyboard.up('Control');
		await page.evaluate(() => {
			document.activeElement.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true }));
			document.activeElement.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }));
		});
		const outlinePaste = await page.evaluate(() => window.sent.find(m => m.type === 'paste'));
		assert.equal(outlinePaste?.xml.length, 2, JSON.stringify(outlinePaste));
		// 다른 화면 XML로: 복사하면 클립보드에도(확장 형식 + 글자), 붙여 넣을 때 클립보드의 것을 쓴다(다른 화면에서 복사한 것)
		const clip = await page.evaluate(() => {
			window.sent.length = 0;
			const copied = new DataTransfer();
			document.activeElement.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: copied }));
			const other = new DataTransfer();
			other.setData('application/x-websquare5-nodes', JSON.stringify(['<w2:input id="fromB"/>']));
			document.activeElement.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: other }));
			return { nodes: JSON.parse(copied.getData('application/x-websquare5-nodes')).length, text: copied.getData('text/plain'), pasted: window.sent.find(m => m.type === 'paste')?.xml };
		});
		assert.equal(clip.nodes, 2, '복사한 두 개가 클립보드에');
		assert.ok(clip.text.startsWith('<'), `글자로도: ${clip.text}`);
		assert.deepEqual(clip.pasted, ['<w2:input id="fromB"/>'], '다른 화면에서 복사한 것을 붙여 넣음');
		console.log('Outline: 클릭·Ctrl+클릭 다중 선택·Delete·복사·붙여넣기 passed');
		// F2: 고른 노드의 id를 트리에서 바로(Enter 반영, 형식·중복은 경고만, Esc 취소)
		await page.mouse.click(o1.x, o1.y);
		await page.evaluate(() => { window.sent.length = 0; });
		await page.keyboard.press('F2');
		await page.waitForSelector('.pane .tree-rename', {timeout: 3000}).catch(() => assert.fail('F2로 id 입력칸이 안 열림'));
		assert.equal(await page.$eval('.pane .tree-rename', i => i.value), 'm1');
		await page.$eval('.pane .tree-rename', i => i.select()); await page.keyboard.type('m9'); await page.keyboard.press('Enter');
		assert.deepEqual(await page.evaluate(() => { const m = window.sent.find(m => m.type === 'setAttr'); return m && [m.name, m.value]; }), ['id', 'm9'], 'F2 → Enter: id 변경');
		assert.equal(await page.$('.pane .tree-rename'), null, 'Enter로 닫힘');
		await page.evaluate(() => { window.sent.length = 0; });
		await page.keyboard.press('F2'); await page.waitForSelector('.pane .tree-rename');
		await page.$eval('.pane .tree-rename', i => i.select()); await page.keyboard.type('m2'); await page.keyboard.press('Enter');
		assert.deepEqual(await page.evaluate(() => window.sent.map(m => m.type)), ['warn'], '이미 있는 id는 경고만');
		await page.keyboard.press('F2'); await page.waitForSelector('.pane .tree-rename');
		await page.keyboard.type('x'); await page.keyboard.press('Escape');
		assert.equal(await page.$('.pane .tree-rename'), null, 'Esc로 취소');
		assert.equal(await page.evaluate(() => window.sent.filter(m => m.type === 'setAttr').length), 0);
		// id가 없는 노드(body)도 F2로 새 id를 넣는다
		await page.evaluate(() => [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.tag')?.textContent === 'body' && !r.querySelector('.id')).click());
		await page.keyboard.press('F2'); await page.waitForSelector('.pane .tree-rename', {timeout: 3000}).catch(() => assert.fail('id 없는 노드에서 F2'));
		assert.equal(await page.$eval('.pane .tree-rename', i => i.value), '', '빈 칸으로');
		await page.keyboard.type('bodyMain'); await page.keyboard.press('Enter');
		assert.deepEqual(await page.evaluate(() => { const m = window.sent.findLast(m => m.type === 'setAttr'); return m && [m.name, m.value]; }), ['id', 'bodyMain'], 'id 새로 넣기');
		console.log('Outline: F2 id 바꾸기 passed');
		// 캔버스를 꽉 채운 컴포넌트를 골라도 선택 박스·손잡이·칩이 스크롤을 만들지 않는다(겹침 층). 칩은 보이는 영역 안, 마우스를 올리면 흐려짐
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:input id="top" class="a b" style="width:100%;height:100%;box-sizing:border-box"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 0;
			window.send({ type: 'document', version: 94, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#top'));
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('#top').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-overlay .wse-frame.selected .wse-handle'));
		await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
		const fill = await page.evaluate(() => {
			const s = document.querySelector('.canvas-host').shadowRoot, p = s.querySelector('.wse-page');
			const chip = s.querySelector('.wse-chip'), c = chip.getBoundingClientRect(), b = p.getBoundingClientRect();
			return { overflow: p.scrollWidth > p.clientWidth || p.scrollHeight > p.clientHeight, text: chip.textContent,
				inside: c.left >= b.left && c.top >= b.top && c.right <= b.left + p.clientWidth && c.bottom <= b.top + p.clientHeight, x: c.left + c.width / 2, y: c.top + c.height / 2 };
		});
		assert.deepEqual([fill.overflow, fill.text, fill.inside], [false, 'input #top .a.b', true]);
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row .cls')].some(e => e.textContent === '.a.b'));
		await page.mouse.move(fill.x, fill.y);
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-chip.faded'));
		await page.mouse.move(5, 5);
		await page.screenshot({path:path.join(tmpdir(), 'ws5-design-chip.png')});
		console.log('Design: 겹침 층(스크롤 없음)·선택 정보 칩·Outline class passed');
		// selectbox·radio 더블클릭 → 선택 항목 팝업. 확인하면 editChoices 한 번, 성공 응답이면 닫히고 실패면 팝업에 이유
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test" xmlns:xf="http://www.w3.org/2002/xforms"><body><xf:select1 id="sel" appearance="minimal" ref="data:m.a"><xf:choices><xf:item><xf:label><![CDATA[재직자]]></xf:label><xf:value><![CDATA[1]]></xf:value></xf:item></xf:choices></xf:select1><xf:select1 id="rad" appearance="full" cols="2"/></body><head><xf:model><w2:dataCollection><w2:dataList id="dlt_code"><w2:columnInfo><w2:column id="code"/><w2:column id="name"/></w2:columnInfo></w2:dataList></w2:dataCollection></xf:model></head></html>';
			const root = window.parseXml(text);
			const [sel, rad] = root.children[0].children;
			sel.def = 3; rad.def = 4;
			window.sent.length = 0;
			window.send({ type: 'document', version: 97, text, root, script: { text: '' } });
		});
		const dblclick = id => page.evaluate(id => document.querySelector('.canvas-host').shadowRoot.querySelector(`#${id}`)
			.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })), id);
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#rad'));
		await dblclick('sel');
		await page.waitForSelector('.choices-editor[open]');
		assert.deepEqual(await page.$$eval('.choices-editor tbody input:not([type="checkbox"]), #choices-ref', els => els.map(e => e.value)), ['재직자', '1', 'data:m.a']);
		await page.click('.choices-editor button[aria-label="행 추가"]');
		await page.type('.choices-editor input[aria-label="2행 Label"]', '퇴직자');
		await page.type('.choices-editor input[aria-label="2행 Value"]', '2');
		await page.evaluate(() => [...document.querySelectorAll('.choices-editor .choices-check')].find(l => l.textContent.includes('All Option')).querySelector('input').click());
		// 손잡이(⠿)로 2행을 1행 위로 끌어 놓기(DataList와 같은 방식)
		await page.evaluate(() => {
			const dt = new DataTransfer(), handle = document.querySelector('.choices-editor button[aria-label="2행 이동"]');
			const first = document.querySelector('.choices-editor tbody tr'), r = first.getBoundingClientRect();
			handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
			first.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.top + 2 }));
			first.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.top + 2 }));
			handle.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
		});
		assert.deepEqual(await page.$$eval('.choices-editor tbody input[aria-label$="Label"]', els => els.map(e => e.value)), ['퇴직자', '재직자'], '행 끌어 순서 변경');
		await page.screenshot({path:path.join(tmpdir(), 'ws5-choices-selectbox.png')});
		await page.click('.choices-editor .btn-primary');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'editChoices'));
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'editChoices').fields),
			{ items: [{ label: '퇴직자', value: '2' }, { label: '재직자', value: '1' }], attrs: { ref: 'data:m.a', allOption: 'true' } });
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'editChoices').popup, ok: true }));
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		// radio: 데이터 바인딩(BindItemSet, 항목 표는 비활성) + 정렬 방향 cols → rows
		await dblclick('rad');
		await page.waitForSelector('.choices-editor[open]');
		assert.deepEqual(await page.$$eval('#choices-direction, #choices-count', els => els.map(e => e.value ?? e.dataset.value)), ['cols', '2']);
		await page.evaluate(() => [...document.querySelectorAll('.choices-editor .choices-check')].find(l => l.textContent.includes('데이터에서 가져오기')).querySelector('input').click());
		assert.ok(await page.$eval('.choices-editor button[aria-label="행 추가"]', b => b.disabled), '바인딩 중 항목 표 비활성');
		// NodeSet·Label·Value: 입력칸 + 목록(동적 dataList는 목록에 없어 직접 입력)
		const pick = (v) => page.evaluate(v => [...document.querySelectorAll('.combo-list li')].find(l => l.textContent === v).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })), v);
		await page.type('#choices-nodeset', 'data:dlt_dyn');
		assert.equal(await page.$('.combo-list'), null, '목록에 없는 NodeSet도 입력');
		await page.$eval('#choices-nodeset', el => el.select());
		await page.type('#choices-nodeset', 'data:dlt_');
		await page.waitForSelector('.combo-list li');
		await pick('data:dlt_code');
		await page.type('#choices-label', 'name');
		await page.focus('#choices-value');
		await page.waitForSelector('.combo-list li');
		await pick('code');
		await page.click('#choices-direction button:nth-child(3)');
		await page.$eval('#choices-count', el => { el.focus(); el.select(); });
		await page.keyboard.type('3');
		await page.screenshot({path:path.join(tmpdir(), 'ws5-choices-radio.png')});
		await page.evaluate(() => { window.sent.length = 0; });
		await page.click('.choices-editor .btn-primary');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'editChoices'));
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'editChoices').fields),
			{ items: [], itemset: { nodeset: 'data:dlt_code', label: 'name', value: 'code' }, attrs: { ref: null, cols: null, rows: '3' } }, '지울 속성은 null(JSON 메시지에서 undefined는 사라짐)');
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'editChoices').popup, ok: false, error: '문서가 바뀌었어. 팝업을 다시 열어 줘.' }));
		await page.waitForFunction(() => document.querySelector('.choices-editor .error')?.textContent.includes('문서가 바뀌었어'));
		await page.$eval('.choices-editor .popup-close', b => b.click());
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		// Outline: 이름은 정의의 display(태그는 툴팁), 더블클릭하면 캔버스와 같은 팝업
		await page.evaluate(() => window.tab('Outline', '.pane').click());
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row .tag')].some(t => t.textContent === 'Radio'));
		assert.deepEqual(await page.$$eval('.pane .tree-row .tag', tags => tags.map(t => `${t.textContent}|${t.title}`).filter(s => s.endsWith('select1'))), ['SelectBox|xf:select1', 'Radio|xf:select1']);
		await page.evaluate(() => [...document.querySelectorAll('.pane .tree-row .tag')].find(t => t.textContent === 'Radio').closest('.tree-row').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
		await page.waitForSelector('.choices-editor[open]');
		assert.deepEqual(await page.$$eval('#choices-direction, #choices-count', els => els.map(e => e.value ?? e.dataset.value)), ['cols', '2'], 'Outline 더블클릭 → radio 팝업');
		await page.$eval('.choices-editor .popup-close', b => b.click());
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		console.log('Design: selectbox·radio 선택 항목 팝업(항목·All Option·바인딩·정렬, Outline 이름·더블클릭) passed');
		// 팔레트: 확장이 넣은 컴포넌트(select id)는 그 id가 든 다음 문서에서 선택된다
		await page.evaluate(() => {
			window.send({ type: 'select', id: 'radio1' });
			const text = '<html xmlns:w2="urn:test" xmlns:xf="http://www.w3.org/2002/xforms"><body><xf:select1 id="sel" appearance="minimal"/><xf:select1 id="radio1" appearance="full"><xf:choices></xf:choices></xf:select1><xf:select1 id="rad" appearance="full"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children.forEach((n, i) => { n.def = i === 0 ? 3 : 4; });
			window.send({ type: 'document', version: 97, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.pane .tree-row.selected .id')?.textContent === 'radio1');
		console.log('Palette: 넣은 컴포넌트 선택 passed');
		// 문구 편집(라벨 더블클릭) 중에는 선택 테두리·손잡이·표시 점(겹침 층)을 숨긴다: 페이지 위 층이라 편집 상자를 덮는다
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:input id="btnLabel" label="취소"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 0;
			window.send({ type: 'document', version: 97, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#btnLabel'));
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('#btnLabel').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })));
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit'), {timeout: 3000});
		assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-overlay').hidden), true, '문구 편집 중 겹침 층 숨김');
		await page.keyboard.press('Escape');
		await page.waitForFunction(() => !document.querySelector('.canvas-host').shadowRoot.querySelector('.edit'), {timeout: 3000});
		assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-overlay').hidden), false, '편집을 닫으면 다시 보임');
		// 그리드 헤더 칸 더블클릭: 문구 상자 아래 너비(W)·높이(H). 칸으로 옮겨도 안 닫히고, Enter면 문구·width·style height를 한 편집으로
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:gridView id="grdSize"><w2:header id="hd"><w2:row id="hr"><w2:column id="h1" value="이름" width="70" style="height:26px;"/></w2:row></w2:header><w2:gBody id="gb"><w2:row id="br"><w2:column id="b1"/></w2:row></w2:gBody></w2:gridView></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 2;
			// 헤더 칸 문구 편집은 컬럼 정의(realType column)가 있어야 열린다
			window.send({ type: 'definitions', defs: [...window.testDefs, { id: 'column', ns: 'urn:test', realType: 'column', parents: [], bases: [], events: [],
				properties: [{ name: 'inputType', category: '', order: 0, description: '입력 방식', options: ['text', 'select', 'checkbox'] }] }] });
			const grid = root.children[0].children[0];
			grid.children[0].children[0].children[0].def = grid.children[1].children[0].children[0].def = window.testDefs.length;
			window.sent.length = 0;
			window.send({ type: 'document', version: 96, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('.w2grid thead th'));
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid thead th').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })));
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-footer input'), {timeout: 3000});
		assert.deepEqual(await page.evaluate(() => [...document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.edit-footer input')].slice(0, 2).map(i => i.value)), ['70', '26'], '지금 너비·높이');
		const sizeInput = await page.evaluateHandle(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.edit-footer input')[0]);
		await sizeInput.click(); await sizeInput.evaluate(i => i.select());
		await page.keyboard.type('12x0');
		assert.equal(await page.evaluate(() => !!document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-footer')), true, '칸으로 옮겨도 열려 있음');
		// 입력칸이 아닌 이름 글자를 눌러도 닫히지 않음(그 입력칸으로)
		const nameLabel = await page.evaluateHandle(() => [...document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.edit-fields .name')].find(e => e.textContent === 'class'));
		await nameLabel.click();
		assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.activeElement?.getAttribute('aria-label')), 'class', '이름을 누르면 그 입력칸으로');
		assert.equal(await page.evaluate(() => getSelection().toString()), '', '더블클릭 글자 선택이 남지 않음');
		await sizeInput.click();
		await page.keyboard.press('Enter');
		assert.deepEqual(await page.evaluate(() => { const m = window.sent.find(m => m.type === 'setAttr'); return m && { name: m.name, value: m.value, also: m.also }; }),
			{ name: 'value', value: '이름', also: [{ name: 'width', value: '120' }] }, '바뀐 너비만, 숫자만');
		assert.equal(await page.evaluate(() => !!document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-wrap')), false, 'Enter로 닫힘');
		// 본문 셀 더블클릭: 자주 고치는 속성(정해진 값은 select, 숫자 칸은 숫자만)을 한 편집으로
		await page.evaluate(() => { window.sent.length = 0; document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid tbody td').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })); });
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-fields'), {timeout: 3000}).catch(() => assert.fail('본문 셀 속성 입력 없음'));
		assert.deepEqual(await page.evaluate(() => [...document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.edit-fields .name')].map(e => e.textContent)),
			['width', 'height', 'id', 'class', 'inputType', 'dataType', 'maxLength', 'maxByteLength', 'expression', 'colMerge']);
		assert.deepEqual(await page.evaluate(() => { const r = document.querySelector('.canvas-host').shadowRoot; return { part: r.querySelector('.edit-head .edit-chip')?.textContent, id: r.querySelector('.edit-head .edit-id')?.textContent, sections: [...r.querySelectorAll('.edit-section')].map(e => e.textContent), buttons: [...r.querySelectorAll('.edit-actions button')].map(b => b.textContent) }; }),
			{ part: '본문 칸', id: 'b1', sections: ['크기', '속성'], buttons: ['취소', '적용'] }, '칸 종류·id, 크기·속성 묶음, 취소·적용');
		await page.screenshot({path:path.join(tmpdir(), 'ws5-cell-editor.png')});
		const cellField = name => page.evaluateHandle(name => document.querySelector('.canvas-host').shadowRoot.querySelector(`.edit-fields [aria-label="${name}"]`), name);
		assert.equal(await (await cellField('inputType')).evaluate(e => e.tagName), 'SELECT', '정해진 값은 select');
		await (await cellField('inputType')).select('checkbox');
		await (await cellField('class')).click(); await page.keyboard.type('num');
		await (await cellField('maxLength')).click(); await page.keyboard.type('1a0');
		assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-status')?.textContent), '바꾼 속성 3');
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-apply').click());
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'setAttr')?.also),
			[{ name: 'class', value: 'num' }, { name: 'inputType', value: 'checkbox' }, { name: 'maxLength', value: '10' }], '적용 버튼: 바뀐 속성만 한 편집으로');
		assert.equal(await page.evaluate(() => !!document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-wrap')), false, '적용하면 닫힘');
		// 편집 상자 너비: 좁은 칸은 400, 넓은 칸(width 900)도 480까지만
		const wrapWidth = () => page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-wrap')?.getBoundingClientRect().width);
		for (const [cellWidth, expected] of [[70, 400], [900, 480]]) {
			await page.evaluate(cellWidth => {
				const text = `<html xmlns:w2="urn:test"><body><w2:gridView id="grdSize"><w2:header id="hd"><w2:row id="hr"><w2:column id="h1" value="이름" width="${cellWidth}"/></w2:row></w2:header><w2:gBody id="gb"><w2:row id="br"><w2:column id="b1"/></w2:row></w2:gBody></w2:gridView></body></html>`;
				const root = window.parseXml(text), grid = root.children[0].children[0];
				grid.def = 2;
				grid.children[0].children[0].children[0].def = grid.children[1].children[0].children[0].def = window.testDefs.length;
				window.send({ type: 'document', version: 96, text, root, script: { text: '' } });
			}, cellWidth);
			await page.waitForFunction(w => document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid thead th')?.getBoundingClientRect().width >= w - 2, {timeout: 3000}, Math.min(cellWidth, 600));
			await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid thead th').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })));
			await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-wrap'), {timeout: 3000});
			assert.equal(Math.round(await wrapWidth()), expected, `칸 너비 ${cellWidth} → 편집 상자 ${expected}`);
			// 취소 버튼: 바꾼 값이 있어도 반영 안 하고 닫음
			await page.evaluate(() => { window.sent.length = 0; });
			await (await cellField('class')).click(); await page.keyboard.type('x');
			await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-cancel').click());
			assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'setAttr')), false, '취소는 반영 안 함');
			await page.waitForFunction(() => !document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-wrap'), {timeout: 3000});
		}
		await page.evaluate(() => window.send({ type: 'definitions', defs: window.testDefs }));
		console.log('Design: 그리드 헤더 칸 문구·너비·높이 편집 passed');
		console.log('Design: 그리드 칸(헤더·본문 공통) 더블클릭 속성 입력 passed');
		// 그리드 select 컬럼 칸 더블클릭 → 같은 팝업(Grid Select, All·Choose Option). text 컬럼 칸은 팝업 대신 문구 편집 그대로
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:gridView id="grd"><w2:gBody id="b"><w2:row id="r"><w2:column id="stat" inputType="select"><w2:choices><w2:item><w2:label><![CDATA[미사용]]></w2:label><w2:value><![CDATA[F]]></w2:value></w2:item></w2:choices></w2:column><w2:column id="nm" inputType="text"/></w2:row></w2:gBody></w2:gridView></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 2;
			window.sent.length = 0;
			window.send({ type: 'document', version: 98, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('.w2grid td'));
		const cellDblclick = n => page.evaluate(n => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.w2grid tbody td')[n]
			.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })), n);
		await cellDblclick(1);
		assert.equal(await page.$('.choices-editor'), null, 'text 컬럼은 팝업 없음');
		await cellDblclick(0);
		await page.waitForSelector('.choices-editor[open]');
		assert.equal(await page.$eval('.choices-editor .popup-badge', e => e.textContent), 'Grid Select');
		assert.deepEqual(await page.$$eval('.choices-editor tbody input:not([type="checkbox"])', els => els.map(e => e.value)), ['미사용', 'F']);
		assert.ok(await page.$('.choices-editor .choices-inline'), 'Choose Option 칸');
		await page.evaluate(() => [...document.querySelectorAll('.choices-editor .choices-check')].find(l => l.textContent.includes('Choose Option')).querySelector('input').click());
		await page.type('.choices-editor input[aria-label="Choose Option 문구"]', '-선택-');
		await page.click('.choices-editor .btn-primary');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'editChoices'));
		// 요청 대상은 그 컬럼 노드(칸의 data-wse), 항목은 그대로·Choose Option만 추가
		const choicesMsg = await page.evaluate(() => {
			const m = window.sent.find(m => m.type === 'editChoices');
			const cell = document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid tbody td');
			return { sameNode: m.index === Number(cell.getAttribute('data-wse')), fields: m.fields };
		});
		assert.deepEqual(choicesMsg, { sameNode: true, fields: { items: [{ label: '미사용', value: 'F' }], attrs: { ref: null, chooseOption: 'true', chooseOptionLabel: '-선택-' } } });
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'editChoices').popup, ok: true }));
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		console.log('Design: 그리드 select 컬럼 선택 항목 팝업 passed');
		// checkbox(xf:select)도 radio와 같은 팝업(정렬 방향·개수). 원래 빈 rows=""·다른 속성은 건드리지 않는다
		await page.evaluate(() => {
			const text = '<html xmlns:xf="http://www.w3.org/2002/xforms"><body><xf:select id="chk" appearance="full" cols="" rows="" ref="data:dl.m07" falseValue="0"><xf:choices><xf:item><xf:label><![CDATA[7월]]></xf:label><xf:value><![CDATA[1]]></xf:value></xf:item></xf:choices></xf:select></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 5;
			window.sent.length = 0;
			window.send({ type: 'document', version: 100, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#chk'));
		await dblclick('chk');
		await page.waitForSelector('.choices-editor[open]');
		assert.deepEqual(await page.$$eval('.choices-editor .popup-badge, .choices-editor tbody input:not([type="checkbox"]), #choices-ref, #choices-direction', els => els.map(e => e.value ?? e.dataset.value ?? e.textContent)),
			['Checkbox', '7월', '1', 'data:dl.m07', 'none']);
		await page.click('#choices-direction button:nth-child(2)');
		await page.type('#choices-count', '4');
		await page.click('.choices-editor .btn-primary');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'editChoices'));
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'editChoices').fields),
			{ items: [{ label: '7월', value: '1' }], attrs: { ref: 'data:dl.m07', cols: '4', rows: '' } });
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'editChoices').popup, ok: true }));
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		console.log('Design: checkbox 선택 항목 팝업 passed');
		// 엔진이 모르는 WebSquare 태그(w2:checkbox 등, 정의·UDC 선언 없음)는 엔진처럼 캔버스·Outline 모두 안 보인다. UDC(확장이 udc 표시)는 기본 박스
		await page.evaluate(() => {
			const text = '<html xmlns:w2="http://www.inswave.com/websquare"><body><w2:checkbox id="c1" label="1월"/><w2:udc_upload id="u1"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[1].udc = true;
			window.send({ type: 'document', version: 97, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#u1'));
		assert.deepEqual(await page.evaluate(() => {
			const s = document.querySelector('.canvas-host').shadowRoot;
			return ['#c1', '#u1'].map(id => !!s.querySelector(id)?.getClientRects().length);
		}), [false, true], '캔버스: 모르는 태그는 없음, UDC는 표시');
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('#u1').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row .id')].some(e => e.textContent === 'u1'));
		assert.ok(![...await page.$$eval('.pane .tree-row .id', es => es.map(e => e.textContent))].includes('c1'), 'Outline에도 모르는 태그 없음');
		console.log('Design: 엔진이 모르는 태그 숨김(캔버스·Outline)·UDC 박스 passed');
		// 자리 표시(wse-todo)였던 입력 컴포넌트: checkcombobox·multiselect·spinner·searchbox·output·calendar·multiupload
		await page.evaluate(() => {
			const WS = 'http://www.inswave.com/websquare', XF = 'http://www.w3.org/2002/xforms';
			const def = (id, ns, realType) => ({ id, ns, realType, parents: [], bases: [], properties: [], events: [] });
			window.send({ type: 'definitions', defs: [...window.testDefs, def('checkcombobox', XF, 'checkcombobox'), def('select', XF, 'multiselect'), def('spinner', WS, 'spinner'),
				def('searchbox', WS, 'searchbox'), def('output', XF, 'output'), def('calendar', WS, 'calendar'), def('multiupload', WS, 'multiupload'), def('output', XF, 'output')] });
			const text = `<html xmlns:w2="${WS}" xmlns:xf="${XF}"><body><xf:checkcombobox id="k1" style="width:148px;height:21px;"/><xf:select id="m1"><xf:choices><xf:item><xf:label>가</xf:label><xf:value>a</xf:value></xf:item><xf:item><xf:label>나</xf:label><xf:value>b</xf:value></xf:item></xf:choices></xf:select>`
				+ '<w2:spinner id="s1" value="3"/><w2:searchbox id="q1"/><xf:output id="o1" label="출력"/><w2:calendar id="cal1"/><w2:multiupload id="mu1"/><xf:output id="o2"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children.forEach((n, i) => { n.def = window.testDefs.length + i; });
			window.send({ type: 'document', version: 98, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#mu1'));
		assert.deepEqual(await page.evaluate(() => {
			const s = document.querySelector('.canvas-host').shadowRoot;
			return ['#k1', '#m1', '#s1', '#q1', '#o1', '#cal1', '#mu1'].map(id => s.querySelector(id).matches('.wse-todo'));
		}), [false, false, false, false, false, false, false], '자리 표시 아님');
		assert.deepEqual(await page.evaluate(() => {
			const s = document.querySelector('.canvas-host').shadowRoot;
			return [s.querySelector('#m1').textContent, s.querySelector('#s1 input').value, s.querySelector('#o1').textContent, s.querySelectorAll('#cal1 tbody td').length, s.querySelector('#k1').offsetWidth];
		}), ['가나', '3', '출력', 42, 148]);
		await page.screenshot({ path: path.join(tmpdir(), 'ws5-input-components.png') });
		console.log('Design: checkcombobox·multiselect·spinner·searchbox·output·calendar·multiupload 그리기 passed');
		// output: textbox처럼 더블클릭 → 문구(label) 편집
		await page.evaluate(() => { window.sent.length = 0; document.querySelector('.canvas-host').shadowRoot.querySelector('#o2').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })); });
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit'), { timeout: 3000 });
		await page.keyboard.type('결과');
		await page.keyboard.press('Enter');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr'));
		assert.deepEqual(await page.evaluate(() => { const m = window.sent.find(m => m.type === 'setAttr'); return [m.name, m.value]; }), ['label', '결과']);
		console.log('Design: output 더블클릭 문구 편집 passed');
		// multiupload 더블클릭 → 파라미터(Name·Value) 표만 있는 팝업
		await page.evaluate(() => { window.sent.length = 0; document.querySelector('.canvas-host').shadowRoot.querySelector('#mu1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })); });
		await page.waitForSelector('.choices-editor[open]');
		assert.deepEqual(await page.evaluate(() => [document.querySelector('.choices-editor .popup-badge').textContent, !!document.querySelector('#choices-nodeset'), !!document.querySelector('#choices-ref'),
			[...document.querySelectorAll('.choices-editor thead th')].map(t => t.textContent).slice(2)]), ['Multiupload', false, false, ['Name', 'Value']]);
		await page.click('.choices-editor button[aria-label="행 추가"]');
		await page.type('.choices-editor input[aria-label="1행 Label"]', 'folder');
		await page.type('.choices-editor input[aria-label="1행 Value"]', 'img');
		await page.click('.choices-editor .btn-primary');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'editChoices'));
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'editChoices').fields.items), [{ label: 'folder', value: 'img' }]);
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'editChoices').popup, ok: true }));
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		console.log('Design: multiupload 파라미터 팝업 passed');
		// checkcombobox 더블클릭 → selectbox와 같은 선택 항목 팝업(All·Choose Option 포함)
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('#k1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })));
		await page.waitForSelector('.choices-editor[open]');
		assert.deepEqual(await page.evaluate(() => [document.querySelector('.choices-editor .popup-badge').textContent, !!document.querySelector('.choices-editor .choices-options'), !!document.querySelector('#choices-direction')]),
			['CheckComboBox', true, false]);
		await page.click('.choices-editor .btn-secondary');
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		// multiselect: 같은 팝업, All·Choose Option 영역 없음
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('#m1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })));
		await page.waitForSelector('.choices-editor[open]');
		assert.deepEqual(await page.evaluate(() => [document.querySelector('.choices-editor .popup-badge').textContent, !!document.querySelector('.choices-editor .choices-options'), !!document.querySelector('#choices-direction'),
			[...document.querySelectorAll('.choices-editor tbody input[aria-label$="Label"]')].map(e => e.value)]), ['MultiSelect', false, false, ['가', '나']]);
		await page.evaluate(() => { window.sent.length = 0; });
		await page.$eval('#choices-ref', el => el.focus());
		await page.keyboard.type('data:m.b');
		await page.click('.choices-editor .btn-primary');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'editChoices'));
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'editChoices').fields.attrs), { ref: 'data:m.b' }, 'multiselect는 ref만');
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'editChoices').popup, ok: true }));
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		// Outline 더블클릭도 같은 팝업
		await page.evaluate(() => [...document.querySelectorAll('.pane .tree-row .id')].find(t => t.textContent === 'k1').closest('.tree-row').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
		await page.waitForSelector('.choices-editor[open]');
		assert.equal(await page.$eval('.choices-editor .popup-badge', b => b.textContent), 'CheckComboBox', 'Outline 더블클릭 → checkcombobox 팝업');
		await page.click('.choices-editor .btn-secondary');
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		console.log('Design: checkcombobox·multiselect 선택 항목 팝업(캔버스·Outline 더블클릭) passed');
		// 실제 VS Code처럼 문서 버전은 올라가기만 한다(편집기는 더 높은 버전만 받는다)
		await page.evaluate(() => window.send({ ...window.initialDocument, version: 200 }));
		console.log('Data: 생성 직후 팝업·행 추가·확인·다중 팝업 동시 표시·배경 상호작용 passed');
	const reset = async text => {
		await page.evaluate(text => { const v = window.editor(); v.dispatch({ changes: {from:0, to:v.state.doc.length, insert:text}, selection:{anchor:text.length} }); v.focus(); }, text);
		await page.waitForFunction(() => !document.querySelector('.cm-tooltip-autocomplete'));
	};
	const content = () => page.evaluate(() => window.editor().state.doc.toString());
	const modifiedKey = async (modifier, key) => {
		await page.keyboard.down(modifier); await page.keyboard.press(key); await page.keyboard.up(modifier);
	};
	// 들여쓰기 단위 4칸: 4칸씩 중첩한 코드의 세로선은 단계마다 하나(2칸 단위면 두 배로 그려진다), Tab은 4칸
	const checkIndentUnit = async label => {
		await reset('a {\n    b {\n        c;\n    }\n}');
		const counts = () => page.evaluate(() => [...document.querySelectorAll('.tab-body:not([hidden]) .cm-line')]
			.map(line => (getComputedStyle(line).getPropertyValue('--indent-markers').match(/linear-gradient/g) ?? []).length));
		await page.waitForFunction(() => document.querySelectorAll('.tab-body:not([hidden]) .cm-line.cm-indent-markers').length, {timeout: 3000});
		assert.deepEqual(await counts(), [0, 1, 2, 1, 0], `${label}: 줄별 세로선 수`);
		await reset('');
		await page.keyboard.press('Tab');
		assert.equal(await content(), '    ', `${label}: Tab은 4칸`);
	};
	// 연결 화면(wframe) 안쪽 더블클릭 → 그 화면 열기 요청, 문구 편집 입력칸은 안 열림
	const inner = await page.evaluate(() => {
		const root = document.querySelector('.canvas-host').shadowRoot;
		const r = root.querySelector('[data-wse-frame] input').getBoundingClientRect();
		return { x: r.x + 5, y: r.y + r.height / 2, frame: Number(root.querySelector('[data-wse-frame]').getAttribute('data-wse')) };
	});
	await page.mouse.click(inner.x, inner.y, {count:2});
	await page.waitForFunction(() => window.sent.some(m => m.type === 'openFrame'));
	assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'openFrame')), { type: 'openFrame', index: inner.frame });
	assert.equal(await page.evaluate(() => !!document.querySelector('.canvas-host').shadowRoot.querySelector('.edit')), false);
	console.log('Frame: 더블클릭 → 연결 화면 열기 passed');
	// 패널 구분선: 두께 1px(라이브러리 inline flex에 안 묻힘), 선 옆 3px을 잡아도 끌린다
	assert.deepEqual(await page.$$eval('.resizer', es => es.map(e => Math.min(e.offsetWidth, e.offsetHeight))), [1, 1]);
	const split = await page.$eval('.resizer[aria-orientation="vertical"]', e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top + 200 }; });
	const canvasWidth = () => page.$eval('.canvas-frame', e => e.offsetWidth);
	const canvasBefore = await canvasWidth();
	await page.mouse.move(split.x + 3, split.y); await page.mouse.down();
	await page.mouse.move(split.x - 97, split.y, {steps:5}); await page.mouse.up();
	assert.ok(Math.abs(await canvasWidth() - (canvasBefore - 100)) <= 3, `패널 너비: ${canvasBefore} → ${await canvasWidth()}`);
	console.log('Split: 두께·잡는 범위 passed');
	// Property 값: 정의에 정해진 값 목록이 있으면 select, 고르면 바로 반영
	await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('input[data-wse]'));
	await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('input[data-wse]').click());
	await page.waitForSelector('.kv select.choice');
	await page.evaluate(() => { window.sent.length = 0; });
	await page.select('.kv select.choice', 'true');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'disabled' && m.value === 'true'));
	console.log('Property: 정해진 값 select passed');
	// Key 도움말: 누른 칸 왼쪽에 붙고(floating-ui) 화면 안, Esc로 닫힘
	await page.evaluate(() => [...document.querySelectorAll('.kv td.key')].find(td => td.textContent === 'label').click());
	await page.waitForFunction(() => { const h = document.querySelector('.help'); return h && getComputedStyle(h).visibility === 'visible'; });
	const helpBox = await page.evaluate(() => {
		const h = document.querySelector('.help').getBoundingClientRect(), k = [...document.querySelectorAll('.kv td.key')].find(td => td.textContent === 'label').getBoundingClientRect();
		return { right: h.right, left: h.left, top: h.top, bottom: h.bottom, keyLeft: k.left, keyTop: k.top, text: document.querySelector('.help').textContent };
	});
	assert.equal(helpBox.text, 'label화면에 보이는 글자');
	assert.ok(Math.abs(helpBox.right - (helpBox.keyLeft - 6)) <= 1 && Math.abs(helpBox.top - helpBox.keyTop) <= 1, `도움말이 Key 칸 왼쪽: ${JSON.stringify(helpBox)}`);
	assert.ok(helpBox.left >= 0 && helpBox.bottom <= await page.evaluate(() => innerHeight), '도움말이 화면 안');
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => !document.querySelector('.help'));
	console.log('Property: Key 도움말 자리 passed');
	// Style 칸: Enter는 줄바꿈(반영 안 함), Ctrl+Enter로 반영
	await page.click('.style-area .style-value');
	await page.keyboard.type('width:1px;');
	await page.keyboard.press('Enter');
	await page.keyboard.type('height:2px;');
	assert.equal(await page.$eval('.style-area textarea', el => el.value), 'width:1px;\nheight:2px;');
	assert.ok(!await page.evaluate(() => window.sent.some(m => m.name === 'style')), 'Enter로는 반영 안 함');
	await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'style' && m.value === 'width:1px;\nheight:2px;'));
	assert.equal(await page.$('.style-area textarea'), null, 'Ctrl+Enter로 닫힘');
	console.log('Style: Enter 줄바꿈·Ctrl+Enter 반영 passed');
	// Property 표 Key 열 너비: 머리 칸 손잡이를 끌면 바뀌고 Event 탭에도 유지된다
	await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('input[data-wse]'));
	await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('input[data-wse]').click());
	const handle = await page.waitForSelector('.kv-wrap > .col-resizer');
	const box = await handle.boundingBox();
	const keyWidth = () => page.$eval('.kv th', e => e.offsetWidth);
	const before = await keyWidth();
	const rowY = await page.$eval('.kv tbody tr:not(.category) td', e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }); // 머리 칸이 아닌 td 줄에서 끌기
	await page.mouse.move(box.x + 2, rowY); await page.mouse.down();
	await page.mouse.move(box.x + 42, rowY, {steps:5}); await page.mouse.up();
	// 마우스를 놓은 직후엔 마지막 pointermove 렌더가 아직일 수 있어 기다린다(바로 읽으면 가끔 32px만 반영돼 보였다)
	await page.waitForFunction(w => Math.abs(document.querySelector('.kv th').offsetWidth - w) <= 2, {timeout: 2000}, before + 40)
		.catch(async () => assert.fail(`Key 열 너비: ${before} → ${await keyWidth()}`));
	const resized = await keyWidth();
	await page.evaluate(() => window.tab('Event', '.pane').click());
	assert.equal(await keyWidth(), resized, 'Event 탭에도 너비 유지');
	// Event 값 옆 script 버튼: 핸들러 이름을 속성에 채우고 Script 탭으로 넘어간다
	await page.evaluate(() => { window.sent.length = 0; });
	await page.click('.kv .script-btn');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'ev:onclick' && m.value === 'scwin.ipt_name_onclick'));
	console.log('Event: script 버튼 → 핸들러 연결 passed');
	console.log('Property: Key 열 너비 조절 passed');
	for (const tab of ['Script', 'Source']) {
		await page.evaluate(tab => window.tab(tab).click(), tab);
		await page.waitForSelector('.tab-body:not([hidden]) .cm-content');
		// 숨은 탭은 레이아웃에서 빠져야 한다 (포맷 단축키는 보이는 편집기만 처리)
		assert.ok(await page.evaluate(() => [...document.querySelectorAll('.tab-body[hidden]')].every(e => !e.getClientRects().length)));
		await reset('set(value);\nset(value);\nset(value);');
		const point = await page.evaluate(() => { const p = window.editor().coordsAtPos(1); return {x:p.left + 2, y:(p.top+p.bottom)/2}; });
		await page.mouse.click(point.x, point.y, {count:2});
		await page.waitForFunction(() => window.editor().state.sliceDoc(window.editor().state.selection.main.from, window.editor().state.selection.main.to) === 'set');
		await page.waitForSelector('.tab-body:not([hidden]) .cm-selectionBackground');
		const alpha = await page.$eval('.tab-body:not([hidden]) .cm-activeLine', e => getComputedStyle(e).backgroundColor);
		assert.equal(alpha, 'rgba(0, 0, 0, 0)', `선택 중엔 현재 줄 배경을 걷어야(선택을 가림): ${alpha}`);
		await page.screenshot({path:path.join(tmpdir(), `ws5-${tab}-selection.png`)});
		const end = await page.evaluate(() => { const p = window.editor().coordsAtPos(27); return {x:p.left, y:(p.top+p.bottom)/2}; });
		await page.mouse.click(point.x, point.y);
		await page.mouse.move(point.x, point.y); await page.mouse.down();
		await page.mouse.move(end.x, end.y, {steps:10}); await page.mouse.up();
		assert.ok(await page.evaluate(() => window.editor().state.selection.main.to - window.editor().state.selection.main.from > 20));
		await page.screenshot({path:path.join(tmpdir(), `ws5-${tab}-multiline.png`)});
		// 확장 응답 전에 이어 친 입력은 모아서 보내므로 빠르게 쳐도 버전 충돌이 없어야 한다.
		await reset(''); await page.keyboard.type('abcdefghijklmnop', {delay:0});
		await new Promise(resolve => setTimeout(resolve, 100));
		assert.equal(await page.$('.tab-body:not([hidden]) .code-banner button'), null, `${tab}: 빠른 입력 중 충돌`);
		// 포맷 단축키(formatKey): 확장이 돌려준 포맷 결과가 일반 편집으로 들어가고 Ctrl+Z로 되돌려진다
		await reset('messy ( )');
		await page.evaluate(() => window.send({type:'formatKey'}));
		await page.waitForFunction(() => window.editor().state.doc.toString() === 'formatted();');
		await modifiedKey('Control', 'z');
		assert.equal(await content(), 'messy ( )', `${tab}: 포맷 되돌리기`);
		// 포맷해도 커서는 같은 글자 자리에 남는다(바뀐 범위 전체를 한 번에 바꾸면 그 시작으로 튄다)
		const messy = 'f(){\nvar a=1;\nvar target=2;\nvar b=3;\n}', tidy = 'f() {\n    var a = 1;\n    var target = 2;\n    var b = 3;\n}';
		await reset(messy);
		await page.evaluate(at => window.editor().dispatch({ selection: { anchor: at } }), messy.indexOf('target') + 3);
		await page.evaluate(text => { window.formatResult = text; window.send({type:'formatKey'}); }, tidy);
		await page.waitForFunction(text => window.editor().state.doc.toString() === text, {}, tidy);
		await page.evaluate(() => { delete window.formatResult; });
		assert.equal(await page.evaluate(() => window.editor().state.selection.main.head), tidy.indexOf('target') + 3, `${tab}: 포맷 뒤 커서 자리`);
		// VS Code는 웹뷰 window까지 올라온 키를 받아 문서도 되돌린다 → 편집기 밖으로 새면 안 된다
		assert.equal(await page.evaluate(() => window.leakedUndo), 0, `${tab}: Ctrl+Z가 VS Code로 전달됨`);
		await reset('');
		await page.keyboard.press('Tab');
		assert.match(await content(), /^ +$/, `${tab}: Tab 들여쓰기`);
		await modifiedKey('Shift', 'Tab');
		assert.equal(await content(), '');
		await reset('one\ntwo');
		await modifiedKey('Control', 'a'); await page.keyboard.press('Tab');
		assert.match(await content(), /^ +one\n +two$/);
		await modifiedKey('Shift', 'Tab'); assert.equal(await content(), 'one\ntwo');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Escape'); await page.keyboard.press('Tab');
		assert.equal(await page.evaluate(() => window.editor().hasFocus), false, 'Esc → Tab 포커스 탈출');
		await reset('');
		await page.keyboard.type(tab === 'Script' ? 'conso' : '<w2:in', {delay:50});
		await page.waitForFunction(text => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === text), {}, tab === 'Script' ? 'console' : 'w2:input');
		const fonts = await page.evaluate(() => {
			const style = e => [getComputedStyle(e).fontFamily, getComputedStyle(e).fontSize];
			return [style(window.editor().scrollDOM), style(document.querySelector('.cm-completionLabel'))];
		});
		assert.deepEqual(fonts[0], fonts[1], '자동완성 글꼴은 편집기와 같아야 합니다.');
		// CodeMirror의 기본 75ms 오입력 방지 시간을 지난 뒤 확정한다.
		await new Promise(resolve => setTimeout(resolve, 100));
		await page.keyboard.press('Tab');
		assert.ok((await content()).includes(tab === 'Script' ? 'console' : 'w2:input'), await content());
		assert.equal(await page.evaluate(() => window.editor().hasFocus), true);
		if (tab === 'Script') {
			// 엔진 공통 JS(modules)의 대입문 멤버, CodeMirror 기본 목록에 없던 키워드(await)
			for (const [typed, expected] of [['cons','console'], ['console.','log'], ['$p.','getComponentById'], ['ipt_name.','setValue'], ['scwin.run = function() {};\nscwin.','run'],
				['app.','util'], ['lib.','VERSION'], ['aw','await'], ['app.util.','format']]) {
				await reset(''); await page.keyboard.type(typed, {delay:25});
				await page.waitForFunction(expected => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === expected), {}, expected);
			}
			// 공통 JS 함수: 파라미터는 detail, JSDoc은 설명 팝업
			await page.waitForFunction(() => document.querySelector('.cm-completionDetail')?.textContent === '(value, pattern)' && document.querySelector('.cm-completionInfo')?.textContent.includes('값 형식 변환'));
			// await는 return과 같은 제어 키워드 색 (기본 글자색이면 구분이 안 된다)
			await reset('async function f() { await g(); return 1; }');
			const colors = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.tab-body:not([hidden]) .cm-line span')].map(e => [e.textContent, getComputedStyle(e).color])));
			assert.equal(colors.await, colors.return, JSON.stringify(colors));
		} else {
			await reset('<w2:input '); await page.keyboard.type('lab', {delay:50});
			await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'label'));
		}
		// 문법 오류 밑줄(입력을 멈추고 잠시 뒤 검사). Source는 XML 형식 오류와 인라인 script CDATA의 JS 오류
		const lintCases = tab === 'Script'
			? [['var a = ;', 8, /Unexpected token/], ['var a = 1;']]
			: [['<a><b></a>', undefined, /close tag/i], ['<a><script><![CDATA[var x = ;]]></script></a>', 28, /Unexpected token/], ['<a/>']];
		for (const [text, at, message] of lintCases) {
			await reset(text);
			if (message) {
				await page.waitForFunction(() => window.diagnostics().length && document.querySelector('.tab-body:not([hidden]) .cm-lintRange-error'), {timeout: 3000})
					.catch(() => assert.fail(`${tab}: ${text} 밑줄 없음`));
				const [d] = await page.evaluate(() => window.diagnostics());
				assert.match(d.message, message, `${tab}: ${text}`);
				if (at !== undefined) { assert.equal(d.from, at, `${tab}: ${text} 위치`); }
				assert.ok(await page.$('.tab-body:not([hidden]) .cm-lint-marker-error'), `${tab}: 줄 번호 옆 오류 표시`);
			} else {
				await new Promise(resolve => setTimeout(resolve, 900));
				assert.deepEqual(await page.evaluate(() => window.diagnostics()), [], `${tab}: ${text}는 오류 아님`);
			}
		}
		// 들여쓰기 가이드: 들여쓴 줄에 선(클래스로 등록한 --indent-markers)이 그려진다
		await reset(tab === 'Script' ? 'if (a) {\n    b();\n}' : '<a>\n    <b/>\n</a>');
		await page.waitForFunction(() => {
			const line = document.querySelectorAll('.tab-body:not([hidden]) .cm-line')[1];
			return line?.classList.contains('cm-indent-markers') && getComputedStyle(line).getPropertyValue('--indent-markers').includes('linear-gradient')
				&& getComputedStyle(line, '::before').backgroundImage.includes('gradient');
		}, {timeout: 3000}).catch(() => assert.fail(`${tab}: 들여쓰기 가이드 없음`));
		await checkIndentUnit(tab);
		console.log(`${tab}: lint, indent guides passed`);
		await page.evaluate(() => document.body.className = 'vscode-light');
		await reset('set'); await modifiedKey('Control', 'a');
		await page.waitForSelector('.tab-body:not([hidden]) .cm-selectionBackground');
		await page.evaluate(() => document.body.className = 'vscode-dark');
		console.log(`${tab}: selection, Tab/Shift+Tab, completion, theme switch passed`);
	}

	// 연결 탭(Controller·Service·Mapper·Mybatis): 경로 입력 → 편집기, 파일별 저장·Undo, 우클릭 메뉴, 탭 끌어 순서 바꾸기
	const tabNames = () => page.$$eval('.canvas-frame .tab-bar button[role="tab"]', bs => bs.map(b => b.textContent));
	// 탭을 끌어 놓은 직후 잠깐은 dnd-kit이 클릭을 막는다 → 선택될 때까지 다시 누른다
	const clickTab = name => page.waitForFunction(name => {
		const button = window.tab(name);
		if (button.getAttribute('aria-selected') !== 'true') { button.click(); }
		return button.getAttribute('aria-selected') === 'true';
	}, { polling: 50, timeout: 5000 }, name);
	const tabButton = name => page.evaluateHandle(name => window.tab(name), name);
	const lastSent = type => page.evaluate(type => window.sent.findLast(m => m.type === type), type);
	assert.deepEqual(await tabNames(), ['Design', 'Script', 'Source', 'Controller', 'Service', 'Mapper', 'Mybatis']);
	await page.evaluate(() => ['controller', 'service', 'mapper', 'mybatis'].forEach(kind => window.send({ type: 'linked', kind })));
	await clickTab('Controller');
	await page.waitForSelector('.tab-body:not([hidden]) .link-picker input');
	assert.equal(await page.$eval('.tab-body:not([hidden]) .link-picker button[type="submit"]', b => b.disabled), true, '빈 경로는 연결 버튼 비활성');
	await page.type('.tab-body:not([hidden]) .link-picker input', '"src/A.java"');
	await page.keyboard.press('Enter');
	assert.deepEqual(await lastSent('link'), { type: 'link', kind: 'controller', path: '"src/A.java"' });
	await page.evaluate(() => [...document.querySelectorAll('.tab-body:not([hidden]) .link-picker button')].find(b => b.textContent === '찾아보기…').click());
	assert.deepEqual(await lastSent('link'), { type: 'link', kind: 'controller' }, '찾아보기는 경로 없이 (파일 선택 창)');
	const javaText = 'public class A {\n    private MemberService memberService;\n    void list() { memberService.find(1); }\n}\n';
	await page.evaluate(text => window.send({ type: 'linked', kind: 'controller', path: 'src/A.java', text, version: 5 }), javaText);
	await page.waitForFunction(text => window.editor()?.state.doc.toString() === text, {}, javaText);
	assert.equal(await page.evaluate(b => b.title, await tabButton('Controller')), 'src/A.java', '탭 툴팁은 연결 경로');
	await page.evaluate(() => { window.sent.length = 0; });
	await page.evaluate(() => { const v = window.editor(); v.dispatch({ selection: { anchor: v.state.doc.length } }); v.focus(); });
	await page.keyboard.type('// x');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'setCode' && m.target === 'link:controller' && m.version === 5));
	// Ctrl+S는 이 파일만 저장(VS Code로 넘기면 화면 XML이 저장된다), Ctrl+Z는 이 편집기만 되돌린다
	await modifiedKey('Control', 's');
	assert.deepEqual(await lastSent('saveLink'), { type: 'saveLink', kind: 'controller' });
	assert.equal(await page.evaluate(() => window.leakedSave), 0, 'Ctrl+S가 VS Code로 전달됨');
	await modifiedKey('Control', 'z');
	await page.waitForFunction(text => window.editor().state.doc.toString() === text, {}, javaText);
	assert.equal(await page.evaluate(() => window.leakedUndo), 0, '연결 탭 Ctrl+Z가 VS Code로 전달됨');
	// Java 자동완성: 키워드, 이 파일의 필드·타입, 점 뒤에는 이 파일에서 호출한 메서드
	for (const [typed, expected] of [['pub', 'public'], ['memberS', 'memberService'], ['Memb', 'MemberService'], ['memberService.', 'find']]) {
		await reset(javaText + typed);
		await page.keyboard.press('Backspace'); await page.keyboard.type(typed.slice(-1), {delay:25});
		await page.waitForFunction(expected => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === expected), {timeout: 3000}, expected)
			.catch(() => assert.fail(`Java 자동완성: ${typed} → ${expected}`));
	}
	await reset(javaText + '// pub');
	await page.keyboard.press('Backspace'); await page.keyboard.type('b');
	await new Promise(resolve => setTimeout(resolve, 300));
	assert.equal(await page.$('.cm-tooltip-autocomplete'), null, '주석 안에서는 자동완성 없음');
	await checkIndentUnit('Controller');
	// VS Code 언어 확장(Java 언어 서버) 자동완성: 편집이 반영된 버전·커서 위치로 묻고, 고르면 자동 import 같은 추가 편집도 넣는다
	assert.deepEqual(await page.evaluate(() => [window.toSnippet('forEach(${1:action})$0'), window.toSnippet('${1|a,b|} \\$x #{y} $2')]),
		['forEach(${1:action})${0}', '${1:a} $x #\\{y} ${2}'], 'VS Code 스니펫 → CodeMirror 스니펫');
	await page.evaluate(() => {
		window.remoteItems = msg => ({ from: { line: msg.line, ch: msg.ch - 3 }, items: [
			{ label: 'BigDecimal', display: 'BigDecimal', detail: 'java.math', type: 'class', insert: 'BigDecimal', sort: 'a',
				edits: [{ fromLine: 0, fromCh: 0, toLine: 0, toCh: 0, insert: 'import java.math.BigDecimal;\n' }] },
			{ label: 'BigInteger', display: 'BigInteger', detail: 'java.math', type: 'class', insert: 'BigInteger', sort: 'b' },
		] });
	});
	await reset(javaText); await page.evaluate(() => { window.sent.length = 0; });
	await page.keyboard.type('Big', {delay: 25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].map(e => e.textContent).join() === 'BigDecimal,BigInteger', {timeout: 3000})
		.catch(async () => assert.fail(`언어 서버 자동완성 목록: ${await page.evaluate(() => [...document.querySelectorAll('.cm-completionLabel')].map(e => e.textContent))}`));
	assert.equal(await page.$eval('.cm-completionDetail', e => e.textContent), 'java.math');
	const asked = await lastSent('complete');
	assert.deepEqual({ target: asked.target, line: asked.line, ch: asked.ch }, { target: 'link:controller', line: 4, ch: 3 }, '연결 탭·커서 위치로 물음');
	assert.equal(asked.version, (await lastSent('setCode')).version + 1, '입력한 편집이 반영된 버전으로 물음');
	await new Promise(resolve => setTimeout(resolve, 100));
	await page.keyboard.press('Enter');
	assert.equal(await content(), 'import java.math.BigDecimal;\n' + javaText + 'BigDecimal', '고른 항목 + 자동 import');
	// 목록은 풀지 않고 바로, 자동 import는 항목을 푼 결과(늦게 옴): 먼저 고르면 넣고, 오면 그때 import
	await page.evaluate(() => {
		window.remoteItems = msg => ({ from: { line: msg.line, ch: msg.ch - 3 }, items: [{ label: 'BigDecimal', type: 'class', insert: 'BigDecimal', sort: 'a' }] });
		window.remoteDetails = () => [{ label: 'BigDecimal', info: 'Immutable decimal', edits: [{ fromLine: 0, fromCh: 0, toLine: 0, toCh: 0, insert: 'import java.math.BigDecimal;\n' }] }];
	});
	await reset(javaText); await page.keyboard.type('Big', {delay: 25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'BigDecimal'), {timeout: 3000});
	await new Promise(resolve => setTimeout(resolve, 100));
	await page.keyboard.press('Enter');
	assert.equal(await content(), javaText + 'BigDecimal', '고르면 바로 넣음(푼 결과 전)');
	await page.waitForFunction(text => window.editor().state.doc.toString() === text, {timeout: 3000}, 'import java.math.BigDecimal;\n' + javaText + 'BigDecimal').catch(() => assert.fail('늦게 온 자동 import'));
	await page.evaluate(() => { window.remoteDetails = undefined; });
	// 설명은 마크다운으로(언어 서버 MarkdownString): 굵게·인라인 코드·코드 블록·목록·이스케이프, HTML은 글자로
	await page.evaluate(() => {
		const fence = '`'.repeat(3);
		const info = ['Returns a stream of `int`.', '**Specified by:** chars() in <b>CharSequence</b>', '', '* **Returns:**', '* an IntStream', '', fence + 'java', 'int x = 1;', fence, 'surrogate \\* point'].join('\n');
		window.remoteItems = () => ({ items: [{ label: 'chars', type: 'method', insert: 'chars()', info }] });
	});
	await reset('s.'); await page.keyboard.type('cha', {delay: 25});
	await page.waitForSelector('.cm-completionInfo .md', {timeout: 3000}).catch(() => assert.fail('설명 마크다운'));
	assert.deepEqual(await page.$eval('.cm-completionInfo .md', md => ({
		code: [...md.querySelectorAll('p > code')].map(c => c.textContent), strong: [...md.querySelectorAll('strong')].map(b => b.textContent),
		items: [...md.querySelectorAll('li')].map(l => l.textContent), pre: md.querySelector('pre code')?.textContent, html: !!md.querySelector('b'), escaped: md.textContent.includes('surrogate * point'),
	})), { code: ['int'], strong: ['Specified by:', 'Returns:'], items: ['Returns:', 'an IntStream'], pre: 'int x = 1;', html: false, escaped: true });
	await page.keyboard.press('Escape');
	await page.evaluate(() => { window.remoteItems = () => ({ items: [{ label: 'forEach', type: 'method', insert: 'forEach(${1:action})$0', snippet: true }] }); });
	await reset('list.'); await page.keyboard.type('forE', {delay: 25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'forEach'), {timeout: 3000});
	await new Promise(resolve => setTimeout(resolve, 100));
	await page.keyboard.press('Enter');
	assert.equal(await content(), 'list.forEach(action)');
	assert.equal(await page.evaluate(() => { const v = window.editor(), r = v.state.selection.main; return v.state.sliceDoc(r.from, r.to); }), 'action', '스니펫 첫 자리 선택');
	await reset('memberService'); await page.evaluate(() => { window.sent.length = 0; });
	await page.keyboard.type('.', {delay: 25});
	await page.waitForFunction(() => window.sent.some(m => m.type === 'complete'));
	assert.equal((await lastSent('complete')).trigger, '.', '점 뒤는 trigger character로');
	await page.keyboard.press('Escape');
	// 자리 없는 스니펫(Java getHour()): '.' 바로 뒤에서 Enter로 골라도 커서는 넣은 글자 끝으로
	await page.evaluate(() => { window.remoteItems = () => ({ items: [{ label: 'getHour', type: 'method', insert: 'getHour()', snippet: true }] }); });
	await reset('entry'); await page.keyboard.type('.', {delay: 25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'getHour'), {timeout: 3000});
	await new Promise(resolve => setTimeout(resolve, 100));
	await page.keyboard.press('Enter');
	assert.equal(await content(), 'entry.getHour()');
	assert.equal(await page.evaluate(() => window.editor().state.selection.main.head), 'entry.getHour()'.length, '커서는 넣은 글자 끝');
	await page.evaluate(() => { window.remoteItems = undefined; });
	console.log('Link: VS Code 언어 확장 자동완성(위치·자동 import·스니펫·점) passed');
	// 자동완성 아이콘: IntelliJ처럼 종류별 글자(C I E T N · m f p v c · ƒ k S), 타입류는 원·멤버류는 둥근 사각, 종류마다 다른 색
	const kinds = ['class', 'interface', 'enum', 'type', 'namespace', 'method', 'field', 'property', 'variable', 'constant', 'function', 'keyword', 'snippet'];
	await page.evaluate(kinds => { window.remoteItems = () => ({ items: kinds.map((type, i) => ({ label: 'icon' + type, type, insert: 'icon' + type, sort: String(i).padStart(2, '0') })).concat([{ label: 'iconNone', insert: 'iconNone', sort: '99' }]) }); }, kinds);
	await reset('icon'); await page.keyboard.type('.', {delay: 25}); await page.keyboard.type('ic', {delay: 25});
	await page.waitForFunction(n => document.querySelectorAll('.cm-tooltip-autocomplete li').length === n, {timeout: 4000}, kinds.length + 1);
	const icons = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.cm-tooltip-autocomplete li')].map(li => {
		const icon = li.querySelector('.cm-completionIcon'), style = getComputedStyle(icon);
		return [li.querySelector('.cm-completionLabel').textContent, { letter: getComputedStyle(icon, '::after').content.replace(/"/g, ''), round: style.borderTopLeftRadius === '50%' || parseFloat(style.borderTopLeftRadius) >= 9, color: style.color }];
	})));
	assert.deepEqual(Object.fromEntries(kinds.map(k => [k, icons['icon' + k]?.letter])), { class: 'C', interface: 'I', enum: 'E', type: 'T', namespace: 'N', method: 'm', field: 'f', property: 'p', variable: 'v', constant: 'c', function: 'ƒ', keyword: 'k', snippet: 'S' }, '종류별 아이콘 글자');
	assert.deepEqual(['class', 'interface', 'enum', 'type', 'namespace'].filter(k => !icons['icon' + k].round), [], '타입류는 원');
	assert.deepEqual(['method', 'field', 'property', 'variable', 'constant', 'function'].filter(k => icons['icon' + k].round), [], '멤버류는 둥근 사각');
	assert.notEqual(icons.iconclass.color, icons.iconmethod.color, '종류마다 색이 다름(VS Code 심볼 아이콘 색)');
	assert.equal(icons.iconNone.letter, 'none', '종류 없으면 글자 없음');
	await page.keyboard.press('Escape');
	await page.evaluate(() => { window.remoteItems = undefined; });
	console.log('Link: 자동완성 아이콘(종류별 글자·모양·색) passed');
	// 키 입력: Tab은 커서 자리에 다음 4칸 자리까지(줄 전체가 아니라), Java Enter는 윗줄 기준(+ { 뒤 한 단계, } 앞 한 단계 덜), XML 태그 자동 닫기
	const typed = async (doc, pos, keys) => {
		await page.evaluate((d, p) => { const v = window.editor(); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: d }, selection: { anchor: p } }); v.focus(); }, doc, pos);
		// 앞 입력의 자동완성 결과(모의 언어 서버 5ms)가 늦게 와서 창이 뜨면 Tab이 그 항목을 받는다 → 늦은 응답까지 기다린 뒤 확인
		await new Promise(resolve => setTimeout(resolve, 50));
		await page.waitForFunction(() => !document.querySelector('.cm-tooltip-autocomplete'));
		for (const k of keys) {
			if (k.length > 1) { await page.keyboard.press(k); } else { await page.keyboard.type(k); }
		}
		await page.keyboard.press('Escape');
		return content();
	};
	const block = 'class A {\n    void f() {\n        query.put("rowStatus", "U");\n    }\n}\n';
	assert.equal(await typed(block, block.indexOf('"U");') + 5, ['Enter', 'x']), block.replace('"U");', '"U");\n        x'), 'Java: 문장 뒤 Enter는 같은 들여쓰기');
	assert.equal(await typed(block, block.indexOf('f() {') + 5, ['Enter', 'x']), block.replace('f() {', 'f() {\n        x'), 'Java: { 뒤 Enter는 한 단계 더');
	assert.equal(await typed('void f() {}', 10, ['Enter', 'x']), 'void f() {\n    x\n}', 'Java: {} 사이 Enter');
	assert.equal(await typed('if (a) {\n    b();\n    ', 22, ['}']), 'if (a) {\n    b();\n}', 'Java: } 입력하면 한 단계 덜');
	assert.equal(await typed('ab', 1, ['Tab']), 'a   b', 'Tab: 커서 자리에 다음 4칸 자리까지');
	await clickTab('Source');
	assert.equal(await typed('<a b="1"/>', 2, ['Tab']), '<a   b="1"/>', 'XML Tab: 줄 전체가 아니라 커서 자리');
	assert.equal(await typed('', 0, ['<', 'w', '2', ':', 'i', 'n', 'p', 'u', 't', '>']), '<w2:input></w2:input>', 'Source: > 입력하면 닫는 태그');
	assert.equal(await typed('<a>', 3, ['<', '/']), '<a></a>', 'Source: </ 입력하면 닫는 태그');
	assert.equal(await typed('', 0, ['<', 'u', 'p', 'd', 'a', 't', 'e', '>', ' ', '<', '/', 'x']), '<update> </update>x', 'Source: 이미 붙은 닫는 태그는 </ 로 건너뜀');
	await clickTab('Controller');
	console.log('Keys: Tab 커서 자리·Java Enter 들여쓰기·XML 태그 자동 닫기 passed');
	console.log('Link: 경로 입력·찾아보기·편집·Ctrl+S/Ctrl+Z 파일별·Java 자동완성·들여쓰기 4칸 passed');
	// 저장 안 함 표시, 연결 상태에 따라 바뀌는 우클릭 메뉴
	const cleanWidth = await page.evaluate(() => window.tab('Controller').getBoundingClientRect().width);
	await page.evaluate(text => window.send({ type: 'linked', kind: 'controller', path: 'src/A.java', text, version: 50, dirty: true }), javaText);
	await page.waitForFunction(() => window.tab('Controller').classList.contains('dirty'));
	assert.equal(await page.evaluate(() => getComputedStyle(window.tab('Controller'), '::after').visibility), 'visible', '● 표시');
	assert.equal(await page.evaluate(() => window.tab('Controller').getBoundingClientRect().width), cleanWidth, '● 표시가 생겨도 탭 너비 그대로');
	// 탭 줄 위치: 기본 위, 맨 앞 화살표로 아래·위(확장에 저장 요청, 다른 화면이 보낸 위치도 따름)
	const barAt = () => page.evaluate(() => { const f = document.querySelector('.canvas-frame'); return f.firstElementChild.classList.contains('tab-bar') ? 'top' : f.lastElementChild.classList.contains('tab-bar') ? 'bottom' : '?'; });
	assert.equal(await barAt(), 'top', '탭 줄 기본 위');
	assert.equal(await page.$eval('.canvas-frame .tab-bar > :first-child', b => b.classList.contains('tab-palette')), true, '팔레트 버튼은 화살표 왼쪽');
	assert.equal(await page.$eval('.canvas-frame .tab-move', b => b.title), '탭을 아래로', '탭 방향 화살표 유지');
	await page.click('.canvas-frame .tab-move');
	await page.waitForFunction(() => document.querySelector('.canvas-frame').lastElementChild.classList.contains('tab-bar'));
	assert.equal((await lastSent('setTabPosition')).position, 'bottom', '위치 저장 요청');
	await page.evaluate(() => window.send({ type: 'tabPosition', position: 'top' }));
	await page.waitForFunction(() => document.querySelector('.canvas-frame').firstElementChild.classList.contains('tab-bar'));
	await page.click('.canvas-frame .tab-move');
	await page.waitForFunction(() => document.querySelector('.canvas-frame').lastElementChild.classList.contains('tab-bar'));
	assert.equal(await page.$eval('.canvas-frame .tab-move', b => b.title), '탭을 위로');
	console.log('Tabs: 탭 줄 위·아래 전환(기본 위) passed');
	const menuOf = async name => {
		const box = await (await tabButton(name)).boundingBox();
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
		await page.waitForSelector('.context-menu');
		return page.$$eval('.context-menu button', bs => bs.map(b => `${b.textContent}${b.disabled ? ' (비활성)' : ''}`));
	};
	assert.deepEqual(await menuOf('Controller'), ['VS Code에서 열기', '다른 파일로 변경…', '연결 해제', '탭 이름 변경…', '탭 삭제…']);
	// 아래쪽 탭에서 연 메뉴: 실제 크기로 재서 위로 뒤집혀 화면 안에, 자리를 잡은 뒤 첫 항목에 포커스
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.context-menu')).visibility === 'visible');
	const menuBox = await page.evaluate(() => {
		const r = document.querySelector('.context-menu').getBoundingClientRect();
		return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, focused: document.activeElement?.textContent };
	});
	const controllerBox = await (await tabButton('Controller')).boundingBox();
	assert.ok(menuBox.top >= 0 && menuBox.bottom <= await page.evaluate(() => innerHeight) && menuBox.left >= 0 && menuBox.right <= await page.evaluate(() => innerWidth), `메뉴가 화면 안: ${JSON.stringify(menuBox)}`);
	assert.ok(menuBox.bottom <= controllerBox.y + controllerBox.height / 2 + 1, '아래 공간이 없으면 누른 자리 위로');
	assert.equal(menuBox.focused, 'VS Code에서 열기');
	await page.evaluate(() => [...document.querySelectorAll('.context-menu button')].find(b => b.textContent === '연결 해제').click());
	assert.deepEqual(await lastSent('unlink'), { type: 'unlink', kind: 'controller' });
	assert.equal(await page.$('.context-menu'), null, '메뉴 닫힘');
	assert.deepEqual(await menuOf('Service'), ['VS Code에서 열기', '파일 연결…', '연결 해제 (비활성)', '탭 이름 변경…', '탭 삭제…']);
	await page.evaluate(() => [...document.querySelectorAll('.context-menu button')].find(b => b.textContent === 'VS Code에서 열기').click());
	assert.deepEqual(await lastSent('openLink'), { type: 'openLink', kind: 'service' }, '연결 전에도 요청(확장이 알림)');
	await page.keyboard.press('Escape');
	const designBox = await (await tabButton('Design')).boundingBox();
	await page.mouse.click(designBox.x + 5, designBox.y + 5, { button: 'right' });
	assert.equal(await page.$('.context-menu'), null, 'Design 탭에는 메뉴 없음');
	// 파일이 사라짐: 경로 입력으로 돌아가고 경고
	await page.evaluate(() => window.send({ type: 'linked', kind: 'controller', path: 'src/A.java' }));
	await page.waitForFunction(() => document.querySelector('.tab-body:not([hidden]) .link-picker .warning')?.textContent.includes('src/A.java'));
	console.log('Link: 저장 안 함 표시·우클릭 메뉴·파일 없음 passed');
	// 경로 입력칸 파일 검색: 들어가면 목록을 받고, 입력하면 파일 이름·경로로 퍼지 검색, ↓·Enter나 클릭으로 연결
	await page.evaluate(() => { window.mockFiles = ['src/main/java/a/MemberService.java', 'src/main/java/a/OrderService.java', 'src/test/java/a/MemberServiceTest.java']; window.sent.length = 0; });
	await clickTab('Service');
	await page.click('.tab-body:not([hidden]) .link-picker input');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'findFiles' && m.kind === 'service'));
	await page.keyboard.type('memsvc', {delay: 20});
	await page.waitForFunction(() => document.querySelectorAll('.tab-body:not([hidden]) .file-suggest li').length === 2, {timeout: 3000})
		.catch(async () => assert.fail(`검색 결과: ${await page.$$eval('.file-suggest li', ls => ls.map(l => l.title))}`));
	assert.deepEqual(await page.$$eval('.tab-body:not([hidden]) .file-suggest li', ls => ls.map(l => l.title)), ['src/main/java/a/MemberService.java', 'src/test/java/a/MemberServiceTest.java']);
	await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
	assert.deepEqual(await lastSent('link'), { type: 'link', kind: 'service', path: 'src/test/java/a/MemberServiceTest.java' }, '↓·Enter로 고름');
	await page.evaluate(() => { const i = document.querySelector('.tab-body:not([hidden]) .link-picker input'); i.focus(); });
	await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
	await page.keyboard.type('order', {delay: 20});
	await page.waitForSelector('.tab-body:not([hidden]) .file-suggest li');
	await page.click('.tab-body:not([hidden]) .file-suggest li');
	assert.deepEqual(await lastSent('link'), { type: 'link', kind: 'service', path: 'src/main/java/a/OrderService.java' }, '클릭으로 고름');
	// 연결 못 한 이유는 알림을 꺼 둬도 보이게 경로 입력 화면에, 다시 입력하면 지움
	await page.evaluate(() => window.send({ type: 'linkProblem', kind: 'service', message: '이미 Controller 탭에 연결된 파일입니다.' }));
	await page.waitForFunction(() => document.querySelector('.tab-body:not([hidden]) .link-picker .warning')?.textContent === '이미 Controller 탭에 연결된 파일입니다.');
	await page.keyboard.type('x');
	await page.waitForFunction(() => !document.querySelector('.tab-body:not([hidden]) .link-picker .warning'));
	await page.keyboard.press('Escape');
	console.log('Link: 경로 입력 파일 검색(퍼지·키보드·클릭) passed');
	// MyBatis: 매퍼 태그·속성 자동완성, XML 문법 오류 밑줄
	await page.evaluate(() => window.send({ type: 'linked', kind: 'mybatis', path: 'res/a.xml', text: '<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "mybatis-3-mapper.dtd">\n<mapper namespace="a">\n</mapper>', version: 3 }));
	await clickTab('Mybatis');
	await page.waitForFunction(() => window.editor()?.state.doc.toString().includes('<mapper'));
	await page.evaluate(() => { const v = window.editor(); const at = v.state.doc.toString().indexOf('</mapper>'); v.dispatch({ selection: { anchor: at } }); v.focus(); });
	await page.keyboard.type('<sel', {delay:25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'select'), {timeout: 3000}).catch(() => assert.fail('MyBatis 태그 자동완성'));
	await page.keyboard.press('Escape');
	await reset('<mapper><select id="a" ');
	await page.keyboard.type('resultT', {delay:25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'resultType'), {timeout: 3000}).catch(() => assert.fail('MyBatis 속성 자동완성'));
	await reset('<mapper><select></mapper>');
	await page.waitForFunction(() => window.diagnostics().length, {timeout: 3000}).catch(() => assert.fail('MyBatis 문법 오류 밑줄'));
	assert.ok(await page.evaluate(() => window.sent.some(m => m.type === 'setCode' && m.target === 'link:mybatis')), 'MyBatis 편집 전송');
	await checkIndentUnit('Mybatis');
	await reset('<mapper>\n</mapper>'); await page.evaluate(() => window.editor().dispatch({ selection: { anchor: 8 } }));
	await page.keyboard.press('Enter'); await page.keyboard.type('<select id="a">');
	await page.keyboard.press('Escape');
	assert.match(await content(), /<select id="a"><\/select>/, 'Mybatis: 태그 자동 닫기');
	await reset(''); await page.keyboard.type('<update> </x', {delay: 20}); await page.keyboard.press('Escape');
	assert.equal(await content(), '<update> </update>x', 'Mybatis: 이미 붙은 닫는 태그는 </ 로 건너뜀');
	// 커서 뒤 닫는 태그가 안쪽 요소의 것이 아니면(바깥 요소의 것) 건너뛰지 않고 안쪽 요소를 닫는다
	await reset('<if><where>a</if>'); await page.evaluate(() => window.editor().dispatch({ selection: { anchor: 12 } }));
	await page.keyboard.type('</', {delay: 20}); await page.keyboard.press('Escape');
	assert.equal(await content(), '<if><where>a</where></if>', 'Mybatis: 바깥 요소의 닫는 태그는 건너뛰지 않음');
	// 탭 문자·2칸으로 들여쓴 파일도 들여쓰기 단위는 공백 4칸
	await page.evaluate(() => window.send({ type: 'linked', kind: 'mapper', path: 'src/M.java', text: 'interface M {\n\tvoid a();\n}\n', version: 2 }));
	await clickTab('Mapper');
	await page.waitForFunction(() => window.editor()?.state.doc.toString().startsWith('interface M'));
	await reset('');
	await page.keyboard.press('Tab');
	assert.equal(await content(), '    ', 'Mapper(탭 파일): Tab도 공백 4칸');
	await clickTab('Script');
	const twoSpace = 'scwin.f = function() {\n  if (a) {\n    b();\n  }\n};';
	await page.evaluate(text => window.send({ ...window.initialDocument, version: 100000, script: { text } }), twoSpace);
	await page.waitForFunction(text => window.editor().state.doc.toString().startsWith(text), {}, twoSpace);
	assert.equal(await page.evaluate(() => window.editor().state.facet(window.indentUnit)), '    ', '2칸 Script도 4칸');
	console.log('Link: MyBatis 자동완성·문법 오류·들여쓰기 4칸 passed');
	// HTML·CSS·JS도 연결: 확장자로 언어를 고른다(HTML 태그 자동 닫기, CSS 속성 자동완성, JS는 ES 모듈도 문법 오류 아님)
	const linkAs = async (path, text, version) => {
		await page.evaluate((path, text, version) => window.send({ type: 'linked', kind: 'service', path, text, version }), path, text, version);
		await clickTab('Service');
		await page.waitForFunction(text => window.editor()?.state.doc.toString() === text, {}, text);
	};
	await linkAs('web/a.html', '<!-- h -->', 500);
	await reset(''); await page.keyboard.type('<div>', {delay: 20}); await page.keyboard.press('Escape');
	assert.equal(await content(), '<div></div>', 'HTML: 태그 자동 닫기');
	await reset(''); await page.keyboard.type('<div> </x', {delay: 20}); await page.keyboard.press('Escape');
	assert.equal(await content(), '<div> </div>x', 'HTML: 이미 붙은 닫는 태그는 </ 로 건너뜀');
	await linkAs('web/a.css', '/* c */', 501);
	await reset('a { '); await page.keyboard.type('backgr', {delay: 25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'background'), {timeout: 6000}).catch(() => assert.fail('CSS 속성 자동완성'));
	await page.keyboard.press('Escape');
	// 연결 탭 문법 검사 = VS Code가 그 파일에 낸 문제(JS 내장 검사·Java 언어 서버 등). 편집기 버전과 같은 결과를 그 줄·글자에
	await linkAs('web/a.js', 'const = 1;\nok();', 502);
	await new Promise(resolve => setTimeout(resolve, 700));
	assert.deepEqual(await page.evaluate(() => window.diagnostics()), [], 'JS: 편집기가 직접 검사하지 않음(VS Code 결과만)');
	await page.evaluate(() => window.send({ type: 'diagnostics', target: 'link:service', version: 502, items: [{ fromLine: 0, fromCh: 6, toLine: 0, toCh: 7, severity: 'error', message: "Variable declaration expected.", source: 'ts' }] }));
	await page.waitForFunction(() => window.diagnostics().length === 1, { timeout: 3000 }).catch(() => assert.fail('VS Code 문제 밑줄'));
	assert.deepEqual(await page.evaluate(() => window.diagnostics()), [{ from: 6, message: 'Variable declaration expected.' }]);
	// 확장은 연결 내용 바로 뒤에 문제를 보낸다: 새 파일 편집기가 뜨기 전에 온 문제도 표시
	await page.evaluate(() => {
		window.send({ type: 'linked', kind: 'service', path: 'src/B.java', text: 'class B {\n    void f() {\n        if( ) {}\n    }\n}\n', version: 503 });
		window.send({ type: 'diagnostics', target: 'link:service', version: 503, items: [{ fromLine: 2, fromCh: 11, toLine: 2, toCh: 12, severity: 'error', message: 'Syntax error on token "(", Expression expected after this token', source: 'Java' }, { fromLine: 99, fromCh: 0, toLine: 99, toCh: 3, severity: 'warning', message: '끝 밖', source: 'Java' }] });
	});
	await page.waitForFunction(() => window.diagnostics().length === 2, { timeout: 3000 }).catch(() => assert.fail('Java 언어 서버 문제 밑줄'));
	const javaProblems = await page.evaluate(() => window.diagnostics());
	assert.equal(javaProblems[0].from, 'class B {\n    void f() {\n        if( ) {}'.indexOf('( )') + 1, 'Java: 줄·글자 위치');
	assert.equal(javaProblems[1].from, await page.evaluate(() => window.editor().state.doc.length), '문서 밖 위치는 끝으로');
	assert.ok(await page.$('.tab-body:not([hidden]) .cm-lint-marker-error'), 'Java: 줄 번호 옆 표시');
	await page.evaluate(() => window.send({ type: 'diagnostics', target: 'link:service', version: 503, items: [] }));
	await page.waitForFunction(() => window.diagnostics().length === 0, { timeout: 3000 }).catch(() => assert.fail('고치면(문제 없음) 밑줄 사라짐'));
	console.log('Link: HTML·CSS·JS·Java 파일 언어(자동 닫기·자동완성), 문법 검사는 VS Code 문제 그대로 passed');
	// 문서 주석: /** 뒤 Enter → 아래 함수의 @param·@return 틀(커서는 설명 줄), 주석 안 Enter → * 이어짐, 주석 안 . 은 자동완성 없음
	const javaMethod = '\n    @RequestMapping("/a")\n    public Map<String, Object> list(HttpServletRequest request, @RequestParam Map<String, Object> param) {\n    }';
	await linkAs('src/C.java', 'class C {' + javaMethod + '\n}', 510);
	await page.evaluate(() => { const v = window.editor(); v.dispatch({ changes: { from: 9, insert: '\n    /**' }, selection: { anchor: 17 } }); v.focus(); });
	await page.keyboard.press('Enter');
	assert.equal(await content(), 'class C {\n    /**\n     * \n     * @param request\n     * @param param\n     * @return\n     */' + javaMethod + '\n}', 'Java: /** Enter 틀');
	assert.equal(await page.evaluate(() => window.editor().state.selection.main.head), 'class C {\n    /**\n     * '.length, 'Java: 커서는 설명 줄');
	await page.keyboard.type('목록');
	await page.keyboard.press('Enter');
	assert.ok((await content()).startsWith('class C {\n    /**\n     * 목록\n     * \n     * @param request'), 'Java: 주석 안 Enter → * 이어짐');
	await page.keyboard.type('a.', {delay: 30});
	await new Promise(resolve => setTimeout(resolve, 400));
	assert.equal(await page.$('.cm-tooltip-autocomplete'), null, 'Java: 주석 안 . 자동완성 없음');
	await linkAs('web/b.js', '\nfunction save(form, { id }, ...rest) {\n}', 511);
	await page.evaluate(() => { const v = window.editor(); v.dispatch({ changes: { from: 0, insert: '/**' }, selection: { anchor: 3 } }); v.focus(); });
	await page.keyboard.press('Enter');
	assert.equal(await content(), '/**\n * \n * @param form\n * @param rest\n */\nfunction save(form, { id }, ...rest) {\n}', 'JS: /** Enter 틀');
	await clickTab('Script');
	await reset('scwin.f = function(e) {\n};');
	await page.evaluate(() => window.editor().dispatch({ changes: { from: 0, insert: '/**\n' }, selection: { anchor: 3 } }));
	await page.keyboard.press('Enter');
	assert.ok((await content()).startsWith('/**\n * \n * @param e\n */\n'), `Script: /** Enter 틀: ${JSON.stringify(await content())}`);
	console.log('Link·Script: 문서 주석 틀·* 이어짐·주석 안 자동완성 없음 passed');
	// DTD 스키마가 오면 XML 자동완성을 그 스키마로(없으면 기본 MyBatis 목록), 그 밖의 확장자는 일반 텍스트
	await linkAs('res/s.xml', '<!DOCTYPE sqlMap SYSTEM "sql-map-2.dtd">\n<sqlMap>\n</sqlMap>', 520);
	await page.evaluate(() => window.send({ type: 'xmlSchema', kind: 'service', elements: [{ name: 'sqlMap', top: true, children: ['statement'], attributes: [] }, { name: 'statement', children: [], attributes: [{ name: 'resultClass' }] }] }));
	await page.evaluate(() => { const v = window.editor(); const at = v.state.doc.toString().indexOf('</sqlMap>'); v.dispatch({ selection: { anchor: at } }); v.focus(); });
	await page.keyboard.type('<stat', {delay: 25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'statement'), {timeout: 6000}).catch(() => assert.fail('DTD 스키마 태그 자동완성'));
	assert.ok(!await page.evaluate(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'select')), 'DTD가 있으면 MyBatis 기본 목록 안 씀');
	await page.keyboard.press('Escape');
	await linkAs('web/a.jsp', '<%@ page %>', 521);
	await reset(''); await page.keyboard.type('<div>', {delay: 20}); await page.keyboard.press('Escape');
	assert.equal(await content(), '<div>', '그 밖의 확장자: 일반 텍스트(태그 자동 닫기 없음)');
	console.log('Link: DTD 스키마 자동완성·그 밖의 확장자 일반 텍스트 passed');
	// SQL: 매퍼 XML 안 SQL(글자·CDATA)과 .sql 파일에 색과 키워드 자동완성, 방언 설정에 맞춰 바뀜
	await page.evaluate(() => window.send({ type: 'xmlSchema', kind: 'service' }));
	const mapper = '<mapper namespace="a">\n<select id="s">\nselect id from t where x = #{x}\n</select>\n<update id="u"><![CDATA[\ndelete from t where n < 1\n]]></update>\n</mapper>';
	await linkAs('res/m.xml', mapper, 530);
	// SQL 키워드(select·from·where·delete)는 색 칠한 조각(span)으로 나뉜다. 일반 글자였다면 줄에 span이 없다
	const spans = line => page.evaluate(line => [...[...document.querySelectorAll('.tab-body:not([hidden]) .cm-line')][line].querySelectorAll('span')].map(e => e.textContent), line);
	assert.deepEqual((await spans(2)).filter(t => ['select', 'from', 'where'].includes(t)), ['select', 'from', 'where'], `XML 안 SQL 색: ${JSON.stringify(await spans(2))}`);
	assert.ok((await spans(5)).includes('delete'), `CDATA 안 SQL 색: ${JSON.stringify(await spans(5))}`);
	const complete = async (text, label, where) => {
		await reset(mapper);
		await page.evaluate(at => { const v = window.editor(); const pos = v.state.doc.toString().indexOf(at); v.dispatch({ selection: { anchor: pos } }); v.focus(); }, where);
		await page.keyboard.type(text, {delay: 25});
		await page.waitForFunction(label => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent.toLowerCase() === label), {timeout: 6000}, label)
			.catch(async () => assert.fail(`'${text}' 자동완성에 ${label} 없음: ${(await page.evaluate(() => [...document.querySelectorAll('.cm-completionLabel')].map(e => e.textContent))).join(',')}`));
		await page.keyboard.press('Escape');
	};
	await complete('whe', 'where', 'select id from');
	// 같은 자리에서 태그 자동완성도 그대로(`<in` → include)
	await complete('<in', 'include', 'select id from');
	// 방언: rownum은 Oracle에만
	assert.equal(await page.evaluate(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'rownum')), false);
	await page.evaluate(() => window.send({ type: 'codeOptions', wordWrap: false, sqlDialect: 'oracle' }));
	await new Promise(resolve => setTimeout(resolve, 200));
	await complete('rown', 'rownum', 'select id from');
	await linkAs('res/q.sql', 'select * from t', 531);
	assert.ok((await spans(0)).includes('select'), `.sql 색: ${JSON.stringify(await spans(0))}`);
	await reset('sel'); await page.keyboard.type('e', {delay: 25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent.toLowerCase() === 'select'), {timeout: 6000}).catch(() => assert.fail('.sql 키워드 자동완성'));
	await page.keyboard.press('Escape');
	await page.evaluate(() => window.send({ type: 'codeOptions', wordWrap: false, sqlDialect: 'standard' }));
	console.log('SQL: 매퍼 XML 안·CDATA·.sql 색, 키워드 자동완성, 태그 자동완성 공존, 방언 변경 passed');
	// 줄바꿈: VS Code editor.wordWrap을 따라 모든 코드 편집기에 적용·해제(긴 줄이 여러 줄로)
	const wrapped = () => page.evaluate(() => { const v = window.editor(); const line = v.dom.querySelector('.cm-line'); return { on: v.contentDOM.classList.contains('cm-lineWrapping'), tall: line.getBoundingClientRect().height > parseFloat(getComputedStyle(line).lineHeight) * 1.5 }; });
	await reset('x'.repeat(400) + ' ' + 'word '.repeat(80));
	assert.deepEqual(await wrapped(), { on: false, tall: false }, '기본: 줄바꿈 없음');
	await page.evaluate(() => window.send({ type: 'codeOptions', wordWrap: true, sqlDialect: 'standard' }));
	await page.waitForFunction(() => window.editor().contentDOM.classList.contains('cm-lineWrapping'));
	assert.deepEqual(await wrapped(), { on: true, tall: true }, '줄바꿈 켜면 긴 줄이 여러 줄');
	await clickTab('Script');
	assert.equal((await wrapped()).on, true, 'Script 편집기도 같은 설정');
	await page.evaluate(() => window.send({ type: 'codeOptions', wordWrap: false, sqlDialect: 'standard' }));
	await page.waitForFunction(() => !window.editor().contentDOM.classList.contains('cm-lineWrapping'));
	await clickTab('Service');
	console.log('줄바꿈: editor.wordWrap 따라가기(Service·Script) passed');
	// 탭 끌어 놓기: Mybatis를 Design 왼쪽에 → 맨 앞, 순서는 확장에 저장 요청
	// 놓기 전 표시(앞·뒤 선)가 실제로 놓이는 자리와 같아야 한다
	const dragTab = async (name, target, after) => {
		const from = await (await tabButton(name)).boundingBox(), to = await (await tabButton(target)).boundingBox();
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
		await page.mouse.move(to.x + (after ? to.width - 4 : 4), to.y + to.height / 2, { steps: 10 });
		await page.waitForFunction((target, cls) => window.tab(target).classList.contains(cls),
			{ timeout: 3000 }, target, after ? 'drop-after' : 'drop-before').catch(() => assert.fail(`${name} → ${target} 놓기 표시 없음`));
		await page.mouse.up();
	};
	await dragTab('Mybatis', 'Design', false);
	await page.waitForFunction(() => document.querySelector('.canvas-frame .tab-bar button[role="tab"]')?.textContent === 'Mybatis');
	assert.deepEqual(await tabNames(), ['Mybatis', 'Design', 'Script', 'Source', 'Controller', 'Service', 'Mapper']);
	assert.deepEqual((await lastSent('setTabOrder')).order, await tabNames());
	await dragTab('Design', 'Source', true);
	assert.deepEqual(await tabNames(), ['Mybatis', 'Script', 'Source', 'Design', 'Controller', 'Service', 'Mapper']);
	// 다른 화면에서 바꾼 순서(확장이 보냄)
	await page.evaluate(() => window.send({ type: 'tabOrder', order: ['Design', 'Script', 'Source', 'Controller', 'Service', 'Mapper', 'Mybatis'] }));
	await page.waitForFunction(() => document.querySelector('.canvas-frame .tab-bar button[role="tab"]')?.textContent === 'Design');
	await clickTab('Script');
	await page.waitForFunction(() => document.querySelector('.canvas-frame .tab-bar button.active')?.textContent === 'Script');
	await page.evaluate(() => window.editor().focus());
	await modifiedKey('Control', 's');
	assert.equal(await page.evaluate(() => window.leakedSave), 1, 'Script 탭의 Ctrl+S는 그대로 VS Code(화면 XML 저장)');
	console.log('Tabs: 끌어서 순서 바꾸기·저장된 순서 반영 passed');
	// 옆 패널 탭(Property/Event, Outline/Data)도 끌어서 순서 변경. 한 목록에 저장하되 다른 탭 줄의 순서는 그대로
	const anyTab = name => page.evaluateHandle(name => [...document.querySelectorAll('.tab-bar button[role="tab"]')].find(b => b.textContent === name), name);
	const barNames = name => page.evaluate(name => [...[...document.querySelectorAll('.tab-bar button[role="tab"]')].find(b => b.textContent === name).closest('.tab-bar').querySelectorAll('button[role="tab"]')].map(b => b.textContent), name);
	const activeTabs = await page.evaluate(() => [...document.querySelectorAll('.tab-bar button[role="tab"].active')].map(b => b.textContent));
	for (const [name, target] of [['Event', 'Property'], ['Data', 'Outline']]) {
		const from = await (await anyTab(name)).boundingBox(), to = await (await anyTab(target)).boundingBox();
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
		await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 10 }); await page.mouse.up();
		await page.waitForFunction(([name, target]) => { const b = [...document.querySelectorAll('.tab-bar button[role="tab"]')].find(x => x.textContent === target); return b.closest('.tab-bar').querySelector('button[role="tab"]').textContent === name; }, { timeout: 3000 }, [name, target])
			.catch(() => assert.fail(`${name} → ${target} 앞으로 안 옮겨짐`));
	}
	assert.deepEqual([await barNames('Property'), await barNames('Outline')], [['Event', 'Property'], ['Data', 'Outline']]);
	const savedOrder = (await lastSent('setTabOrder')).order;
	assert.ok(savedOrder.indexOf('Event') < savedOrder.indexOf('Property') && savedOrder.indexOf('Data') < savedOrder.indexOf('Outline') && savedOrder.includes('Design'), `다른 탭 줄 순서도 그대로 저장: ${savedOrder}`);
	await page.evaluate(() => window.send({ type: 'tabOrder', order: ['Design', 'Script', 'Source', 'Controller', 'Service', 'Mapper', 'Mybatis'] }));
	await page.waitForFunction(() => [...document.querySelectorAll('.tab-bar button[role="tab"]')].find(b => b.textContent === 'Property').closest('.tab-bar').querySelector('button[role="tab"]').textContent === 'Property');
	for (const name of activeTabs.filter(n => ['Property', 'Event', 'Outline', 'Data'].includes(n))) { await (await anyTab(name)).click(); }
	console.log('Tabs: Property/Event·Outline/Data 끌어서 순서 바꾸기 passed');
	// + 로 탭 추가(이름은 확장이 받음) → 확장이 새 목록과 select를 보내면 그 탭으로. 우클릭 → 탭 삭제
	await page.click('.canvas-frame .tab-add');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'addTab'), {timeout: 2000}).catch(() => assert.fail('+ 클릭 → addTab 요청 없음'));
	const withDto = [{ id: 'controller', label: 'Controller' }, { id: 'service', label: 'Service' },
		{ id: 'mapper', label: 'Mapper' }, { id: 'mybatis', label: 'Mybatis' }, { id: 'tab1', label: 'DTO' }];
	await page.evaluate(tabs => { window.send({ type: 'linkTabs', tabs, exts: ['.java', '.xml', '.jsp'], select: 'DTO' }); window.send({ type: 'linked', kind: 'tab1' }); }, withDto);
	await page.waitForFunction(() => document.querySelector('.canvas-frame .tab-bar button.active')?.textContent === 'DTO');
	assert.deepEqual((await tabNames()).slice(-2), ['Mybatis', 'DTO'], '새 탭은 맨 뒤');
	assert.match(await page.$eval('.tab-body:not([hidden]) .link-picker', e => e.textContent), /DTO 파일 연결.*\.java·\.xml·\.jsp 파일/, "설정한 확장자 안내");
	await page.evaluate(() => window.send({ type: 'linked', kind: 'tab1', path: 'res/d.xml', text: '<a>\n</a>', version: 1 }));
	await page.waitForFunction(() => window.editor()?.state.doc.toString() === '<a>\n</a>');
	await page.evaluate(() => { const v = window.editor(); v.dispatch({ selection: { anchor: 3 } }); v.focus(); });
	await page.keyboard.type('<b/>');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'setCode' && m.target === 'link:tab1'));
	assert.deepEqual(await menuOf('DTO'), ['VS Code에서 열기', '다른 파일로 변경…', '연결 해제', '탭 이름 변경…', '탭 삭제…']);
	// 이름 변경: 이름은 확장이 입력 상자로 받는다 → 새 목록이 오면 보고 있던 탭을 새 이름으로 계속 보고, 자리도 그대로
	await page.evaluate(() => [...document.querySelectorAll('.context-menu button')].find(b => b.textContent === '탭 이름 변경…').click());
	assert.deepEqual(await lastSent('renameTab'), { type: 'renameTab', kind: 'tab1' });
	const renamed = withDto.map(t => t.id === 'tab1' ? { ...t, label: 'Model' } : t);
	await page.evaluate(tabs => window.send({ type: 'linkTabs', tabs, exts: ['.java'] }), renamed);
	await page.waitForFunction(() => window.tab('Model') && !window.tab('DTO'));
	assert.equal(await page.$eval('.canvas-frame .tab-bar button.active', b => b.textContent), 'Model', '보던 탭 그대로');
	assert.equal(await page.evaluate(() => window.editor()?.state.doc.toString().includes('<b/>')), true, '편집기 그대로');
	assert.deepEqual(await menuOf('Model'), ['VS Code에서 열기', '다른 파일로 변경…', '연결 해제', '탭 이름 변경…', '탭 삭제…']);
	await page.evaluate(() => [...document.querySelectorAll('.context-menu button')].find(b => b.textContent === '탭 삭제…').click());
	assert.deepEqual(await lastSent('removeTab'), { type: 'removeTab', kind: 'tab1' });
	// 확장이 확인 창(모달)에서 삭제를 고르면 새 목록을 보낸다 → 보고 있던 탭이 없어져 Design으로
	await page.evaluate(tabs => window.send({ type: 'linkTabs', tabs: tabs.slice(0, 4), exts: ['.java'] }), withDto);
	await page.waitForFunction(() => !window.tab('Model') && document.querySelector('.canvas-frame .tab-bar button.active')?.textContent === 'Design');
	assert.ok(await page.$('.canvas-frame > .tab-body:not([hidden]) > div'), 'Design 내용 표시');
	console.log('Tabs: + 탭 추가·이름 변경·탭 삭제 passed');
	// 코드 편집기 테마: 확장이 고른 테마를 보내면 모든 코드 편집기에 적용, VS Code 밝음/어두움 전환에는 안 바뀜. 'vscode'면 다시 따라간다
	await clickTab('Script');
	const editorBg = () => page.evaluate(() => getComputedStyle(document.querySelector('.tab-body:not([hidden]) .cm-editor')).backgroundColor);
	const vsDarkBg = await editorBg();
	await page.evaluate(() => window.send({ type: 'codeTheme', theme: 'dracula' }));
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.tab-body:not([hidden]) .cm-editor')).backgroundColor === 'rgb(45, 47, 63)', {timeout: 3000})
		.catch(async () => assert.fail(`Dracula 배경 아님: ${await editorBg()}`));
	assert.ok(await page.$eval('.tab-body:not([hidden]) .code-editor', e => e.classList.contains('custom-theme')));
	await reset('selected text'); await modifiedKey('Control', 'a');
	await page.waitForSelector('.tab-body:not([hidden]) .cm-selectionBackground');
	const selection = await page.$eval('.tab-body:not([hidden]) .cm-selectionBackground', e => getComputedStyle(e).backgroundColor);
	assert.notEqual(selection, 'rgba(0, 0, 0, 0)', `선택 표시: ${selection}`);
	await reset('function f() {\n    return "text"; // note\n}'); await page.keyboard.down('Shift'); await page.keyboard.press('ArrowUp'); await page.keyboard.up('Shift');
	await page.screenshot({path:path.join(tmpdir(), 'ws5-theme-dracula.png'), clip: await page.$eval('.tab-body:not([hidden]) .code-editor', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: Math.min(r.width, 700), height: 120 }; })});
	await page.evaluate(() => { document.body.className = 'vscode-light'; });
	await new Promise(resolve => setTimeout(resolve, 100));
	assert.equal(await editorBg(), 'rgb(45, 47, 63)', '고른 테마는 VS Code 밝음 전환에 안 바뀜');
	await page.evaluate(() => { document.body.className = 'vscode-dark'; });
	await clickTab('Source');
	assert.equal(await editorBg(), 'rgb(45, 47, 63)', '다른 코드 탭도 같은 테마');
	// 검색창(Ctrl+F)도 고른 테마의 배경·글자색
	await page.click('.tab-body:not([hidden]) .cm-content'); await modifiedKey('Control', 'f');
	await page.waitForSelector('.tab-body:not([hidden]) .cm-search .cm-textfield');
	const search = await page.evaluate(() => {
		const q = s => getComputedStyle(document.querySelector('.tab-body:not([hidden]) ' + s));
		return { panels: q('.cm-panels').backgroundColor, field: q('.cm-search .cm-textfield').color, editor: q('.cm-editor').color };
	});
	assert.deepEqual({ panels: search.panels, field: search.field }, { panels: 'rgb(45, 47, 63)', field: search.editor }, `검색창 테마: ${JSON.stringify(search)}`);
	await page.keyboard.press('Escape');
	await page.evaluate(() => window.send({ type: 'codeTheme', theme: 'vscode' }));
	await page.waitForFunction(bg => getComputedStyle(document.querySelector('.tab-body:not([hidden]) .cm-editor')).backgroundColor === bg, {timeout: 3000}, vsDarkBg);
	assert.ok(!await page.$eval('.tab-body:not([hidden]) .code-editor', e => e.classList.contains('custom-theme')));
	console.log('Code theme: 적용·VS Code 전환 무시·되돌리기 passed');
	// 사용자 테마: 고른 테마 위 덮어쓰기 층(배경·선택·문법 색), 가져온 테마(VS Code 기본 라이트 바탕 + 층)
	await clickTab('Script');
	await reset('return "x";');
	const keywordStyle = () => page.evaluate(() => {
		const span = [...document.querySelectorAll('.tab-body:not([hidden]) .cm-content span')].find(s => s.textContent === 'return');
		const style = getComputedStyle(span);
		return [style.color, style.fontStyle];
	});
	await page.evaluate(() => window.send({ type: 'codeTheme', theme: 'dracula', own: { colors: { background: '#102030', selection: '#ff000080' }, tokens: { keyword: { color: '#ff8800', fontStyle: 'italic' } } } }));
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.tab-body:not([hidden]) .cm-editor')).backgroundColor === 'rgb(16, 32, 48)', { timeout: 3000 })
		.catch(async () => assert.fail(`덮어쓴 배경 아님: ${await editorBg()}`));
	assert.deepEqual(await keywordStyle(), ['rgb(255, 136, 0)', 'italic'], '덮어쓴 키워드 색·기울임이 테마보다 우선');
	assert.equal(await page.$eval('.tab-body:not([hidden]) .code-editor', e => e.style.getPropertyValue('--code-selection')), '#ff000080', '선택 색은 CSS 변수로');
	await page.evaluate(() => window.send({ type: 'codeTheme', theme: 'vscode', dark: false, imported: { tokens: { keyword: { color: '#0000ff' } } } }));
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.tab-body:not([hidden]) .cm-editor')).backgroundColor === 'rgb(255, 255, 255)', { timeout: 3000 })
		.catch(async () => assert.fail(`가져온 라이트 테마 바탕 아님: ${await editorBg()}`));
	assert.equal((await keywordStyle())[0], 'rgb(0, 0, 255)');
	assert.ok(await page.$eval('.tab-body:not([hidden]) .code-editor', e => e.classList.contains('custom-theme')), '가져온 테마는 고른 테마처럼');
	await page.evaluate(() => { document.body.className = 'vscode-dark'; document.body.classList.add('x'); });
	await new Promise(resolve => setTimeout(resolve, 100));
	assert.equal(await editorBg(), 'rgb(255, 255, 255)', '가져온 테마는 VS Code 밝음·어두움 전환에 안 바뀜');
	// 현재 줄 색이 불투명해도(IntelliJ Dark 등) 단어 더블클릭 선택이 보이게: 선택 중엔 현재 줄 배경을 걷는다
	await page.evaluate(() => window.send({ type: 'codeTheme', theme: 'vscode', dark: true, imported: { colors: { lineHighlight: '#26282e', selection: '#214283' } } }));
	await page.waitForFunction(() => document.querySelector('.tab-body:not([hidden]) .code-editor')?.style.getPropertyValue('--code-line') === '#26282e', { timeout: 3000 });
	await reset('word other');
	const lineBg = () => page.$eval('.tab-body:not([hidden]) .cm-activeLine', e => getComputedStyle(e).backgroundColor);
	assert.equal(await lineBg(), 'rgb(38, 40, 46)', '선택 없으면 현재 줄 색');
	const word = await page.evaluate(() => { const v = window.editor(), r = v.coordsAtPos(2); return { x: r.left, y: (r.top + r.bottom) / 2 }; });
	await page.mouse.click(word.x, word.y, { count: 2 });
	await page.waitForFunction(() => { const v = window.editor(), r = v.state.selection.main; return v.state.sliceDoc(r.from, r.to) === 'word'; }, { timeout: 3000 });
	assert.equal(await lineBg(), 'rgba(0, 0, 0, 0)', '선택 중엔 현재 줄 배경 걷음(선택 색이 가려지지 않게)');
	await page.evaluate(() => { document.body.className = 'vscode-dark'; window.send({ type: 'codeTheme', theme: 'vscode' }); });
	await page.waitForFunction(bg => getComputedStyle(document.querySelector('.tab-body:not([hidden]) .cm-editor')).backgroundColor === bg, { timeout: 3000 }, vsDarkBg);
	console.log('Code theme: 덮어쓰기 층·가져온 테마 passed');
	// 탭 줄 톱니바퀴: 우측 패널 버튼 왼쪽, 누르면 아래로 메뉴. 항목은 확장에 이름만 보낸다
	const gear = await page.$('.canvas-frame .tab-settings');
	assert.ok(await page.evaluate(() => { const g = document.querySelector('.canvas-frame .tab-settings'), r = document.querySelector('.canvas-frame .tab-panel-right'); return g.nextElementSibling === r; }), '우측 패널 버튼 바로 왼쪽');
	await gear.click();
	await page.waitForSelector('.context-menu[role="menu"]');
	assert.deepEqual(await page.$$eval('.context-menu [role="menuitem"]', bs => bs.map(b => b.textContent)),
		['코드 편집기 테마 변경…', '테마 파일 가져오기…', '테마 색 덮어쓰기…', 'SQL 방언…', '도구 경로 설정…', '확장 설정 모두 보기…']);
	assert.ok(await page.evaluate(() => { const m = document.querySelector('.context-menu').getBoundingClientRect(), g = document.querySelector('.canvas-frame .tab-settings').getBoundingClientRect(); return (m.top >= g.bottom || m.bottom <= g.top) && Math.abs(m.right - g.right) < 1; }), '톱니바퀴 아래(공간 없으면 위)에, 버튼을 덮지 않고 오른쪽 끝 맞춤');
	await page.evaluate(() => { window.sent.length = 0; });
	await page.evaluate(() => [...document.querySelectorAll('.context-menu [role="menuitem"]')].find(b => b.textContent === 'SQL 방언…').click());
	assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'settingsMenu')), { type: 'settingsMenu', item: 'sqlDialect' });
	assert.equal(await page.$('.context-menu'), null, '고르면 닫힘');
	await gear.click(); await page.waitForSelector('.context-menu');
	await gear.click();
	assert.equal(await page.$('.context-menu'), null, '열린 채 다시 누르면 닫힘');
	await gear.click(); await page.waitForSelector('.context-menu');
	await page.keyboard.press('Escape');
	assert.equal(await page.$('.context-menu'), null, 'Esc로 닫힘');
	console.log('Settings: 탭 줄 톱니바퀴 메뉴 passed');
	// 잠깐 뜨는 알림: 확장이 보내면 오른쪽 아래에 떴다가 사라짐
	await page.evaluate(() => window.send({ type: 'toast', message: '바인딩 2곳도 함께 변경했습니다. `dlt_a` → `dlt_b`' }));
	await page.waitForFunction(() => document.querySelector('.toast[role="status"]')?.textContent === '바인딩 2곳도 함께 변경했습니다. dlt_a → dlt_b', { timeout: 3000 });
	assert.deepEqual(await page.$$eval('.toast code', cs => cs.map(c => c.textContent)), ['dlt_a', 'dlt_b'], '`값`은 코드 모양');
	// 마우스를 올려 둔 동안은 안 사라짐, 떼면 다시 3초 뒤 사라짐
	await page.hover('.toast');
	await new Promise(resolve => setTimeout(resolve, 3600));
	assert.ok(await page.$('.toast'), '마우스를 올려 둔 동안 유지');
	assert.equal(await page.$eval('.toast code', c => getComputedStyle(c).backgroundColor), 'rgb(255, 255, 255)', '값은 흰 칩(웹뷰 기본 노란 code 색 아님)');
	await page.screenshot({path:path.join(tmpdir(), 'ws5-toast-code.png')});
	await page.mouse.move(5, 5);
	await new Promise(resolve => setTimeout(resolve, 300));
	assert.equal(await page.$eval('.toast', e => getComputedStyle(e).backgroundColor), 'color(srgb 0.85 0.924706 0.974706)', '캔버스 hover와 같은 파란 파스텔');
	await page.screenshot({path:path.join(tmpdir(), 'ws5-toast.png')});
	await page.waitForFunction(() => !document.querySelector('.toast'), { timeout: 7000 });
	console.log('Toast: 알림 표시·자동 사라짐 passed');
	// 테마 색 덮어쓰기 팝업: 테마 기본 색 표시, 입력하는 대로 열린 편집기에 미리 보기, 닫기는 되돌림, 확인은 공통·이 테마 층 저장
	await clickTab('Script');
	await reset('return "x"; // c');
	// 글자 위치로 찾는다(커서 표시 등으로 한 단어가 여러 span으로 쪼개질 수 있다)
	const spanStyle = text => page.evaluate(text => {
		const v = window.editor(), { node } = v.domAtPos(v.state.doc.toString().indexOf(text) + 1);
		const st = getComputedStyle(node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
		return [st.color, st.fontStyle];
	}, text);
	await page.evaluate(() => window.send({ type: 'codeTheme', theme: 'dracula', id: 'dracula', label: 'Dracula' }));
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.tab-body:not([hidden]) .cm-editor')).backgroundColor === 'rgb(45, 47, 63)');
	const draculaKeyword = await spanStyle('return');
	const openThemeColors = async () => {
		await page.click('.canvas-frame .tab-settings');
		await page.evaluate(() => [...document.querySelectorAll('.context-menu [role="menuitem"]')].find(b => b.textContent === '테마 색 덮어쓰기…').click());
		await page.waitForSelector('.theme-colors-editor[open]');
	};
	const hex = name => `.theme-colors-editor .theme-hex[data-name="${name}"]`;
	const themeRow = name => `.theme-colors-editor .theme-row:has(.theme-hex[data-name="${name}"])`;
	await openThemeColors();
	assert.equal(await page.$eval('.theme-colors-editor .popup-title .mono', e => e.textContent), 'Dracula');
	assert.equal(await page.$eval(hex('keyword'), e => e.placeholder), '테마 기본');
	assert.equal(await page.$eval(`${themeRow('keyword')} .theme-swatch`, e => getComputedStyle(e).backgroundColor), draculaKeyword[0], '안 바꾼 칸에도 테마의 실제 색');
	assert.equal(await page.$eval(`${themeRow('background')} .theme-swatch`, e => getComputedStyle(e).backgroundColor), 'rgb(45, 47, 63)');
	await page.click(hex('keyword')); await page.keyboard.type('#ff8800'); await page.keyboard.press('Enter');
	await page.waitForFunction(() => { const s = [...document.querySelectorAll('.tab-body:not([hidden]) .cm-content span')].find(s => s.textContent === 'return'); return getComputedStyle(s).color === 'rgb(255, 136, 0)'; }, { timeout: 3000 });
	assert.ok(await page.$eval('.theme-colors-editor .theme-preview', p => [...p.querySelectorAll('.cm-content span')].some(s => s.textContent === 'return' && getComputedStyle(s).color === 'rgb(255, 136, 0)')), '팝업 미리 보기도');
	await page.click(`${themeRow('keyword')} .font-italic`);
	assert.equal((await spanStyle('return'))[1], 'italic', 'I 토글');
	assert.equal(await page.$eval('.theme-colors-editor .popup-meta', e => e.textContent), '· 바꾼 색 1');
	await page.evaluate(() => { window.sent.length = 0; });
	await page.evaluate(() => [...document.querySelectorAll('.theme-colors-editor .data-editor-actions button')].find(b => b.textContent === '닫기').click());
	await page.waitForFunction(() => !document.querySelector('.theme-colors-editor'));
	assert.deepEqual(await spanStyle('return'), draculaKeyword, '닫기는 원래대로');
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'saveThemeCustomizations')), false, '닫기는 저장 안 함');
	await openThemeColors();
	await page.click(hex('keyword')); await page.keyboard.type('#ff8800'); await page.keyboard.press('Enter');
	assert.ok(await page.$(`${themeRow('keyword')}.changed .theme-reset`), '바꾼 줄에 되돌리기');
	await page.click(`${themeRow('keyword')} .theme-reset`);
	assert.equal(await page.$eval(hex('keyword'), e => e.value), '', '되돌리면 테마 기본');
	await page.click(hex('keyword')); await page.keyboard.type('#ff8800'); await page.keyboard.press('Enter');
	await page.evaluate(() => [...document.querySelectorAll('.theme-colors-editor .segmented button')].find(b => b.textContent === '모든 테마').click());
	await page.waitForFunction(sel => document.querySelector(sel)?.value === '', { timeout: 3000 }, hex('keyword'))
		.catch(() => assert.fail('모든 테마 층은 따로'));
	await page.click(hex('comment')); await page.keyboard.type('#123456'); await page.keyboard.press('Tab');
	await page.click('.theme-colors-editor .btn-primary');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'saveThemeCustomizations'));
	assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'saveThemeCustomizations')),
		{ type: 'saveThemeCustomizations', common: { tokens: { comment: { color: '#123456' } } }, own: { tokens: { keyword: { color: '#ff8800' } } } });
	assert.equal((await spanStyle('return'))[0], 'rgb(255, 136, 0)', '확인하면 그대로 유지');
	assert.equal((await spanStyle('// c'))[0], 'rgb(18, 52, 86)');
	// 미리 보기 글꼴은 코드 편집기와 같다
	const scriptFont = await page.$eval('.tab-body:not([hidden]) .cm-scroller', e => getComputedStyle(e).fontFamily);
	await openThemeColors();
	const previewColor = text => page.$eval('.theme-colors-editor .theme-preview', (p, text) => {
		const span = [...p.querySelectorAll('.cm-line span')].find(s => s.textContent === text);
		return span && getComputedStyle(span).color;
	}, text);
	assert.equal(await page.$eval('.theme-colors-editor .theme-preview .cm-scroller', e => getComputedStyle(e).fontFamily), scriptFont, '미리 보기 글꼴 = 코드 편집기 글꼴');
	// 어노테이션 색이 @Override에 칠해진다(@lezer/java에는 어노테이션 태그가 없어 덧붙임)
	await page.click(hex('annotation')); await page.keyboard.type('#00ff00'); await page.keyboard.press('Enter');
	await page.waitForFunction(() => [...document.querySelectorAll('.theme-colors-editor .theme-preview .cm-line span')].some(s => s.textContent.includes('Override') && getComputedStyle(s).color === 'rgb(0, 255, 0)'), { timeout: 3000 })
		.catch(async () => assert.fail(`어노테이션 색 아님: ${await previewColor('Override')}`));
	// 글꼴 모양을 켰다 끄면 테마 기본으로(되돌리기 없음)
	await page.click(`${themeRow('string')} .font-bold`);
	assert.ok(await page.$(`${themeRow('string')}.changed .theme-reset`));
	await page.click(`${themeRow('string')} .font-bold`);
	assert.equal(await page.$(`${themeRow('string')}.changed`), null, '켰다 끄면 바꾼 줄 아님(되돌리기 없음)');
	await page.evaluate(() => [...document.querySelectorAll('.theme-colors-editor .data-editor-actions button')].find(b => b.textContent === '닫기').click());
	await page.evaluate(() => window.send({ type: 'codeTheme', theme: 'vscode' }));
	console.log('Theme colors: 덮어쓰기 팝업(테마 기본·미리 보기·닫기·되돌리기·범위·저장) passed');
	// Git 변경 표시: 확장이 보낸 기준(스테이지 내용)과 비교. 줄 번호 옆 막대(줄마다)와 오른쪽 끝 띠(범위마다)
	await clickTab('Script');
	// hover 설명: Script는 WebSquare API·컴포넌트 메서드, Source는 속성 설명. 설명이 없는 자리에는 안 뜬다
	const hoverText = async (text, needle) => {
		await reset(text);
		const at = await page.evaluate((text, needle) => { const c = window.editor().coordsAtPos(text.indexOf(needle) + 1); return { x: c.left + 1, y: (c.top + c.bottom) / 2 }; }, text, needle);
		await page.mouse.move(0, 0);
		await page.mouse.move(at.x, at.y);
		const shown = await page.waitForFunction(() => document.querySelector('.cm-tooltip .ws-hover')?.textContent, { timeout: 2500 }).then(h => h.jsonValue()).catch(() => undefined);
		await page.mouse.move(0, 0);
		await page.waitForFunction(() => !document.querySelector('.cm-tooltip .ws-hover'), { timeout: 3000 });
		return shown;
	};
	await clickTab('Script');
	assert.match(await hoverText('$p.getComponentById("a");', 'getComponentById'), /getComponentById\(id\).*컴포넌트 조회/s, 'Script hover: API 설명');
	assert.match(await hoverText('ipt_name.setValue(1);', 'setValue'), /값 설정/, 'Script hover: 컴포넌트 종류의 메서드');
	assert.equal(await hoverText('console.log(1);', 'log'), undefined, 'Script hover: 설명 없는 멤버는 안 뜸');
	await clickTab('Source');
	assert.match(await hoverText('<w2:input label="x"/>', 'label'), /label.*화면에 보이는 글자/s, 'Source hover: 속성 설명');
	assert.equal(await hoverText('<w2:input disabled="true"/>', 'disabled'), undefined, 'Source hover: 설명 없는 속성은 안 뜸');
	console.log('Hover: Script API·컴포넌트 메서드, Source 속성 설명 passed');
	await clickTab('Script');
	// 셀 병합: 그리드 컬럼·group(th·td) 셀을 Ctrl+클릭으로 둘 이상 골라 우클릭 메뉴·Outline 메뉴·Ctrl+M으로. 붙어 있을 때만
	await clickTab('Design');
	const WS = 'http://www.inswave.com/websquare', XF = 'http://www.w3.org/2002/xforms';
	const mergeDoc = await page.evaluate((WS, XF) => {
		const text = `<html xmlns:w2="${WS}" xmlns:xf="${XF}"><body><w2:gridView id="grd"><w2:header id="h"><w2:row id="r1"><w2:column id="c1" value="A"/><w2:column id="c2" value="B"/><w2:column id="c3" value="C"/></w2:row></w2:header></w2:gridView>`
			+ '<xf:group tagname="table" id="t"><xf:group tagname="tbody"><xf:group tagname="tr" id="tr1"><xf:group tagname="th" id="th1"/><xf:group tagname="td" id="td1"/></xf:group></xf:group></xf:group></body></html>';
		const root = window.parseXml(text), first = window.testDefs.length;
		window.send({ type: 'definitions', defs: [...window.testDefs, { id: 'gridView', ns: WS, realType: 'gridView', parents: [], bases: [], properties: [], events: [] }, { id: 'group', ns: XF, realType: 'group', parents: [], bases: [], properties: [], events: [] }] });
		const walk = n => { n.def = n.tag === 'w2:gridView' ? first : n.tag === 'xf:group' ? first + 1 : n.def; n.children.forEach(walk); };
		walk(root);
		window.send({ type: 'document', version: 900, text, root, script: { text: '' } });
		const ids = {}; const index = n => { if (n.attrs.id) { ids[n.attrs.id] = n.index; } n.children.forEach(index); };
		index(root);
		return ids;
	}, WS, XF);
	await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('[data-wse]'), { timeout: 5000 });
	const cell = id => page.evaluateHandle(i => document.querySelector('.canvas-host').shadowRoot.querySelector(`[data-wse="${i}"]`), mergeDoc[id]);
	const row = id => page.evaluateHandle(i => [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.id')?.textContent === i), id);
	const clickRow = async (id, options) => (await row(id)).asElement().click(options);
	const ctrlClick = async handle => { await page.keyboard.down('Control'); await (await handle.asElement()).click(); await page.keyboard.up('Control'); };
	const menuItems = () => page.$$eval('.context-menu button', bs => bs.map(b => ({ text: b.textContent, disabled: b.disabled })));
	const lastMerge = () => page.evaluate(() => window.sent.findLast(m => m.type === 'mergeCells'));
	// 그리드: 붙은 두 컬럼 → 병합 켜짐 → 요청
	await (await (await cell('c1')).asElement()).click();
	await ctrlClick(await cell('c2'));
	await (await (await cell('c2')).asElement()).click({ button: 'right' });
	await page.waitForSelector('.context-menu');
	const gridMenu = await menuItems();
	assert.deepEqual(gridMenu.find(i => i.text === '병합'), { text: '병합', disabled: false }, '그리드 우클릭: 붙은 셀 → 병합 켜짐');
	assert.ok(gridMenu.length > 2, '그리드 메뉴(컬럼·행 추가 등)는 그대로');
	await page.evaluate(() => { window.sent.length = 0; });
	await page.$$eval('.context-menu button', bs => bs.find(b => b.textContent === '병합').click());
	assert.deepEqual(await lastMerge(), { type: 'mergeCells', version: 900, index: mergeDoc.c1, more: [mergeDoc.c2] }, '병합 요청(왼쪽 위 셀이 대표)');
	// 떨어진 두 컬럼 → 병합 꺼짐(요청 없음)
	await (await (await cell('c1')).asElement()).click();
	await ctrlClick(await cell('c3'));
	await (await (await cell('c3')).asElement()).click({ button: 'right' });
	await page.waitForSelector('.context-menu');
	assert.deepEqual((await menuItems()).find(i => i.text === '병합'), { text: '병합', disabled: true }, '그리드 우클릭: 떨어진 셀 → 병합 꺼짐');
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => !document.querySelector('.context-menu'));
	// 칸을 누른 채 끌기: 지나간 범위의 칸을 모두 고르고(누른 칸이 대표), 그리드는 안 옮김. 이어 우클릭 병합
	const centerOf = async id => { const b = await (await cell(id)).asElement().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
	const [from, to] = [await centerOf('c1'), await centerOf('c3')];
	await page.evaluate(() => { window.sent.length = 0; });
	await page.mouse.move(from.x, from.y); await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up();
	const picked = () => page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length);
	await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length === 3, { timeout: 3000 })
		.catch(async () => assert.fail(`끌어서 고른 칸 수: ${await picked()}`));
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'move')), false, '그리드는 안 옮김');
	await (await (await cell('c2')).asElement()).click({ button: 'right' });
	await page.waitForSelector('.context-menu');
	await page.$$eval('.context-menu button', bs => bs.find(b => b.textContent === '병합').click());
	assert.deepEqual(await lastMerge(), { type: 'mergeCells', version: 900, index: mergeDoc.c1, more: [mergeDoc.c2, mergeDoc.c3] }, '끌어 고른 칸을 우클릭 병합');
	// 끌지 않은 클릭은 그 칸 하나만
	await (await (await cell('c2')).asElement()).click();
	await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length === 1, { timeout: 3000 });
	// 손잡이를 누르면 그리드 선택, 그리드를 고른 상태에서도 칸 끌기는 범위 고르기(그리드 이동 아님)
	await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-grid-handle').click());
	await page.waitForFunction(() => /gridView|grd/.test(document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-chip')?.textContent ?? ''), { timeout: 3000 })
		.catch(async () => assert.fail(`손잡이 클릭 뒤 선택: ${await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-chip')?.textContent)}`));
	await page.evaluate(() => { window.sent.length = 0; });
	await page.mouse.move(from.x, from.y); await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up();
	await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length === 3, { timeout: 3000 });
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'move')), false, '그리드를 골라도 칸 끌기는 이동 아님');
	console.log('Design: 그리드 셀 병합(붙은 셀만), 끌어서 여러 칸 고르기 passed');
	// group 표의 th·td: Design 우클릭 → 병합만 있는 메뉴, Outline 우클릭·Ctrl+M도 같은 요청
	await (await (await cell('th1')).asElement()).click();
	await ctrlClick(await cell('td1'));
	await (await (await cell('td1')).asElement()).click({ button: 'right' });
	await page.waitForSelector('.context-menu');
	assert.deepEqual(await menuItems(), [{ text: '병합', disabled: false }, { text: '병합 해제', disabled: true }], 'group th·td 우클릭: 병합 메뉴');
	await page.evaluate(() => { window.sent.length = 0; });
	await page.$eval('.context-menu button', b => b.click());
	assert.deepEqual(await lastMerge(), { type: 'mergeCells', version: 900, index: mergeDoc.th1, more: [mergeDoc.td1] }, 'group 셀 병합 요청');
	await page.evaluate(() => { window.sent.length = 0; });
	await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row')].some(r => r.querySelector('.id')?.textContent === 'th1'));
	await clickRow('th1');
	await page.keyboard.down('Control'); await clickRow('td1'); await page.keyboard.up('Control');
	await clickRow('td1', { button: 'right' });
	await page.waitForSelector('.context-menu');
	assert.deepEqual(await menuItems(), [{ text: '병합', disabled: false }, { text: '병합 해제', disabled: true }], 'Outline 우클릭: 병합 메뉴');
	await page.$eval('.context-menu button', b => b.click());
	assert.deepEqual(await lastMerge(), { type: 'mergeCells', version: 900, index: mergeDoc.th1, more: [mergeDoc.td1] }, 'Outline 병합 요청');
	console.log('Design·Outline: group th·td 병합(우클릭 메뉴) passed');
	// 병합 풀기(우클릭)와 열 옮기기·지우기(우클릭·Delete): 합친 머리 칸 c1(2칸) + c3, 본문 b1 b2 b3
	const colDoc = await page.evaluate((WS, XF) => {
		const text = `<html xmlns:w2="${WS}" xmlns:xf="${XF}"><body><w2:gridView id="grd"><w2:header id="h"><w2:row id="r1"><w2:column id="c1" value="A" colSpan="2"/><w2:column id="c3" value="C"/></w2:row></w2:header>`
			+ '<w2:gBody id="gb"><w2:row id="br"><w2:column id="b1"/><w2:column id="b2"/><w2:column id="b3"/></w2:row></w2:gBody></w2:gridView></body></html>';
		const root = window.parseXml(text), first = window.testDefs.length;
		const walk = n => { n.def = n.tag === 'w2:gridView' ? first : n.def; n.children.forEach(walk); };
		walk(root);
		window.send({ type: 'document', version: 900, text, root, script: { text: '' } });
		const ids = {}; const index = n => { if (n.attrs.id) { ids[n.attrs.id] = n.index; } n.children.forEach(index); };
		index(root);
		return ids;
	}, WS, XF);
	const colCell = id => page.evaluateHandle(i => document.querySelector('.canvas-host').shadowRoot.querySelector(`[data-wse="${i}"]`), colDoc[id]);
	await page.waitForFunction(i => document.querySelector('.canvas-host')?.shadowRoot?.querySelector(`[data-wse="${i}"]`), { timeout: 5000 }, colDoc.b3);
	const lastOf = type => page.evaluate(type => window.sent.findLast(m => m.type === type), type);
	const openMenu = async id => {
		await (await (await colCell(id)).asElement()).click({ button: 'right' });
		await page.waitForSelector('.context-menu');
		return menuItems();
	};
	const pickMenu = async text => { await page.$$eval('.context-menu button', (bs, text) => bs.find(b => b.textContent.startsWith(text)).click(), text); await page.waitForFunction(() => !document.querySelector('.context-menu')); };
	const c1Menu = await openMenu('c1');
	assert.deepEqual(c1Menu.filter(i => /열|병합/.test(i.text)), [
		{ text: '열 왼쪽으로 이동', disabled: true }, { text: '열 오른쪽으로 이동', disabled: false }, { text: '열 삭제Delete', disabled: false },
		{ text: '병합', disabled: true }, { text: '병합 해제', disabled: false }], '합친 칸 우클릭: 맨 왼쪽이라 왼쪽 이동 꺼짐, 병합 해제 켜짐');
	await pickMenu('병합 해제');
	assert.deepEqual(await lastOf('unmergeCells'), { type: 'unmergeCells', version: 900, index: colDoc.c1, more: [] }, '우클릭 병합 해제');
	await openMenu('c1');
	await pickMenu('열 삭제');
	assert.deepEqual(await lastOf('gridColumns'), { type: 'gridColumns', version: 900, index: colDoc.grd, cells: [colDoc.c1], op: 'delete' }, '우클릭 열 삭제');
	assert.deepEqual((await openMenu('b2')).find(i => i.text === '병합 해제'), { text: '병합 해제', disabled: true }, '합치지 않은 칸은 병합 해제 꺼짐');
	await pickMenu('열 왼쪽으로 이동');
	assert.deepEqual(await lastOf('gridColumns'), { type: 'gridColumns', version: 900, index: colDoc.grd, cells: [colDoc.b2], op: 'left' }, '우클릭 열 왼쪽으로');
	assert.equal((await openMenu('b2')).find(i => i.text === '열 오른쪽으로 이동').disabled, true, 'c1 묶음(2칸) 밖으로는 못 옮김');
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => !document.querySelector('.context-menu'));
	// Delete: 그리드 칸이면 칸 하나가 아니라 그 열
	await (await (await colCell('b3')).asElement()).click();
	await page.evaluate(() => { window.sent.length = 0; });
	await page.keyboard.press('Delete');
	assert.deepEqual(await lastOf('gridColumns'), { type: 'gridColumns', version: 900, index: colDoc.grd, cells: [colDoc.b3], op: 'delete' }, 'Delete는 열 삭제');
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'delete')), false, '칸만 지우지 않음');
	console.log('Design: 병합 풀기·열 옮기기·열 삭제(우클릭·Delete) passed');
	// Data 트리 끌어 옮기기: submission끼리·dataMap/dataList끼리만, 루트에 놓으면 맨 뒤, 다른 종류에는 못 놓음
	const dataIds = await page.evaluate(() => {
		const text = '<html xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms"><head><xf:model><w2:dataCollection baseNode="map"><w2:dataMap id="dm1"/><w2:dataList id="dl1"/></w2:dataCollection><xf:submission id="s1"/><xf:submission id="s2"/></xf:model></head><body/></html>';
		const root = window.parseXml(text);
		window.send({ type: 'document', version: 950, text, root, script: { text: '' } });
		const ids = {}; const walk = n => { ids[n.attrs.id ?? n.tag] = n.index; n.children.forEach(walk); }; walk(root); return ids;
	});
	await page.evaluate(() => window.tab('Data', '.pane').click());
	await page.evaluate(() => [...document.querySelectorAll('.pane .codicon-expand-all')].at(-1)?.click());
	await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row .id')].some(e => e.textContent === 's2'));
	const dragTo = (from, to, where) => page.evaluate((from, to, where) => {
		const row = id => [...document.querySelectorAll('.pane .tree-row')].find(r => (r.querySelector('.id')?.textContent ?? r.querySelector('.tag')?.textContent) === id);
		const a = row(from), b = row(to), dt = new DataTransfer(), r = b.getBoundingClientRect();
		const y = r.top + r.height * (where === 'before' ? 0.2 : 0.8);
		a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
		const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y });
		b.dispatchEvent(over);
		window.sent.length = 0;
		return new Promise(res => setTimeout(() => { b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y })); a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); res({ accepted: over.defaultPrevented, sent: window.sent.find(m => m.type === 'move') ?? null }); }, 50));
	}, from, to, where);
	assert.deepEqual(await dragTo('s2', 's1', 'before'), { accepted: true, sent: { type: 'move', version: 950, dragged: dataIds.s2, target: dataIds.s1, position: 'before' } }, 'submission끼리 앞으로');
	assert.deepEqual(await dragTo('dm1', 'dl1', 'after'), { accepted: true, sent: { type: 'move', version: 950, dragged: dataIds.dm1, target: dataIds.dl1, position: 'after' } }, 'dataMap → dataList 뒤');
	assert.deepEqual(await dragTo('s1', 'Submission', 'after'), { accepted: true, sent: { type: 'move', version: 950, dragged: dataIds.s1, target: dataIds['xf:model'], position: 'inside' } }, 'Submission 루트 → model 맨 뒤');
	assert.deepEqual(await dragTo('s1', 'dm1', 'before'), { accepted: false, sent: null }, '다른 종류에는 못 놓음');
	// 화면 점검: Data 줄에 경고(마우스를 올리면 이유), 접힌 줄은 안쪽 문제를 흐리게
	await page.evaluate(() => {
		const text = '<html xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms" xmlns:ev="urn:ev"><head><xf:model><w2:dataCollection baseNode="map"><w2:dataMap id="dm1"/><w2:dataList id="dm1"/></w2:dataCollection><xf:submission id="s1" ev:submitdone="scwin.s1_done"/><xf:submission id="s2" ref="data:json,dl_none" ev:submitdone="scwin.s2_done"/></xf:model></head><body/></html>';
		window.send({ type: 'document', version: 950, text, root: window.parseXml(text), script: { text: 'scwin.s2_done = function () {};' } });
	});
	const problemOf = id => page.evaluate(id => [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.id')?.textContent === id)?.querySelector('.tree-problem')?.title ?? null, id);
	await page.waitForFunction(() => document.querySelectorAll('.pane .tree-row .tree-problem').length >= 3, {timeout: 3000})
		.catch(async () => assert.fail(`경고 수: ${await page.$$eval('.pane .tree-row .tree-problem', e => e.length)}`));
	assert.equal(await problemOf('dm1'), 'ID가 중복되었습니다. dm1 (2곳)');
	assert.equal(await problemOf('s1'), '등록되지 않은 handler가 적용되어 있습니다. scwin.s1_done');
	assert.equal(await problemOf('s2'), null, '화면에 없는 데이터(스크립트에서 만듦)는 경고 안 함');
	await page.evaluate(() => [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.tag')?.textContent === 'Submission')?.querySelector('.chevron').click());
	await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.tag')?.textContent === 'Submission')?.querySelector('.tree-problem.inside'), {timeout: 3000});
	// 경고 개수 버튼: 누를 때마다 다음 경고 줄을 펼쳐 선택하고 이유를 알림으로(마지막 다음은 처음)
	assert.equal(await page.evaluate(() => [...document.querySelectorAll('.pane .tree-problems')].find(b => b.offsetParent)?.textContent), '3');
	const nextProblemRow = async () => {
		await page.evaluate(() => [...document.querySelectorAll('.pane .tree-problems')].find(b => b.offsetParent).click());
		return page.evaluate(() => ({ id: document.querySelector('.pane .tree-row.selected .id')?.textContent, toast: document.querySelector('.toast')?.textContent }));
	};
	assert.deepEqual(await nextProblemRow(), { id: 'dm1', toast: '경고 1/3\nID가 중복되었습니다. dm1 (2곳)' });
	assert.deepEqual(await nextProblemRow(), { id: 'dm1', toast: '경고 2/3\nID가 중복되었습니다. dm1 (2곳)' });
	await page.screenshot({path:path.join(tmpdir(), 'ws5-problem-toast.png')});
	assert.deepEqual(await nextProblemRow(), { id: 's1', toast: '경고 3/3\n등록되지 않은 handler가 적용되어 있습니다. scwin.s1_done' }, '접힌 Submission을 펼쳐 선택');
	assert.equal((await nextProblemRow()).toast, '경고 1/3\nID가 중복되었습니다. dm1 (2곳)', '마지막 다음은 처음');
	await page.evaluate(() => window.tab('Outline', '.pane').click());
	console.log('Data: 트리 끌어 옮기기, 화면 점검 경고 passed');
	await clickTab('Script');
	const marks = () => page.evaluate(() => {
		const body = document.querySelector('.tab-body:not([hidden])');
		const gutter = [...body.querySelectorAll('.cm-changes-gutter .cm-gutterElement')].flatMap(e => {
			const kind = e.querySelector('.cm-change')?.className.match(/cm-change-(\w+)/)?.[1];
			return kind ? [`${window.editor().state.doc.lineAt(window.editor().lineBlockAtHeight(e.offsetTop + 1).from).number}:${kind}`] : [];
		});
		return { gutter, ruler: [...body.querySelectorAll('.cm-change-ruler .cm-change-mark')].map(e => e.className.match(/cm-change-(\w+)$/)[1]) };
	});
	// 입력이 멈춘 뒤 다시 비교하므로 표시가 기대대로 바뀔 때까지 기다린다
	const marksAre = async (expected, label) => {
		for (let i = 0; i < 60 && JSON.stringify(await marks()) !== JSON.stringify(expected); i++) {
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		assert.deepEqual(await marks(), expected, label);
	};
	await reset('a\nB\nc\nd');
	await page.evaluate(() => window.send({ type: 'gitBase', target: 'script', text: 'a\r\nb\r\nc' }));
	await page.waitForFunction(() => document.querySelectorAll('.tab-body:not([hidden]) .cm-change-ruler .cm-change-mark').length === 2, {timeout: 3000})
		.catch(async () => assert.fail(`변경 표시 없음: ${JSON.stringify(await marks())}`));
	assert.deepEqual(await marks(), { gutter: ['2:modified', '4:added'], ruler: ['modified', 'added'] }, '수정·추가 (기준 CRLF도 줄 단위로)');
	await page.screenshot({path:path.join(tmpdir(), 'ws5-git-changes.png'), clip: await page.$eval('.tab-body:not([hidden]) .code-editor', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: 110 }; })});
	// 짧은 파일: 띠의 표시가 그 줄 높이에 있다
	assert.ok(await page.evaluate(() => {
		const body = document.querySelector('.tab-body:not([hidden])'), mark = body.querySelector('.cm-change-ruler .cm-change-mark').getBoundingClientRect();
		const line = window.editor().coordsAtPos(window.editor().state.doc.line(2).from);
		return Math.abs(mark.top - line.top) < 8;
	}), '띠 표시 위치 = 줄 위치');
	await page.evaluate(() => { const v = window.editor(); v.dispatch({ changes: { from: 0, to: 1, insert: 'A' } }); });
	await page.waitForFunction(() => document.querySelectorAll('.tab-body:not([hidden]) .cm-change-ruler .cm-change-mark').length === 2 && Math.abs(document.querySelector('.tab-body:not([hidden]) .cm-change-ruler .cm-change-mark').getBoundingClientRect().top - window.editor().coordsAtPos(0).top) < 8);
	await marksAre({ gutter: ['1:modified', '2:modified', '4:added'], ruler: ['modified', 'added'] }, '입력이 멈추면 다시 비교');
	await reset('a\nc');
	await marksAre({ gutter: ['2:deleted'], ruler: ['deleted'] }, '지운 줄은 그 아래 줄에 표시');
	await page.evaluate(() => window.send({ type: 'gitBase', target: 'script' }));
	await page.waitForFunction(() => !document.querySelector('.tab-body:not([hidden]) .cm-change-ruler .cm-change-mark'));
	assert.deepEqual((await marks()).gutter, [], '기준이 없으면(Git 밖) 표시 없음');
	// 연결 탭도 같은 방식(대상 link:{id})
	await page.evaluate(text => { window.send({ type: 'linked', kind: 'controller', path: 'src/A.java', text, version: 60 }); window.send({ type: 'gitBase', target: 'link:controller', text: text.replace('memberService.find(1)', 'x()') }); }, javaText);
	await clickTab('Controller');
	await page.waitForFunction(() => document.querySelectorAll('.tab-body:not([hidden]) .cm-change-ruler .cm-change-mark').length === 1, {timeout: 3000});
	assert.deepEqual(await marks(), { gutter: ['3:modified'], ruler: ['modified'] });
	console.log('Git changes: 수정·추가·삭제 표시·입력이 멈추면 갱신·연결 탭 passed');

	// 팔레트: 정의 기반 분류·검색·클릭 요청, Shadow DOM 캔버스 드롭·고정 버튼.
	await clickTab('Design');
	await page.evaluate(() => window.send({ type: 'tabPosition', position: 'top' }));
	await page.waitForFunction(() => document.querySelector('.canvas-frame').firstElementChild.classList.contains('tab-bar'));
	const paletteIds = await page.evaluate(() => {
		const extra = (id, category, realType = id) => ({ id, ns: 'urn:test', realType, display: id, category, parents: [], bases: [], properties: [], events: [] });
		const defs = window.testDefs.map(d => ({ ...d, display: d.display ?? d.id, category: d.realType === 'gridView' ? 'Grid' : d.realType === 'wframe' ? 'Frame' : 'Forms' }));
		defs.push(extra('group', 'Container'), ...['Chart', 'HTML5', 'Navigation', 'Others'].map(category => extra(category.toLowerCase(), category)), { ...extra('hidden-component', 'Forms'), hidden: true });
		window.paletteDefs = defs;
		window.send({ type: 'definitions', defs });
		const text = '<html xmlns:w2="urn:test"><body><w2:group id="group" style="height:180px;"><w2:input id="input" style="height:30px;width:120px;"/></w2:group><w2:gridView id="grid" style="height:70px;"><w2:header><w2:row><w2:column id="col" value="Column" width="120"/></w2:row></w2:header><w2:gBody><w2:row><w2:column id="cell"/></w2:row></w2:gBody></w2:gridView><w2:wframe id="frame" style="height:60px;"/></body></html>';
		const root = window.parseXml(text), ids = {};
		const walk = node => { ids[node.attrs.id ?? node.tag] = node.index; node.def = defs.findIndex(d => d.id === node.tag.split(':').at(-1)); node.children.forEach(walk); };
		walk(root);
		const frame = root.children[0].children[2];
		frame.frame = window.parseXml('<body><w2:input id="inner"/></body>'); frame.frame.children[0].def = 0;
		window.send({ type: 'document', version: 1000, text, root, script: { text: '' } });
		return ids;
	});
	assert.equal(await page.$('.palette-pane'), null, '처음에는 팔레트 접힘');
	assert.deepEqual(await page.$$eval('.canvas-frame .tab-bar > button', bs => bs.slice(0, 2).map(b => ({ name: b.className.split(' ')[0], draggable: b.draggable, tab: b.getAttribute('role') }))), [
		{ name: 'tab-palette', draggable: false, tab: null }, { name: 'tab-move', draggable: false, tab: null },
	], '팔레트·화살표는 정렬 탭에 포함되지 않는다');
	await page.click('.tab-palette');
	await page.waitForSelector('.palette-pane');
	assert.deepEqual(await page.$$eval('.palette-category', bs => bs.map(b => b.textContent)), ['Chart', 'Container', 'Forms', 'Frame', 'Grid', 'HTML5', 'Navigation', 'Others']);
	assert.equal(await page.$('[data-component="hidden-component"]'), null, '숨긴 컴포넌트 제외');
	await page.evaluate(() => [...document.querySelectorAll('.palette-category')].find(b => b.textContent === 'Forms').click());
	assert.ok(await page.$('[data-component="input"] .codicon-edit'), '기존 컴포넌트 아이콘');
	await page.evaluate(index => {
		const shadow = [...document.querySelectorAll('.design-canvas div')].find(el => el.shadowRoot).shadowRoot;
		shadow.querySelector(`[data-wse="${index}"]`).click(); window.sent.length = 0;
	}, paletteIds.group);
	await page.click('[data-component="input"]');
	assert.deepEqual(await lastSent('insertComponent'), { type: 'insertComponent', version: 1000, index: paletteIds.group, component: { id: 'input', ns: 'urn:test', realType: 'input' } }, '클릭은 현재 선택 + 기존 위치 선택창 요청');
	await page.type('.palette-search input', 'radio');
	assert.deepEqual(await page.$$eval('.palette-category', bs => bs.map(b => b.textContent)), ['Forms']);
	await page.click('[data-component="radio"]');
	assert.equal((await lastSent('insertComponent')).component.realType, 'radio', 'select1 태그가 같은 Radio·SelectBox 구분');
	await page.$eval('.palette-search input', input => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); });
	await page.waitForFunction(() => document.querySelectorAll('.palette-category').length === 8);
	const paletteDrop = (index, ratio, invalid) => page.evaluate((index, ratio, invalid) => {
		const shadow = [...document.querySelectorAll('.design-canvas div')].find(el => el.shadowRoot).shadowRoot;
		const target = shadow.querySelector(`[data-wse="${index}"]`), source = document.querySelector('[data-component="input"]');
		const transfer = new DataTransfer(); source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
		if (invalid) { transfer.setData('application/x-websquare5-component', invalid); }
		const r = target.getBoundingClientRect(), y = r.top + r.height * ratio;
		const over = new DragEvent('dragover', { bubbles: true, composed: true, cancelable: true, dataTransfer: transfer, clientY: y });
		target.dispatchEvent(over); window.sent.length = 0;
		return new Promise(resolve => setTimeout(() => {
			const indicator = shadow.querySelector('.wse-frame.drop')?.className;
			target.dispatchEvent(new DragEvent('drop', { bubbles: true, composed: true, cancelable: true, dataTransfer: transfer, clientY: y }));
			source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
			resolve({ accepted: over.defaultPrevented, indicator, sent: window.sent.find(m => m.type === 'insertComponent') ?? null });
		}, 60));
	}, index, ratio, invalid);
	for (const [index, ratio, expected, position] of [[paletteIds.group, .5, paletteIds.group, 'inside'], [paletteIds.group, .1, paletteIds.group, 'before'], [paletteIds.group, .9, paletteIds.group, 'after'], [paletteIds.input, .1, paletteIds.input, 'before'], [paletteIds.input, .9, paletteIds.input, 'after'], [paletteIds.col, .5, paletteIds.grid, 'inside'], [paletteIds.body, .99, paletteIds.body, 'inside']]) {
		const dropped = await paletteDrop(index, ratio);
		if (index === paletteIds.col) { // 그리드는 형제 삽입만: 열 위치가 아니라 gridView 전체의 가장자리 기준.
			assert.equal(dropped.sent.index, paletteIds.grid); assert.ok(['before', 'after'].includes(dropped.sent.position));
		} else {
			assert.ok(dropped.accepted && dropped.indicator?.includes(position), '드롭 위치 표시: ' + position);
			assert.deepEqual(dropped.sent, { type: 'insertComponent', version: 1000, component: { id: 'input', ns: 'urn:test', realType: 'input' }, index: expected, position });
		}
	}
	const frameDrop = await paletteDrop(paletteIds.frame, .5);
	assert.equal(frameDrop.sent.index, paletteIds.frame, '연결 화면에는 형제로 넣는다');
	assert.ok(['before', 'after'].includes(frameDrop.sent.position));
	assert.equal((await paletteDrop(paletteIds.group, .5, '{bad json')).sent, null, '잘못된 드래그 데이터 거부');
	assert.equal((await paletteDrop(paletteIds.group, .5, JSON.stringify({ version: 1000, component: { id: 'hidden-component', ns: 'urn:test', realType: 'hidden-component' } }))).sent, null, '숨김 항목 드롭 거부');
	// 실제 마우스 HTML5 drag도 Shadow DOM으로 전달된다.
	await page.setDragInterception(true);
	const sourceComponent = await page.$('[data-component="input"]');
	const groupElement = (await page.evaluateHandle(index => [...document.querySelectorAll('.design-canvas div')].find(el => el.shadowRoot).shadowRoot.querySelector(`[data-wse="${index}"]`), paletteIds.group)).asElement();
	await page.evaluate(() => { window.sent.length = 0; });
	await sourceComponent.dragAndDrop(groupElement);
	assert.equal((await lastSent('insertComponent')).position, 'inside', '실제 마우스로 그룹 중앙에 놓기');
	await page.setDragInterception(false);
	// 고정 버튼을 움직여도 탭 순서 저장은 발생하지 않는다.
	for (const selector of ['.tab-palette', '.tab-move']) {
		const box = await (await page.$(selector)).boundingBox();
		await page.evaluate(() => { window.sent.length = 0; });
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 25, { steps: 4 }); await page.mouse.up();
		assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'setTabOrder')), false, '고정 버튼 드래그 제외');
	}
	await page.click('.tab-palette');
	await page.waitForFunction(() => !document.querySelector('.palette-pane'));
	await page.click('.tab-palette');
	await page.waitForSelector('.palette-pane');
	await page.evaluate(() => document.fonts.ready);
	assert.ok(await page.evaluate(() => document.fonts.check('16px codicon')), '컴포넌트·패널 버튼 아이콘 폰트 로드');
	await page.evaluate(() => [...document.querySelectorAll('.palette-category')].filter(b => ['Forms', 'Container'].includes(b.textContent)).forEach(b => b.click()));

	// 즐겨찾기는 삽입 버튼과 별 버튼을 분리하고, 항상 열린 상단 목록에 표시한다.
	await page.evaluate(() => { window.send({ type: 'paletteFavorites', keys: [] }); window.sent.length = 0; });
	// 캔버스의 기존 컴포넌트 이동: XML 이동 요청만 보내고 좌표/스타일은 편집하지 않는다.
	const canvasNodes = await page.evaluate(() => {
		const root = document.querySelector('.canvas-host').shadowRoot;
		const input = root.querySelector('input[data-wse]'), group = root.querySelector('[data-wse-id="group"]') ?? input.closest('[data-wse]')?.parentElement.closest('[data-wse]');
		const grid = root.querySelector('.w2grid[data-wse]');
		return { input: Number(input.dataset.wse), group: Number(group.dataset.wse), grid: Number(grid.dataset.wse) };
	});
	assert.equal(await page.evaluate(i => document.querySelector('.canvas-host').shadowRoot.querySelector(`[data-wse="${i}"]`).draggable, canvasNodes.input), true);
	const canvasDrag = async (from, to, ratio, drop = true) => page.evaluate(({ from, to, ratio, drop }) => {
		const root = document.querySelector('.canvas-host').shadowRoot;
		const source = root.querySelector(`[data-wse="${from}"]`), target = root.querySelector(`[data-wse="${to}"]`);
		const dataTransfer = new DataTransfer(), rect = target.getBoundingClientRect();
		source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
		target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientY: rect.top + rect.height * ratio }));
		const hint = root.querySelector('.wse-frame.drop')?.textContent;
		if (drop) { target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientY: rect.top + rect.height * ratio })); }
		source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
		return hint;
	}, { from, to, ratio, drop });
	await page.evaluate(() => { window.sent.length = 0; });
	await canvasDrag(canvasNodes.input, canvasNodes.grid, 0.1);
	assert.ok(await page.evaluate(({input,grid}) => window.sent.some(m => m.type === 'move' && m.dragged === input && m.target === grid && m.position === 'before'), canvasNodes), '컴포넌트 앞 이동');
	await canvasDrag(canvasNodes.input, canvasNodes.grid, 0.9);
	assert.ok(await page.evaluate(() => window.sent.some(m => m.type === 'move' && m.position === 'after')), '컴포넌트 뒤 이동');
	await canvasDrag(canvasNodes.input, canvasNodes.group, 0.5);
	assert.ok(await page.evaluate(() => window.sent.some(m => m.type === 'move' && m.position === 'inside')), '그룹 중앙으로 이동');
	await page.evaluate(() => { window.sent.length = 0; });
	await canvasDrag(canvasNodes.group, canvasNodes.input, 0.5);
	await canvasDrag(canvasNodes.input, canvasNodes.input, 0.5);
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'move')), false, '자기 자신·자손으로 이동 금지');
	await page.setDragInterception(true);
	const sourceMove = await page.evaluateHandle(i => document.querySelector('.canvas-host').shadowRoot.querySelector(`[data-wse="${i}"]`), canvasNodes.input);
	const targetMove = await page.evaluateHandle(i => document.querySelector('.canvas-host').shadowRoot.querySelector(`[data-wse="${i}"]`), canvasNodes.grid);
	await sourceMove.asElement().dragAndDrop(targetMove.asElement());
	await page.setDragInterception(false);
	await page.waitForFunction(() => window.sent.some(m => m.type === 'move'));
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'editAttr' || m.type === 'insertComponent')), false, '이동으로 좌표/스타일 변경·새 컴포넌트 삽입 없음');
	// 그리드는 이동 손잡이로: 칸에 마우스를 올리면 왼쪽 위에 손잡이, 끌면 그리드 이동(실제 마우스 끌기)
	const shadowQuery = sel => page.evaluateHandle(sel => document.querySelector('.canvas-host').shadowRoot.querySelector(sel), sel);
	await (await shadowQuery(`[data-wse="${canvasNodes.grid}"] td[data-wse], [data-wse="${canvasNodes.grid}"] th[data-wse]`)).asElement().hover();
	await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-grid-handle'), { timeout: 3000 });
	await page.screenshot({path:path.join(tmpdir(), 'ws5-grid-handle.png')});
	await page.evaluate(() => { window.sent.length = 0; });
	await page.setDragInterception(true);
	await (await shadowQuery('.wse-grid-handle')).asElement().dragAndDrop((await shadowQuery(`[data-wse="${canvasNodes.input}"]`)).asElement());
	await page.setDragInterception(false);
	await page.waitForFunction(g => window.sent.some(m => m.type === 'move' && m.dragged === g), { timeout: 3000 }, canvasNodes.grid)
		.catch(async () => assert.fail(`그리드 이동 안 됨: ${JSON.stringify(await page.evaluate(() => window.sent))}`));
	console.log('Design: 기존 컴포넌트 실제 드래그·앞/뒤/그룹 이동·자기 자신/자손 거부, 그리드 이동 손잡이 passed');
	await page.evaluate(i => document.querySelector('.canvas-host').shadowRoot.querySelector(`[data-wse="${i}"]`).click(), paletteIds.group);
	await page.evaluate(() => { window.sent.length = 0; });
	const categoryStar = type => `.palette-list section:not(.palette-favorites) .palette-row:has([data-component="${type}"]) .palette-star`;
	assert.equal(await page.$eval('.palette-favorites h2', el => el.textContent), '즐겨찾기');
	assert.equal(await page.$('.palette-favorites [aria-expanded], .palette-favorites summary'), null, '즐겨찾기는 아코디언이 아니다');
	await page.click(categoryStar('input'));
	await page.waitForSelector('.palette-favorites [data-component="input"]');
	assert.deepEqual(await lastSent('setPaletteFavorite'), { type: 'setPaletteFavorite', favorite: true, component: { id: 'input', ns: 'urn:test', realType: 'input' } });
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'insertComponent')), false, '별 클릭은 컴포넌트를 삽입하지 않는다');
	assert.equal(await page.$eval(categoryStar('input'), b => b.getAttribute('aria-pressed')), 'true');
	assert.ok(await page.$('.palette-favorites .codicon-star-full'), '선택한 별은 채워진 아이콘');
	assert.ok(await page.evaluate(() => document.querySelector('.palette-favorites').compareDocumentPosition(document.querySelector('.palette-category')) & Node.DOCUMENT_POSITION_FOLLOWING), '즐겨찾기가 분류 목록보다 먼저');
	await page.click('.palette-favorites [data-component="input"]');
	assert.equal((await lastSent('insertComponent')).index, paletteIds.group, '즐겨찾기 항목 클릭도 기존 선택 기준으로 삽입');
	await page.setDragInterception(true);
	await (await page.$('.palette-favorites [data-component="input"]')).dragAndDrop(groupElement);
	assert.equal((await lastSent('insertComponent')).position, 'inside', '즐겨찾기도 실제 마우스로 드롭');
	await page.setDragInterception(false);
	assert.notEqual(await page.$eval(categoryStar('input'), s => getComputedStyle(s).color), await page.$eval(categoryStar('radio'), s => getComputedStyle(s).color), '등록한 별은 테마 강조색');
	await page.click('.palette-favorites .palette-star');
	assert.equal(await page.$('.palette-favorites [data-component]'), null, '별을 다시 누르면 즐겨찾기 해제');
	assert.equal(await page.$eval(categoryStar('input'), b => b.getAttribute('aria-pressed')), 'false');
	assert.ok(await page.$(`${categoryStar('input')} .codicon-star-empty`), '해제한 별은 빈 아이콘');
	await page.click(categoryStar('radio'));
	assert.equal(await page.$eval(categoryStar('selectbox'), b => b.getAttribute('aria-pressed')), 'false', '같은 태그인 SelectBox와 Radio를 구분');
	await page.click(categoryStar('selectbox'));
	assert.equal(await page.$$eval('.palette-favorites [data-component]', bs => bs.length), 2);
	const favoriteOrder = () => page.$$eval('.palette-favorites .palette-component', buttons => buttons.map(b => b.dataset.component));
	assert.deepEqual(await favoriteOrder(), ['radio', 'selectbox']);
	assert.equal(await page.$eval('.palette-favorites .palette-drag-handle', b => b.textContent), '⠿', 'DataList와 같은 손잡이');
	await page.evaluate(() => { window.sent.length = 0; });
	const selectHandle = await page.$('.palette-favorites .palette-row:has([data-component="selectbox"]) .palette-drag-handle');
	const radioRow = await page.$('.palette-favorites .palette-row:has([data-component="radio"])');
	await page.setDragInterception(true);
	await selectHandle.dragAndDrop(radioRow);
	await page.setDragInterception(false);
	await page.waitForFunction(() => window.sent.some(m => m.type === 'reorderPaletteFavorites'));
	assert.deepEqual(await favoriteOrder(), ['selectbox', 'radio'], '손잡이 실제 드래그로 앞으로 이동');
	const reordered = await page.evaluate(() => window.sent.find(m => m.type === 'reorderPaletteFavorites').keys);
	assert.deepEqual(reordered.map(key => JSON.parse(key)[2]), ['selectbox', 'radio']);
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'insertComponent')), false, '정렬 손잡이는 캔버스 삽입을 요청하지 않는다');
	await page.evaluate(keys => window.send({ type: 'paletteFavorites', keys }), reordered);
	await page.click('.tab-palette'); await page.click('.tab-palette');
	assert.deepEqual(await favoriteOrder(), ['selectbox', 'radio'], '재개방 후 저장된 순서 유지');
	await page.focus('.palette-favorites .palette-drag-handle');
	await page.keyboard.press('ArrowDown');
	assert.deepEqual(await favoriteOrder(), ['radio', 'selectbox'], '손잡이 키보드 이동');
	await page.$eval('[aria-label="컴포넌트 검색"]', input => { input.value = 'Radio'; input.dispatchEvent(new Event('input', { bubbles: true })); });
	// React controlled input은 실제 키 입력으로 검색한다.
	await page.click('[aria-label="컴포넌트 검색"]'); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.type('Radio');
	const reorders = () => page.evaluate(() => window.sent.filter(m => m.type === 'reorderPaletteFavorites').length);
	const reorderCount = await reorders();
	await page.focus('.palette-favorites .palette-drag-handle'); await page.keyboard.press('ArrowDown');
	assert.equal(await reorders(), reorderCount, '검색 중 방향키는 보이는 즐겨찾기끼리만(숨은 항목과 자리 안 바꿈)');
	await page.click('[aria-label="컴포넌트 검색"]'); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace');
	assert.deepEqual(await favoriteOrder(), ['radio', 'selectbox'], '검색에 숨긴 즐겨찾기도 제자리에 보존');
	const restoredKey = JSON.stringify(['urn:test', 'input', 'input']);
	await page.evaluate(key => window.send({ type: 'paletteFavorites', keys: [key] }), restoredKey);
	await page.click('.tab-palette'); await page.click('.tab-palette');
	await page.waitForSelector('.palette-favorites [data-component="input"]');
	assert.equal(await page.$$eval('.palette-favorites [data-component]', bs => bs.length), 1, '저장소에서 받은 목록은 패널 재개방 후에도 유지');
	await page.evaluate(() => [...document.querySelectorAll('.palette-category')].find(b => b.textContent === 'Forms').click());
	assert.ok(await page.$$eval('.palette-star', stars => { const right = stars.filter(s => s.getClientRects().length && s.closest('.palette-row').getClientRects().length && s.getBoundingClientRect().width).map(s => s.getBoundingClientRect().right); return right.length > 1 && Math.max(...right) - Math.min(...right) < 1; }), '상단 목록·분류 목록의 별은 같은 우측 끝에 정렬');
	// 우측 패널은 DOM·탭 상태를 버리지 않고 라이브러리 API로 접는다.
	assert.ok(await page.$eval('.canvas-frame .tab-bar', bar => bar.lastElementChild.classList.contains('tab-panel-right')), '우측 토글은 탭 줄 맨 오른쪽');
	assert.deepEqual(await page.$eval('.tab-panel-right', b => ({ draggable: b.draggable, role: b.getAttribute('role') })), { draggable: false, role: null });
	const rightBefore = await page.evaluate(() => { window.rightPaneBefore = document.querySelector('.right-panel .pane'); return { width: document.querySelector('.right-panel').getBoundingClientRect().width, canvas: document.querySelector('.canvas-frame').getBoundingClientRect().width, active: [...document.querySelectorAll('.right-panel [role="tab"][aria-selected="true"]')].map(b => b.textContent) }; });
	await page.click('.tab-panel-right');
	// 버튼 상태는 패널 폭 변경 이벤트(onResize) 뒤에 바뀐다 → 둘 다 기다린다
	await page.waitForFunction(() => document.querySelector('.right-panel').getBoundingClientRect().width < 1 && document.querySelector('.tab-panel-right').getAttribute('aria-expanded') === 'false');
	assert.equal(await page.$eval('.right-panel-content', panel => panel.inert), true, '숨긴 패널은 키보드 포커스 대상에서 제외');
	assert.ok(await page.$eval('.canvas-frame', (frame, width) => frame.getBoundingClientRect().width > width + 100, rightBefore.canvas), '닫힌 패널의 공간은 캔버스가 사용');
	await page.click('.tab-panel-right');
	await page.waitForFunction(() => document.querySelector('.right-panel').getBoundingClientRect().width > 200);
	assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.right-panel [role="tab"][aria-selected="true"]')].map(b => b.textContent)), rightBefore.active, '재개방 후 선택한 우측 탭 유지');
	assert.equal(await page.evaluate(() => window.rightPaneBefore === document.querySelector('.right-panel .pane')), true, '패널 내용을 재생성하지 않는다');
	assert.ok(Math.abs(await page.$eval('.right-panel', panel => panel.getBoundingClientRect().width) - rightBefore.width) < 2, '재개방 후 원래 패널 폭 복원');
	const rightToggleBox = await (await page.$('.tab-panel-right')).boundingBox();
	await page.evaluate(() => { window.sent.length = 0; });
	await page.mouse.move(rightToggleBox.x + rightToggleBox.width / 2, rightToggleBox.y + rightToggleBox.height / 2); await page.mouse.down();
	await page.mouse.move(rightToggleBox.x - 80, rightToggleBox.y + 30, { steps: 4 }); await page.mouse.up();
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'setTabOrder')), false, '우측 토글은 끌어서 탭을 옮길 수 없다');
	console.log('Palette favorites: 별 정렬·등록/해제·상단 목록·복원·클릭/실제 드롭; 우측 패널 접기/펼치기·상태/폭 유지·드래그 제외 passed');

	if (process.env.PALETTE_SCREENSHOT) { await page.screenshot({ path: process.env.PALETTE_SCREENSHOT }); }
	console.log('Palette: 묶음·아이콘·검색·선택 기준 클릭·드롭 위치·실제 마우스 드롭·고정 버튼 passed');

	assert.deepEqual(errors, []);
} finally {
	await browser?.close();
	await new Promise(resolve => server.close(resolve));
}
