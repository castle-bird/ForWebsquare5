import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseXml, type XmlNode } from '../core/xmlModel';
import { annotate, parseComponents } from '../project/components';
import { convert, eclipseDeployRoots, findWpack, publish, readWpackConfig } from '../project/wpack';
import { scopeCss } from '../project/styles';
import { engineModules, udcNames } from '../project/modules';
import { attachFrames } from '../project/frames';
import { loadApiDocs, parseApiEvents, parseApiMethods } from '../project/apiDocs';
import { SCREEN, DEFS } from './helpers';

suite('API documentation', () => {
	test('공개 HTML에서 메서드와 설명만 읽고 문서 경로 실패를 알림', async () => {
		const html = '<div><dt><a class="apisum_title">setValue( value )</a></dt><dd class="apisum_desc">값 &amp; 내용</dd></div><a class="dopsum_title">label</a>';
		assert.deepStrictEqual(parseApiMethods(html), [{ name: 'setValue', signature: 'setValue( value )', description: '값 & 내용' }]);
		const result = await loadApiDocs(path.join(os.tmpdir(), 'missing-ws-api-docs'));
		assert.deepStrictEqual(result.api, {});
		assert.ok(result.error);
	});

	test('상세 HTML에서 파라미터·반환값·샘플 코드까지 파싱', () => {
		const html = `<dl>
			<dt class="apiname">bind( eventType , function )</dt>
			<dd>
				<div class="pdesc">테스트용 메서드 설명.</div>
				<table><caption>Parameter</caption><tr><td>name</td><td>type</td><td>required</td><td>description</td></tr><tr><td>eventType</td><td>String</td><td>Y</td><td>이벤트명</td></tr></table>
				<table><caption>Return</caption><tr><td>type</td><td>description</td></tr><tr><td>Boolean</td><td>성공 여부</td></tr></table>
				<xmp class="js sample">obj.bind("click", fn);</xmp>
			</dd>
		</dl>`;
		const methods = parseApiMethods(html);
		assert.strictEqual(methods.length, 1);
		assert.strictEqual(methods[0].name, 'bind');
		assert.strictEqual(methods[0].description, '테스트용 메서드 설명.');
		assert.deepStrictEqual(methods[0].params, [{ name: 'eventType', type: 'String', required: 'Y', description: '이벤트명' }]);
		assert.deepStrictEqual(methods[0].returns, [{ type: 'Boolean', description: '성공 여부' }]);
		assert.strictEqual(methods[0].sample, 'obj.bind("click", fn);');
	});

	test('이벤트 상세(ename/edesc)는 메서드와 클래스만 다르고 같은 모양 — 이벤트 핸들러 생성의 파라미터 이름 출처', () => {
		// 실제 API 문서 구조(3칸 Parameter: name/type/description, required 없음)
		const html = `<dl>
			<dt class="ename">onrowpositionchange</dt>
			<dd>
				<div class="edesc">테스트용 이벤트 설명.</div>
				<table><caption>Parameter</caption><tr><td>name</td><td>type</td><td>description</td></tr><tr><td>info</td><td>JSON</td><td>oldRowIndex, newRowIndex</td></tr></table>
				<div class="pdesc"><xmp class="js sample">function(info){}</xmp></div>
			</dd>
		</dl>`;
		const events = parseApiEvents(html);
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].name, 'onrowpositionchange');
		assert.strictEqual(events[0].description, '테스트용 이벤트 설명.');
		assert.deepStrictEqual(events[0].params, [{ name: 'info', type: 'JSON', required: '', description: 'oldRowIndex, newRowIndex' }]);
	});

	test('loadApiDocs: 같은 폴더는 폴더당 한 번만 읽고 파싱(화면을 열 때마다 100개 넘는 HTML을 다시 읽으면 느려짐)', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-apidocs-'));
		const pluginDir = path.join(dir, 'WebSquare.uiplugin.trigger');
		fs.mkdirSync(pluginDir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'index.html'), '');
		fs.writeFileSync(path.join(pluginDir, 'WebSquare.uiplugin.trigger.html'), '<dt class="apiname">first()</dt>');
		const first = await loadApiDocs(dir);
		assert.strictEqual(first.api['WebSquare.uiplugin.trigger']?.[0]?.name, 'first');
		// 디스크 내용이 바뀌어도(설치본은 실행 중 안 바뀐다는 전제) 캐시된 결과를 그대로 돌려준다
		fs.writeFileSync(path.join(pluginDir, 'WebSquare.uiplugin.trigger.html'), '<dt class="apiname">second()</dt>');
		const second = await loadApiDocs(dir);
		assert.strictEqual(second.api['WebSquare.uiplugin.trigger']?.[0]?.name, 'first', '두 번째 호출은 캐시된 결과');
	});
});

suite('UDC 선언', () => {
	test('config.xml <udc><requires><require as>를 읽고, 정의 없는 태그 중 선언된 것만 node.udc', async () => {
		const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-udc-'));
		fs.mkdirSync(path.join(webRoot, 'websquare'));
		fs.writeFileSync(path.join(webRoot, 'websquare', 'config.xml'), '<WebSquare><udc><requires><require as="udc_upload" src="/cm/udc/upload.xml" type="page"/></requires></udc></WebSquare>');
		const udcs = await udcNames(webRoot);
		assert.deepStrictEqual([...udcs], ['udc_upload']);
		const root = parseXml('<html xmlns:w2="http://www.inswave.com/websquare"><body><w2:udc_upload id="u"/><w2:checkbox id="c"/></body></html>')!;
		annotate(root, [], udcs);
		const [udc, unknown] = root.children[0].children;
		assert.deepStrictEqual([udc.udc, unknown.udc], [true, undefined]);
	});
});

suite('Engine modules', () => {
	test('config.xml <engine><module src>를 웹 루트 기준으로 읽고, 없는 파일은 failed로', async () => {
		const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-modules-'));
		fs.mkdirSync(path.join(webRoot, 'websquare'));
		fs.mkdirSync(path.join(webRoot, 'js'));
		fs.writeFileSync(path.join(webRoot, 'websquare', 'config.xml'), '<WebSquare><engine><module src="/js/common.js"/><module src="/js/missing.js"/></engine><module src="/js/outside.js"/></WebSquare>');
		fs.writeFileSync(path.join(webRoot, 'js', 'common.js'), 'window.app = {};');
		assert.deepStrictEqual(await engineModules(webRoot), { files: [{ path: '/js/common.js', text: 'window.app = {};' }], failed: ['/js/missing.js'] });
	});
});

suite('components', () => {
	const defs = parseComponents(DEFS);

	test('정의 파싱', () => {
		assert.strictEqual(defs.length, 6);
		assert.deepStrictEqual(defs[0].properties.map(p => [p.name, p.category, p.order, p.options]), [
			['label', 'Basic & ETC', 1, undefined], ['style', 'Style', 2, undefined], ['tagname', 'Style', 2, ['span', 'p']], ['disabled', 'Style', 2, ['true', 'false']],
		]);
		assert.deepStrictEqual([defs[0].display, defs[1].display], ['TextBox', undefined], '표시 이름 NULL은 없음');
		assert.deepStrictEqual(defs[0].events.map(e => e.name), ['onclick']);
		assert.deepStrictEqual([defs[2].parents, defs[2].bases], [['row'], ['gridView']]);
	});

	test('노드 ↔ 정의 매칭 (namespace·부모·상위 컴포넌트·appearance)', () => {
		const root = parseXml(`<html xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms">
			<w2:dataList><w2:columnInfo><w2:column id="a"/></w2:columnInfo></w2:dataList>
			<w2:gridView><w2:gBody><w2:row><w2:column id="b"/></w2:row></w2:gBody></w2:gridView>
			<w2:grid><w2:gBody><w2:row><w2:column id="c"/></w2:row></w2:gBody></w2:grid>
			<xf:select1 appearance="full"/><xf:select1 appearance="minimal"/>
			<w2:textbox/><textbox/>
		</html>`)!;
		annotate(root, defs);
		const byTag = (t: string) => { const out: XmlNode[] = []; const w = (n: XmlNode) => { if (n.tag === t) { out.push(n); } n.children.forEach(w); }; w(root); return out; };
		assert.deepStrictEqual(byTag('w2:column').map(n => n.def), [1, 2, 3]);
		assert.deepStrictEqual(byTag('xf:select1').map(n => n.def), [4, 5]);
		assert.strictEqual(byTag('w2:textbox')[0].def, 0);
		assert.strictEqual(byTag('textbox')[0].def, undefined, 'namespace가 다르면 매칭 안 됨');
	});
});

suite('styles', () => {
	test('CSS 범위(html/body) · url 웹 루트 기준 보정', () => {
		const root = path.join(os.tmpdir(), 'webroot');
		const css = 'html,body{margin:0} body .a, .tbl-body, .w2window_body{x:1} .i{background:url(../..//cm/img/a.png)} .d{background:url("data:image/png;base64,AA")}';
		const out = scopeCss(css, path.join(root, 'cm', 'css', 'base.css'), root, p => 'U:' + path.relative(root, p).split(path.sep).join('/'));
		assert.ok(out.startsWith(':host, .wse-page{margin:0}') || out.startsWith(':host,.wse-page{margin:0}'), out);
		assert.ok(out.includes('.wse-page .a'), out);
		assert.ok(out.includes('.tbl-body') && out.includes('.w2window_body'), 'body가 들어간 클래스명은 그대로');
		assert.ok(out.includes('url("U:cm/img/a.png")'), '../.. 가 웹 루트 밖으로 나가지 않음');
		assert.ok(out.includes('url("data:image/png;base64,AA")'), 'data: 는 그대로');
		const vars = scopeCss(':root{--a:1} :root.dark{--a:2}', path.join(root, 'base.css'), root, p => p);
		assert.ok(vars.includes(':host{--a:1}') && vars.includes(':host.dark{'), ':root 변수는 :host로 ' + vars);
	});
	test('외부 @import는 imports로, 내부 @import는 버림', () => {
		const root = path.join(os.tmpdir(), 'webroot');
		const css = '@import url("https://cdn.x/a.css"); @import url(https://cdn.x/b.css); @import \'https://cdn.x/c.css\'; @import "local.css"; .a{x:1}';
		const imports: string[] = [];
		const out = scopeCss(css, path.join(root, 'base.css'), root, p => p, imports);
		assert.deepStrictEqual(imports, ['https://cdn.x/a.css', 'https://cdn.x/b.css', 'https://cdn.x/c.css']);
		assert.ok(!out.includes('@import'), out);
	});
	test('문법 오류가 있어도 브라우저처럼 나머지 규칙은 적용하고 첫 오류 위치를 알림', () => {
		const root = path.join(os.tmpdir(), 'webroot');
		const errors: string[] = [];
		// 실제로 나온 오타 모양: `--x-height`를 `-` + 줄바꿈 + `-x-height`로
		const out = scopeCss(':root {\n  -\n  -x-height: 10px;\n}\nbody .a { color: red }', path.join(root, 'media.css'), root, p => p, undefined, errors);
		assert.ok(out.includes('.wse-page .a { color: red }') && out.includes(':host'), out);
		assert.deepStrictEqual(errors, ['3줄 Unknown word -x-height']);
	});
	test('선택자 속성값은 보존하고 따옴표 안 괄호가 있는 이미지 경로도 변환', () => {
		const root = path.join(os.tmpdir(), 'webroot');
		const out = scopeCss('body[data-name="html body"]:not(.x) { background: url( "../image/a(b).png" ) }',
			path.join(root, 'cm', 'base.css'), root, p => 'U:' + path.relative(root, p).split(path.sep).join('/'));
		assert.ok(out.includes('.wse-page[data-name="html body"]:not(.x)'), out);
		assert.ok(out.includes('url( "U:image/a(b).png" )'), out);
	});
});

suite('frames', () => {
	test('잘못된 URL의 frame만 실패하고 나머지 화면은 붙인다', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-frame-url-'));
		fs.writeFileSync(path.join(dir, 'ok.xml'), '<html><body><b/></body></html>');
		const defs = parseComponents('<WebSquare><components><component id="wframe" namespaceURI="urn:test" realType="wframe"/></components></WebSquare>');
		const root = parseXml('<html xmlns:w2="urn:test"><body><w2:wframe src="bad%.xml"/><w2:wframe src="ok.xml"/></body></html>')!;
		annotate(root, defs);
		await attachFrames(root, path.join(dir, 'main.xml'), dir, defs);
		const [bad, good] = root.children[0].children;
		assert.ok(bad.frameError?.includes('읽기 실패'));
		assert.strictEqual(good.frame?.children[0].tag, 'b');
	});

	test('wframe 화면 붙이기 · 순환 참조 차단', async () => {
		const defs = parseComponents(`<WebSquare><components>
			<component id="wframe" namespaceURI="http://www.inswave.com/websquare" realType="wframe"/>
		</components></WebSquare>`);
		const screen = (src: string) => `<html xmlns:w2="http://www.inswave.com/websquare"><body><w2:wframe src="${src}"/></body></html>`;
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-frame-'));
		fs.mkdirSync(path.join(dir, 'ui'));
		fs.writeFileSync(path.join(dir, 'ui', 'A.xml'), screen('../cm/B.xml'));
		fs.mkdirSync(path.join(dir, 'cm'));
		fs.writeFileSync(path.join(dir, 'cm', 'B.xml'), screen('/ui/A.xml'));
		const file = path.join(dir, 'ui', 'A.xml');
		const root = parseXml(fs.readFileSync(file, 'utf8'))!;
		annotate(root, defs);
		await attachFrames(root, file, dir, defs);
		const outer = root.children[0].children[0];
		assert.strictEqual(outer.frame?.tag, 'body', '상대 경로 src → B의 body');
		const inner = outer.frame!.children[0];
		assert.strictEqual(inner.frame, undefined);
		assert.ok(inner.frameError?.includes('순환'), '절대 경로 src(/ui/A.xml)가 다시 A → 순환 차단');

		// 더 깊은 화면의 `../../cm/...`은 websquare.html 기준으로 풀려 /cm을 가리킨다.
		const deep = path.join(dir, 'ui', 'X', 'Y', 'C.xml');
		fs.mkdirSync(path.dirname(deep), { recursive: true });
		fs.writeFileSync(deep, screen('../../cm/B.xml'));
		const deepRoot = parseXml(fs.readFileSync(deep, 'utf8'))!;
		annotate(deepRoot, defs);
		await attachFrames(deepRoot, deep, dir, defs);
		assert.strictEqual(deepRoot.children[0].children[0].frame?.tag, 'body');
	});

	test('탭 content의 src도 WFrame처럼 화면을 붙인다 (개발 가이드 16.7.1)', async () => {
		const defs = parseComponents(`<WebSquare><components>
			<component id="tabControl" namespaceURI="http://www.inswave.com/websquare" realType="tabControl"/>
			<component id="content" namespaceURI="http://www.inswave.com/websquare" realType="content"><parents><parent id="tabControl"/></parents></component>
		</components></WebSquare>`);
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-tab-'));
		fs.mkdirSync(path.join(dir, 'ui'));
		fs.writeFileSync(path.join(dir, 'ui', 'S.xml'), '<html><body><b/></body></html>');
		const file = path.join(dir, 'ui', 'M.xml');
		const root = parseXml(`<html xmlns:w2="http://www.inswave.com/websquare"><body><w2:tabControl>
			<w2:content src="S.xml" frameMode="wframePreload"/><w2:content/></w2:tabControl></body></html>`)!;
		annotate(root, defs);
		await attachFrames(root, file, dir, defs);
		const [linked, inline] = root.children[0].children[0].children;
		assert.strictEqual(linked.frame?.children[0].tag, 'b', 'src 화면 body');
		assert.strictEqual(inline.frame, undefined, 'src 없는 content는 그대로');
	});
});

suite('wpack', () => {
	// 임시 Eclipse 워크스페이스: <ws>/PRJ/WebContent (웹 루트) + <ws>/.metadata/.../tmp0/wtpwebapps/PRJ (배포본)
	const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-wpack-'));
	const webRoot = path.join(ws, 'PRJ', 'WebContent');
	const deploy = path.join(ws, '.metadata', '.plugins', 'org.eclipse.wst.server.core', 'tmp0', 'wtpwebapps', 'PRJ');
	fs.mkdirSync(path.join(webRoot, 'websquare'), { recursive: true });
	fs.mkdirSync(deploy, { recursive: true });
	fs.writeFileSync(path.join(webRoot, 'websquare', 'config.xml'),
		'<WebSquare><wpack use="true"><destRoot value="_out_"/><common name="com" value="true"/></wpack></WebSquare>');

	test('config.xml 설정 · Eclipse 배포본 탐색', async () => {
		assert.deepStrictEqual(await readWpackConfig(webRoot), { destRoot: '_out_', scopeCommon: 'com' });
		assert.deepStrictEqual(await eclipseDeployRoots(webRoot), [deploy]);
	});

	test('산출물 쓰기: 웹 루트 JS + 배포본 JS·XML', async () => {
		const rel = path.join('ui', 'A.xml');
		const files = await publish(webRoot, { destRoot: '_out_' }, rel, '<html/>', 'js');
		assert.deepStrictEqual(files, [path.join(webRoot, '_out_', 'ui', 'A.js'), path.join(deploy, '_out_', 'ui', 'A.js'), path.join(deploy, rel)]);
		assert.strictEqual(fs.readFileSync(path.join(deploy, rel), 'utf8'), '<html/>');
	});

	test('실제 변환 (개발팩 변환기가 있을 때만)', async function () {
		const exe = await findWpack(__dirname);
		if (!exe) {
			this.skip();
		}
		this.timeout(60_000);
		const js = await convert(exe!, { destRoot: '_wpack_' }, path.join('ui', 'T.xml'), SCREEN);
		assert.ok(js.includes('tbx_title'), js.slice(0, 200));
	});
});
