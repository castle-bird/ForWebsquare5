import type { CssRuleSource } from '../core/protocol';
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseXml, type XmlNode } from '../core/xmlModel';
import { annotate, parseComponents } from '../project/components';
import { convert, eclipseDeployRoots, findWpack, publish, readWpackConfig, wpackArgs } from '../project/wpack';
import { scopeCss } from '../project/styles';
import { engineModules, udcNames } from '../project/modules';
import { attachFrames } from '../project/frames';
import { cleanSample, loadApiDocs, parseApiEvents, parseApiMethods } from '../project/apiDocs';
import { SCREEN, DEFS } from './helpers';
import { cached, fromWebPath } from '../project/paths';
import { eclipseUsage, findInstalls, isInside, unescapeProperty } from '../project/discover';

suite('비동기 캐시', () => {
	test('이전 요청 실패가 교체된 캐시를 지우지 않는다', async () => {
		const cache = new Map<string, Promise<string>>();
		let rejectOld!: (error: Error) => void;
		const old = cached(cache, 'key', () => new Promise<string>((_resolve, reject) => { rejectOld = reject; }));
		cache.clear();
		const current = cached(cache, 'key', () => Promise.resolve('new'));
		rejectOld(new Error('old'));
		await assert.rejects(old);
		assert.strictEqual(cache.get('key'), current);
	});
});

suite('웹 경로 경계', () => {
	test('인코딩된 상위 경로는 거부하고 정상 상대·루트·유니코드 경로는 유지', () => {
		const root = path.resolve('web-root');
		for (const href of ['/%2e%2e%2fsecret.xml', '/%2e%2e%2fweb-root-other/file.xml', '/dir/%2e%2e%2f%2e%2e%2fsecret.xml']) {
			assert.throws(() => fromWebPath(root, href, '/screens/main.xml'), /웹 루트 밖/);
		}
		if (path.sep === '\\') {
			assert.throws(() => fromWebPath(root, '/%2e%2e%5csecret.xml', '/screens/main.xml'), /웹 루트 밖/);
		}
		assert.strictEqual(fromWebPath(root, '../img/a.png', '/screens/main.xml'), path.join(root, 'img', 'a.png'));
		assert.strictEqual(fromWebPath(root, '../img/a.png', '/screens/dir#1/main?2.xml'), path.join(root, 'screens', 'img', 'a.png'));
		assert.strictEqual(fromWebPath(root, '/images/한 글.png?x=1#icon', '/screens/main.xml'), path.join(root, 'images', '한 글.png'));
		assert.strictEqual(fromWebPath(root, '/..assets/a.png', '/screens/main.xml'), path.join(root, '..assets', 'a.png'));
		assert.throws(() => fromWebPath(root, '//evil.com/a.xml', '/screens/main.xml'), /웹 루트 밖/);
	});
});

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

	test('xmp 예제는 XML 태그·엔티티를 원문 그대로, 앞뒤 빈 줄·공통 들여쓰기·연속 빈 줄만 정리', () => {
		const html = `<dl>
			<dt class="apiname">getAllXML()</dt>
			<dd>
				<div class="pdesc">설명
<xmp class='js sample'>(관련 함수)
 getAllFilteredXML (필터를 무시하고 모든 데이터를 반환)</xmp></div>
				<div class="caption_sample">Sample</div>
				<div class="pdesc"><xmp class='js sample'>

		// 반환 값 예시


		<list id="dlt">
		    <map index="0"><name>손예진</name><rowStatus>R</rowStatus></map>
		    <note>a &lt; b &amp; c</note>
		</list>
</xmp></div>
			</dd>
			<dt class="apiname">getAllFilteredXML()</dt>
			<dd><div class="pdesc">설명<xmp class='js sample'>(관련 함수) getAllXML</xmp></div></dd>
		</dl>`;
		const [xml, filtered] = parseApiMethods(html);
		assert.strictEqual(xml.sample, '// 반환 값 예시\n\n<list id="dlt">\n    <map index="0"><name>손예진</name><rowStatus>R</rowStatus></map>\n    <note>a &lt; b &amp; c</note>\n</list>', 'Sample 제목 뒤의 xmp를 쓰고 태그는 보존');
		assert.strictEqual(filtered.sample, '(관련 함수) getAllXML', 'Sample 제목이 없으면 첫 xmp(이전 동작)');
		assert.strictEqual(cleanSample('\r\n\r\n  a\r\n    b\r\n\r\n\r\n\r\n  c  \r\n\r\n'), 'a\n  b\n\nc');
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
	test('CSS 규칙의 원본 파일·줄과 복합 선택자·조건을 보존하고 keyframes는 제외', () => {
		const root = path.join(os.tmpdir(), 'webroot'), file = path.join(root, 'base.css');
		const sources: CssRuleSource[] = [];
		const css = '/* note */\nbody .same { color: red; }\n@media (min-width: 600px) {\n @supports (display: grid) {\n  .parent > .same, #item { padding: 4px; }\n }\n}\n.same { color: blue; }\n@keyframes fade { from { opacity: 0; } to { opacity: 1; } }';
		scopeCss(css, file, root, p => p, undefined, undefined, sources);
		assert.deepStrictEqual(sources, [
			{ file, line: 1, ch: 0, selector: 'body .same', match: '.wse-page .same', media: [], supports: [] },
			{ file, line: 4, ch: 2, selector: '.parent > .same, #item', match: '.parent > .same, #item', media: ['(min-width: 600px)'], supports: ['(display: grid)'] },
			{ file, line: 7, ch: 0, selector: '.same', match: '.same', media: [], supports: [] },
		]);
		const html: CssRuleSource[] = [];
		scopeCss('html body .same { margin: 1px; }', file, root, p => p, undefined, undefined, html);
		assert.strictEqual(html[0].match, '.wse-view .wse-page .same');
	});

	test('CSS 범위(html/body) · url 웹 루트 기준 보정', () => {
		const root = path.join(os.tmpdir(), 'webroot');
		const css = 'html,body{margin:0} body .a, .tbl-body, .w2window_body{x:1} .i{background:url(../..//cm/img/a.png)} .d{background:url("data:image/png;base64,AA")}';
		const out = scopeCss(css, path.join(root, 'cm', 'css', 'base.css'), root, p => 'U:' + path.relative(root, p).split(path.sep).join('/'));
		assert.ok(out.startsWith(':host, .wse-page{margin:0}') || out.startsWith(':host,.wse-page{margin:0}'), out);
		assert.ok(out.includes('.wse-page .a'), out);
		assert.ok(out.includes('.tbl-body') && out.includes('.w2window_body'), 'body가 들어간 클래스명은 그대로');
		assert.ok(out.includes('url("U:cm/img/a.png")'), '../.. 가 웹 루트 밖으로 나가지 않음');
		assert.ok(out.includes('url("data:image/png;base64,AA")'), 'data: 는 그대로');
		const bad = scopeCss('.x{background:url(%zz.png)} .y{background:url(b.png)}', path.join(root, 'base.css'), root, p => 'U:' + path.relative(root, p));
		assert.ok(bad.includes('url(%zz.png)') && bad.includes('url("U:b.png")'), '잘못된 url 하나는 그대로 두고 나머지는 보정 ' + bad);
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

	test('다시 붙일 때 바뀐 하위 화면은 새로 읽고, 그대로면 매번 새 트리를 만든다', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-frame-cache-'));
		const child = path.join(dir, 'child.xml');
		fs.writeFileSync(child, '<html><body><b/></body></html>');
		const defs = parseComponents('<WebSquare><components><component id="wframe" namespaceURI="urn:test" realType="wframe"/></components></WebSquare>');
		const attach = async () => {
			const root = parseXml('<html xmlns:w2="urn:test"><body><w2:wframe src="child.xml"/></body></html>')!;
			annotate(root, defs);
			await attachFrames(root, path.join(dir, 'main.xml'), dir, defs);
			return root.children[0].children[0].frame!;
		};
		const first = await attach(), again = await attach();
		assert.strictEqual(again.children[0].tag, 'b');
		assert.notStrictEqual(again, first, '이전 트리(annotate로 고친)를 재사용하지 않음');

		fs.writeFileSync(child, '<html><body><i/><i/></body></html>');
		fs.utimesSync(child, new Date(), new Date(Date.now() + 5000));
		assert.strictEqual((await attach()).children[0].tag, 'i', '저장된 변경 반영');
	});
});

suite('wpack', () => {
	test('변환 산출물 경로가 웹 루트를 벗어나면 거부한다', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-wpack-boundary-'));
		const webRoot = path.join(root, 'web');
		fs.mkdirSync(webRoot);
		await assert.rejects(publish(webRoot, { destRoot: '../outside' }, 'screen.xml', '<html/>', 'js'));
		await assert.rejects(publish(webRoot, { destRoot: 'out' }, '../../outside.xml', '<html/>', 'js'));
	});
	test('destRoot 앞의 / · \\는 웹 루트 기준으로 읽어 산출물을 웹 루트 안에 쓴다', async () => {
		for (const [value, destRoot] of [['/_out_', '_out_'], ['\\_out_', '_out_'], ['/', '.']]) {
			const webRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-wpack-dest-')), 'web');
			fs.mkdirSync(path.join(webRoot, 'websquare'), { recursive: true });
			fs.writeFileSync(path.join(webRoot, 'websquare', 'config.xml'), `<WebSquare><wpack use="true"><destRoot value="${value}"/></wpack></WebSquare>`);
			const config = await readWpackConfig(webRoot);
			assert.strictEqual(config?.destRoot, destRoot, value);
			assert.deepStrictEqual(await publish(webRoot, config!, 'screen.xml', '<html/>', 'js'), [path.join(webRoot, destRoot, 'screen.js')], value);
		}
	});
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

	test('변환기 탐색: 실행할 node.exe가 있는 w-pack/index.js 우선, 없으면 standalone exe, index.js만 있으면 그것', async () => {
		// 개발팩 구성: bin/w-pack(단독 exe, index.js 없음) + plugins/node(node.exe)/node_modules/w-pack(index.js)
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-find-wpack-'));
		const exe = path.join(root, 'bin', 'w-pack', 'standalone_wpack-win.exe');
		const nodeDir = path.join(root, 'plugins', 'node');
		const script = path.join(nodeDir, 'node_modules', 'w-pack', 'index.js');
		const touch = (file: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ''); };
		touch(exe); touch(script);
		assert.strictEqual(await findWpack(root), exe, 'node.exe 없으면 exe');
		touch(path.join(nodeDir, 'node.exe'));
		assert.strictEqual(await findWpack(root), script, 'node.exe 있으면 exe가 있어도 index.js 먼저');
		fs.rmSync(path.dirname(exe), { recursive: true });
		assert.strictEqual(await findWpack(root), script, 'index.js만 있어도 그것');
		fs.rmSync(path.join(nodeDir, 'node.exe'));
		assert.strictEqual(await findWpack(root), script, 'node.exe가 없어도 index.js는 반환(변환할 때 이유를 알림)');
		fs.rmSync(path.dirname(script), { recursive: true });
		assert.strictEqual(await findWpack(root), undefined);
	});

	test('변환기 인자: 공통 함수 치환은 exe·index.js 모두 -sc', () => {
		const dirs = ['/p/src', '/p/dest'] as const;
		const exeArgs = wpackArgs('/w/standalone_wpack-win.exe', { destRoot: 'd', scopeCommon: 'com' }, ...dirs);
		const scriptArgs = wpackArgs('/w/index.js', { destRoot: 'd', scopeCommon: 'com' }, ...dirs);
		assert.deepStrictEqual(exeArgs.slice(-2), ['-sc', 'com']);
		assert.deepStrictEqual(scriptArgs, ['/w/index.js', ...exeArgs]);
		assert.ok(!wpackArgs('/w/index.js', { destRoot: 'd' }, ...dirs).includes('-sc'), '공통 설정이 없으면 옵션 없음');
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

suite('설치본 자동 탐색', () => {
	const mkdir = (...parts: string[]) => fs.mkdirSync(path.join(...parts), { recursive: true });

	test('plugins에 com.inswave.* 플러그인이 있는 Eclipse 폴더를 얕은 것부터 찾고, 시스템·의존성·숨김 폴더는 건너뜀', async () => {
		const drive = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-drive-'));
		// 개발팩처럼 plugins가 4단계 아래인 곳과 eclipse처럼 3단계 아래인 곳, 폴더 이름은 제각각
		mkdir(drive, 'WS5_PACK', 'bin', 'studio', 'plugins', 'com.inswave.websquare.resource_1.0');
		mkdir(drive, 'tools', 'eclipse', 'plugins', 'com.inswave.node.win32_16');
		// WebSquare5 플러그인이 없는 Eclipse, 건너뛰는 곳에 있는 설치본
		mkdir(drive, 'plain-eclipse', 'plugins', 'org.eclipse.core_1.0');
		mkdir(drive, 'proj', 'node_modules', 'x', 'plugins', 'com.inswave.websquare.a');
		mkdir(drive, 'Users', 'me', 'AppData', 'eclipse', 'plugins', 'com.inswave.websquare.a');
		mkdir(drive, '.hidden', 'eclipse', 'plugins', 'com.inswave.websquare.a');
		const { installs, complete } = await findInstalls([drive]);
		assert.ok(complete);
		assert.deepStrictEqual(installs, [path.join(drive, 'tools', 'eclipse'), path.join(drive, 'WS5_PACK', 'bin', 'studio')]);
		assert.deepStrictEqual((await findInstalls([drive], { maxDepth: 3 })).installs, [path.join(drive, 'tools', 'eclipse')], '깊이 제한');
	});

	test('시간이 지나거나 취소되면 그때까지 찾은 것만(다 보지 못했다고 알림)', async () => {
		const drive = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-drive-'));
		mkdir(drive, 'eclipse', 'plugins', 'com.inswave.websquare.a');
		assert.deepStrictEqual(await findInstalls([drive], { deadline: Date.now() - 1 }), { installs: [], complete: false });
		assert.deepStrictEqual(await findInstalls([drive], { cancelled: () => true }), { installs: [], complete: false });
	});

	test('설치본 사용 흔적: 연 작업 공간(RECENT_WORKSPACES, 한글·여러 개)과 마지막 실행 시각', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-eclipse-'));
		const settings = path.join(root, 'configuration', '.settings');
		mkdir(settings);
		mkdir(root, 'configuration', 'org.eclipse.osgi');
		const used = new Date('2026-01-02T03:04:05Z');
		fs.utimesSync(path.join(root, 'configuration', 'org.eclipse.osgi'), used, used);
		fs.utimesSync(path.join(root, 'configuration'), new Date(0), new Date(0));
		// Eclipse가 쓰는 형식: Java properties 이스케이프, 한글은 \uXXXX, 작업 공간은 \n으로 구분
		fs.writeFileSync(path.join(settings, 'org.eclipse.ui.ide.prefs'),
			'MAX_RECENT_WORKSPACES=10\r\nRECENT_WORKSPACES=D\\:\\\\eGov4\\\\workspace\\nD\\:\\\\\\uD504\\uB85C\\uC81D\\uD2B8\\\\ws\r\nRECENT_WORKSPACES_PROTOCOL=3\r\n', 'latin1');
		assert.deepStrictEqual(await eclipseUsage(root), { lastUsed: used.getTime(), workspaces: ['D:\\eGov4\\workspace', 'D:\\프로젝트\\ws'] });
		assert.deepStrictEqual(await eclipseUsage(path.join(root, 'none')), { lastUsed: 0, workspaces: [] }, '흔적이 없으면 0·빈 목록');
		assert.strictEqual(unescapeProperty('C\\:\\\\a\\tb\\u0041'), 'C:\\a\tbA');
	});

	test('경로 포함 판단: 같은 폴더·하위는 안, 이름만 비슷한 옆 폴더는 밖', () => {
		const ws = path.resolve('eGov', 'workspace');
		assert.ok(isInside(path.join(ws, 'proj', 'webapp'), ws));
		assert.ok(isInside(ws, ws));
		assert.ok(!isInside(path.resolve('eGov', 'workspace2', 'proj'), ws));
		assert.ok(!isInside(path.resolve('eGov'), ws));
	});
});
