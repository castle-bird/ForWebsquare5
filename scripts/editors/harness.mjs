import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import cspPatchesPlugin from '../csp-patches-plugin.cjs';

export async function createHarness() {
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
		import {EditorView, showTooltip} from '@codemirror/view';
		import {EditorState} from '@codemirror/state';
		import {scriptTools, scriptLanguage} from './src/webview/editor/completions';
		import {signatureHelp} from './src/webview/editor/signatureHelp';
		window.testTools = {EditorState, EditorView, showTooltip, scriptTools, scriptLanguage, signatureHelp};
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
	`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'ts' },
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
<script nonce="test">window.leakedUndo=0; window.leakedSave=0; window.addEventListener('keydown',e=>{if(e.ctrlKey&&/^[zy]$/i.test(e.key)){window.leakedUndo++;} if(e.ctrlKey&&e.key==='s'){window.leakedSave++;}}); const versions={source:1,script:1}; window.addEventListener('message',e=>{if(e.data&&e.data.type==='document'){versions.source=versions.script=e.data.version;} if(e.data&&e.data.type==='linked'&&e.data.version){versions['link:'+e.data.kind]=e.data.version;}}); window.sent=[]; window.acquireVsCodeApi=()=>({postMessage(msg){msg=JSON.parse(JSON.stringify(msg));window.sent.push(msg);if(msg.type==='setCode'){const ok=msg.version===versions[msg.target]; if(ok){versions[msg.target]++;} setTimeout(()=>window.send({type:'codeAck',target:msg.target,ok,version:versions[msg.target]}),5);}else if(msg.type==='findFiles'){if(window.mockFiles){setTimeout(()=>window.send({type:'files',kind:msg.kind,files:window.mockFiles}),5);}}else if(msg.type==='signature'){setTimeout(()=>window.send({type:'signatureResult',id:msg.id,signature:window.remoteSignature?.(msg)}),5)}else if(msg.type==='hover'){setTimeout(()=>window.send({type:'hoverResult',id:msg.id,text:window.remoteHoverText?.(msg)}),5)}else if(msg.type==='complete'){setTimeout(()=>window.send({type:'completions',id:msg.id,...(window.remoteItems?window.remoteItems(msg):{items:[]})}),5);if(window.remoteDetails){const reply=()=>window.send({type:'completionDetails',id:msg.id,items:window.remoteDetails(msg)});if(window.pendingDetails){window.pendingDetails.push(reply);}else{setTimeout(reply,300);}}}else if(msg.type==='format'){setTimeout(()=>window.send({type:'formatted',target:msg.target,text:window.formatResult??'formatted();'}),5);}}});</script>
<script nonce="test" src="/editor.js"></script></body></html>`;
const server = createServer((req, res) => {
	const pathname = new URL(req.url, 'http://localhost').pathname;
	const asset = assets.get(pathname);
	res.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.ttf') ? 'font/ttf' : 'text/html');
	res.end(asset ?? html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	let browser;
	const close = async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); };
	try {
		// 스크롤바 폭도 실제 웹뷰와 같은 조건으로 검증한다.
		browser = await puppeteer.launch({ executablePath: chrome, headless: true, pipe: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
		return { browser, url: `http://127.0.0.1:${server.address().port}`, close };
	} catch (error) { await close(); throw error; }
}
