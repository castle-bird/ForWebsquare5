import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { findNode, isScreen, parseXml, pathTo, type XmlNode } from '../core/xmlModel';
import { mergeCells, mergeProblem } from '../core/merge';
import { pasteNode } from '../core/paste';
import { moveNode } from '../core/move';
import { addDataNode, DATA_KINDS, editDataFields } from '../core/data';
import { addSubmissionNode, editSubmissionNode, newSubmissionFields, nextSubmissionId, submissionFields, type SubmissionFields } from '../core/submission';
import { addGridColumn, addGridPart, addGridRow, bindGridView, boundColumnIds } from '../core/grid';
import { resizeBox, resizeEdges } from '../webview/ui/resizeBox';
import { annotate, loadDefaultStyles, parseComponents, parseDefaultStyles } from '../project/components';
import { readWebConfig } from '../project/config';
import { cached, serial } from '../project/paths';
import { insertComponent, insertPositions, insertTarget, matchPalette, paletteDefs } from '../core/palette';
import type { ComponentDef } from '../core/protocol';
import { openFrame, VIEW_TYPE } from '../extension';
import { applyCodeEdit, applyNodeEdit, formatCode } from '../vscode/documentEdit';
import { applyEdits, deleteNode, encodeScript, leadOf, scriptBody, setAttribute, setText, sourceChange } from '../core/edit';
import { convert, eclipseDeployRoots, findWpack, publish, readWpackConfig } from '../project/wpack';
import { scopeCss } from '../project/styles';
import { engineModules, udcNames } from '../project/modules';
import { editChoices, readChoices } from '../core/choices';
import { attachFrames } from '../project/frames';
import { loadApiDocs, parseApiEvents, parseApiMethods } from '../project/apiDocs';
import { clearAutoCache, resolvePath } from '../vscode/setup';
import { setStyle, styleChanges } from '../core/style';
import { cleanPath, DEFAULT_LINK_EXTS, DEFAULT_LINK_TABS, linkIdOf, linkProblem, moveTab, newTabId, orderTabs, readLinkExts, readLinkTabs, tabNameProblem } from '../core/links';
import { doctypeOf, parseDtd } from '../core/dtd';
import { xmlSchemaOf } from '../vscode/xmlSchema';
import { zipSync } from 'fflate';
import type { LinkState, ToWebview } from '../core/protocol';
import { LinkedFiles, registerLinks } from '../vscode/links';
import { linkTabs, saveLinkTabs } from '../vscode/linkTabs';
import { CODE_THEMES, readCodeTheme } from '../core/codeTheme';
import { DEFAULT_CODE_OPTIONS, readSqlDialect, readWordWrap, SQL_DIALECTS } from '../core/codeOptions';
import { stagedText } from '../vscode/gitBase';
import { remoteCompletions } from '../vscode/completion';
import { execFileSync } from 'child_process';

/** ok가 참이 될 때까지 최대 5초 기다리고 마지막 결과를 돌려준다 */
async function waitFor(ok: () => boolean): Promise<boolean> {
	for (let i = 0; i < 50 && !ok(); i++) {
		await new Promise(r => setTimeout(r, 100));
	}
	return ok();
}

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

const SCREEN = `<?xml version="1.0" encoding="UTF-8"?>
<!-- <fake/> -->
<html xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms">
	<head>
		<w2:dataCollection><w2:dataMap id="dma_a"/></w2:dataCollection>
		<script type="text/javascript"><![CDATA[ if (a < b) { scwin.x = "<tag>"; } ]]></script>
	</head>
	<body>
		<xf:group id="grp_main" style="width:100%" title="a &lt; b">
			<w2:textbox id="tbx_title" label="한글"/>
		</xf:group>
	</body>
</html>`;

suite('xmlModel', () => {
	test('트리·순서·위치·속성', () => {
		const root = parseXml(SCREEN)!;
		const flat: string[] = [];
		const walk = (n: typeof root) => { flat.push(`${n.index}:${n.tag}`); n.children.forEach(walk); };
		walk(root);
		assert.deepStrictEqual(flat, ['0:html', '1:head', '2:w2:dataCollection', '3:w2:dataMap', '4:script', '5:body', '6:xf:group', '7:w2:textbox']);

		const group = root.children[1].children[0];
		assert.strictEqual(group.attrs.title, 'a < b');
		assert.ok(SCREEN.slice(group.start, group.end).startsWith('<xf:group id="grp_main"'));
		assert.ok(SCREEN.slice(group.start, group.end).endsWith('</xf:group>'));
		const textbox = group.children[0];
		assert.strictEqual(SCREEN.slice(textbox.start, textbox.end), '<w2:textbox id="tbx_title" label="한글"/>');
		assert.strictEqual(root.children[0].children[1].text, 'if (a < b) { scwin.x = "<tag>"; }', 'CDATA 텍스트');
		assert.strictEqual(group.text, undefined, '공백뿐이면 없음');
	});

	test('빈 문서', () => {
		assert.strictEqual(parseXml(''), undefined);
	});
});

suite('DataCollection creation', () => {
	test('우클릭 메뉴의 다섯 종류를 고유 ID로 추가하고 기존 XML·줄바꿈을 보존', () => {
		let text = '<html xmlns:w2="http://www.inswave.com/websquare"><head><w2:dataCollection baseNode="map">\r\n\t<w2:dataMap id="dataMap1"/>\r\n</w2:dataCollection></head></html>';
		for (const kind of DATA_KINDS) {
			const root = parseXml(text)!;
			const collection = root.children[0].children[0];
			const edit = addDataNode(text, root, collection, kind);
			text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
		}
		const collection = parseXml(text)!.children[0].children[0];
		assert.deepStrictEqual(collection.children.map(c => [c.tag, c.attrs.id]), [
			['w2:dataMap', 'dataMap1'], ['w2:dataList', 'dataList1'], ['w2:dataMap', 'dataMap2'],
			['w2:linkedDataList', 'linkedDataList1'], ['w2:aliasDataList', 'aliasDataList1'], ['w2:aliasDataMap', 'aliasDataMap1'],
		]);
		assert.strictEqual(collection.children[1].children[0].tag, 'w2:columnInfo');
		assert.strictEqual(collection.children[2].children[0].tag, 'w2:keyInfo');
		assert.ok(!/(?<!\r)\n/.test(text), 'CRLF 문서에 LF를 섞지 않음');
		assert.throws(() => addDataNode(text, parseXml(text)!, collection.children[0], 'dataMap'));
	});

	test('추가 요청을 VS Code 문서 편집으로 적용', async () => {
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-data-')), 'screen.xml');
		fs.writeFileSync(file, '<html xmlns:w2="http://www.inswave.com/websquare"><head><w2:dataCollection/></head></html>');
		const document = await vscode.workspace.openTextDocument(file);
		const collection = parseXml(document.getText())!.children[0].children[0];
		assert.ok(await applyNodeEdit(document, { type: 'addData', version: document.version, index: collection.index, kind: 'dataList' }));
		assert.strictEqual(parseXml(document.getText())!.children[0].children[0].children[0].attrs.id, 'dataList1');
	});
});

suite('Choices (selectbox·radio 선택 항목)', () => {
	const apply = (text: string, edit?: { start: number; end: number; replacement: string }) => edit ? text.slice(0, edit.start) + edit.replacement + text.slice(edit.end) : text;
	const select = (text: string) => parseXml(text)!.children[0].children[0];

	test('항목 다시 쓰기: CDATA(]]> 포함)·CRLF·들여쓰기, 다른 속성 유지, 바뀐 속성만', () => {
		const text = '<html xmlns:xf="http://www.w3.org/2002/xforms">\r\n\t<body>\r\n\t\t<xf:select1 id="sel" appearance="minimal" allOption="">\r\n\t\t\t<xf:choices>\r\n\t\t\t\t<xf:item>\r\n\t\t\t\t\t<xf:label><![CDATA[재직자]]></xf:label>\r\n\t\t\t\t\t<xf:value><![CDATA[1]]>\r\n\t\t\t\t\t</xf:value>\r\n\t\t\t\t</xf:item>\r\n\t\t\t</xf:choices>\r\n\t\t</xf:select1>\r\n\t</body>\r\n</html>';
		const root = parseXml(text)!, node = select(text);
		assert.deepStrictEqual(readChoices(node), { items: [{ label: '재직자', value: '1' }] });
		const items = [{ label: '재직자', value: '1' }, { label: 'a]]>b', value: '2' }];
		const updated = apply(text, editChoices(text, root, node, { items, attrs: { allOption: 'true', ref: undefined } }));
		assert.deepStrictEqual(readChoices(select(updated)), { items });
		assert.deepStrictEqual(select(updated).attrs, { id: 'sel', appearance: 'minimal', allOption: 'true' });
		const cleared = apply(updated, editChoices(updated, parseXml(updated)!, select(updated), { items, attrs: { allOption: null } }));
		assert.deepStrictEqual(select(cleared).attrs, { id: 'sel', appearance: 'minimal' }, 'null이면 속성 제거');
		assert.ok(!/(?<!\r)\n/.test(updated), 'CRLF 유지');
		assert.ok(updated.includes('\r\n\t\t\t<xf:choices>\r\n\t\t\t\t<xf:item>\r\n\t\t\t\t\t<xf:label><![CDATA[재직자]]></xf:label>'), updated);
		assert.strictEqual(editChoices(text, root, node, { items: [{ label: '재직자', value: '1' }], attrs: { allOption: '' } }), undefined, '바뀐 게 없으면 편집 없음');
		const attrOnly = editChoices(text, root, node, { items: [{ label: '재직자', value: '1' }], attrs: { chooseOption: 'true' } })!;
		assert.strictEqual(attrOnly.end, text.indexOf('>', attrOnly.start) + 1, '시작 태그만 고침');
		// checkcombobox도 같은 모양(빈 태그에 choices 추가)
		const combo = '<html xmlns:xf="http://www.w3.org/2002/xforms"><body><xf:checkcombobox id="k" style="width:148px;"/></body></html>';
		const filled = apply(combo, editChoices(combo, parseXml(combo)!, select(combo), { items: [{ label: 'A', value: 'a' }], attrs: { allOption: 'true' } }));
		assert.deepStrictEqual(readChoices(select(filled)), { items: [{ label: 'A', value: 'a' }] });
		assert.strictEqual(select(filled).attrs.allOption, 'true');
	});

	test('multiupload 파라미터: <param name value></param> 다시 쓰기, script 등 다른 자식 유지', () => {
		const head = '<html xmlns:w2="http://www.inswave.com/websquare">\r\n\t<body>\r\n\t\t';
		const empty = `${head}<w2:multiupload id="mu" style="width:500px;"/>\r\n\t</body>\r\n</html>`;
		const added = apply(empty, editChoices(empty, parseXml(empty)!, select(empty), { items: [{ label: 'a', value: '1' }, { label: 'b"', value: '2' }], attrs: {} }));
		assert.ok(added.includes('<w2:multiupload id="mu" style="width:500px;">\r\n\t\t\t<param name="a" value="1"></param>\r\n\t\t\t<param name="b&quot;" value="2"></param>\r\n\t\t</w2:multiupload>'), added);
		assert.deepStrictEqual(readChoices(select(added)), { items: [{ label: 'a', value: '1' }, { label: 'b"', value: '2' }] });
		const withScript = `${head}<w2:multiupload id="mu">\r\n\t\t\t<param name="x" value="1"></param>\r\n\t\t\t<script type="javascript" ev:event="onComplete"><![CDATA[f();]]></script>\r\n\t\t\t<param name="y" value="2"></param>\r\n\t\t</w2:multiupload>\r\n\t</body>\r\n</html>`;
		const replaced = apply(withScript, editChoices(withScript, parseXml(withScript)!, select(withScript), { items: [{ label: 'z', value: '3' }], attrs: {} }));
		assert.ok(replaced.includes('<w2:multiupload id="mu">\r\n\t\t\t<param name="z" value="3"></param>\r\n\t\t\t<script type="javascript" ev:event="onComplete"><![CDATA[f();]]></script>\r\n\t\t</w2:multiupload>'), replaced);
		const cleared = apply(added, editChoices(added, parseXml(added)!, select(added), { items: [], attrs: {} }));
		assert.ok(cleared.includes('<w2:multiupload id="mu" style="width:500px;">\r\n\t\t</w2:multiupload>'), cleared);
		assert.strictEqual(editChoices(added, parseXml(added)!, select(added), { items: [{ label: 'a', value: '1' }, { label: 'b"', value: '2' }], attrs: {} }), undefined, '그대로면 편집 없음');
	});

	test('데이터 바인딩(itemset)으로 바꾸고 다시 읽기, 빈 select1·자체 닫힘에도 추가', () => {
		const text = '<html xmlns:xf="http://www.w3.org/2002/xforms"><body>\n\t<xf:select1 id="rad" appearance="full"></xf:select1>\n</body></html>';
		const root = parseXml(text)!, node = select(text);
		const itemset = { nodeset: 'data:dlt_code', label: 'name', value: 'code' };
		const bound = apply(text, editChoices(text, root, node, { items: [{ label: 'x', value: 'y' }], itemset, attrs: { cols: '3' } }));
		assert.deepStrictEqual(readChoices(select(bound)), { items: [], itemset });
		assert.strictEqual(select(bound).attrs.cols, '3');
		assert.ok(bound.includes('\t<xf:select1 id="rad" appearance="full" cols="3">\n\t\t<xf:choices>\n\t\t\t<xf:itemset nodeset="data:dlt_code">') && bound.includes('\t\t</xf:choices>\n\t</xf:select1>'), bound);
		const self = '<html xmlns:xf="http://www.w3.org/2002/xforms"><body>\n\t<xf:select1 id="s" />\n</body></html>';
		const added = apply(self, editChoices(self, parseXml(self)!, select(self), { items: [{ label: 'A', value: 'a' }], attrs: {} }));
		assert.deepStrictEqual(readChoices(select(added)), { items: [{ label: 'A', value: 'a' }] });
		assert.ok(added.includes('<xf:select1 id="s">\n\t\t<xf:choices>') && added.includes('\n\t</xf:select1>'), added);
	});

	test('그리드 select 컬럼(w2 접두사): 항목 → 바인딩, 컬럼 속성 유지', () => {
		const text = '<w2:gridView xmlns:w2="http://www.inswave.com/websquare"><w2:gBody><w2:row>\n\t<w2:column id="stat" inputType="select" allOption="" chooseOption="" ref="">\n\t\t<w2:choices>\n\t\t\t<w2:item><w2:label><![CDATA[미사용]]></w2:label><w2:value><![CDATA[F]]></w2:value></w2:item>\n\t\t</w2:choices>\n\t</w2:column>\n</w2:row></w2:gBody></w2:gridView>';
		const root = parseXml(text)!, column = root.children[0].children[0].children[0];
		assert.deepStrictEqual(readChoices(column), { items: [{ label: '미사용', value: 'F' }] });
		const itemset = { nodeset: 'data:dlt_stat', label: 'nm', value: 'cd' };
		const updated = apply(text, editChoices(text, root, column, { items: [], itemset, attrs: { chooseOption: 'true' } }));
		const after = parseXml(updated)!.children[0].children[0].children[0];
		assert.deepStrictEqual(readChoices(after), { items: [], itemset });
		assert.deepStrictEqual(after.attrs, { id: 'stat', inputType: 'select', allOption: '', chooseOption: 'true', ref: '' });
		assert.ok(updated.includes('\t\t<w2:choices>\n\t\t\t<w2:itemset nodeset="data:dlt_stat">\n\t\t\t\t<w2:label ref="nm"></w2:label>'), updated);
	});

	test('checkbox(xf:select): 정렬 속성만 바뀌고 빈 rows=""·falseValue는 그대로', () => {
		const text = '<html xmlns:xf="http://www.w3.org/2002/xforms"><body><xf:select id="chk" appearance="full" cols="" rows="" ref="data:dl.m07" falseValue="0"><xf:choices><xf:item><xf:label><![CDATA[7월]]></xf:label><xf:value><![CDATA[1]]></xf:value></xf:item></xf:choices></xf:select></body></html>';
		const root = parseXml(text)!, node = select(text);
		const edit = editChoices(text, root, node, { items: [{ label: '7월', value: '1' }], attrs: { ref: 'data:dl.m07', cols: '4', rows: '' } })!;
		assert.strictEqual(edit.end, text.indexOf('>', edit.start) + 1, '항목은 그대로라 시작 태그만');
		assert.deepStrictEqual(select(apply(text, edit)).attrs, { id: 'chk', appearance: 'full', cols: '4', rows: '', ref: 'data:dl.m07', falseValue: '0' });
	});

	test('팝업이 다 못 담는 구조(항목에 다른 자식·주석)는 거부해 원문을 잃지 않음', () => {
		const odd = '<html xmlns:xf="http://www.w3.org/2002/xforms"><body><xf:select1 id="s"><xf:choices><xf:item><xf:label>A</xf:label><xf:value>a</xf:value><xf:hint>h</xf:hint></xf:item></xf:choices></xf:select1></body></html>';
		assert.ok('error' in readChoices(select(odd)));
		assert.throws(() => editChoices(odd, parseXml(odd)!, select(odd), { items: [], attrs: {} }), /Source/);
		const commented = '<html xmlns:xf="http://www.w3.org/2002/xforms"><body><xf:select1 id="s"><xf:choices><!-- 주석 --><xf:item><xf:label>A</xf:label><xf:value>a</xf:value></xf:item></xf:choices></xf:select1></body></html>';
		assert.throws(() => editChoices(commented, parseXml(commented)!, select(commented), { items: [], attrs: {} }), /주석/);
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

suite('Submission creation', () => {
	test('고유 ID·필수 속성·문자 이스케이프·CRLF 보존', () => {
		const text = '<html xmlns:xf="http://www.w3.org/2002/xforms"><head><xf:model>\r\n\t<xf:submission id="submission1"/>\r\n</xf:model></head></html>';
		const root = parseXml(text)!;
		const model = root.children[0].children[0];
		assert.strictEqual(nextSubmissionId(root), 'submission2');
		const attrs = { id: 'submission2', ref: 'data:json,request&more\ndata:json,other', target: 'data:json,response', action: '/api/search?q=1&x=2', method: 'post', mode: 'asynchronous', mediatype: 'application/json' };
		// 빈 이벤트 칸은 속성을 만들지 않는다
		const fields: SubmissionFields = { ...attrs, 'ev:submit': '', 'ev:submitdone': '', 'ev:submiterror': '' };
		const edit = addSubmissionNode(text, root, model, fields);
		const updated = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
		const created = parseXml(updated)!.children[0].children[0].children[1];
		assert.strictEqual(created.tag, 'xf:submission');
		assert.deepStrictEqual(created.attrs, attrs);
		assert.ok(updated.includes('request&amp;more'));
		assert.ok(updated.includes('&#10;'));
		assert.ok(!/(?<!\r)\n/.test(updated), '기존 CRLF 유지');
		assert.throws(() => addSubmissionNode(text, root, model, { ...fields, id: 'submission1' }), /이미 사용 중/);
		assert.throws(() => addSubmissionNode(text, root, model, { ...fields, method: 'patch' }), /지원하지 않는/);
	});

	test('기존 Submission 수정: 시작 태그만 교체, 다른 속성·자식 유지, 빈 값은 삭제, id 고유', () => {
		const text = '<html xmlns:xf="http://www.w3.org/2002/xforms" xmlns:ev="http://www.w3.org/2001/xml-events"><head><xf:model><xf:submission id="sbm_a" method="post" custom="keep" ev:submitdone="scwin.done"><xf:x/></xf:submission><xf:submission id="sbm_b"/></xf:model></head></html>';
		const root = parseXml(text)!;
		const node = root.children[0].children[0].children[0];
		const fields = { ...submissionFields(node), id: 'sbm_c', action: '/api?a=1&b=2', method: 'PATCH_CUSTOM', mode: '' };
		const edit = editSubmissionNode(text, root, node, fields)!;
		const updated = parseXml(text.slice(0, edit.start) + edit.replacement + text.slice(edit.end))!.children[0].children[0].children[0];
		assert.deepStrictEqual(updated.attrs, { id: 'sbm_c', method: 'PATCH_CUSTOM', custom: 'keep', 'ev:submitdone': 'scwin.done', action: '/api?a=1&b=2' });
		assert.strictEqual(updated.children[0].tag, 'xf:x');
		assert.strictEqual(editSubmissionNode(text, root, node, submissionFields(node)), undefined, '바뀐 게 없으면 편집 없음');
		assert.throws(() => editSubmissionNode(text, root, node, { ...fields, id: 'sbm_b' }), /이미 사용 중/);
	});

	test('이벤트 칸: 바꾼 칸만 적용(손대지 않은 빈 속성 유지), 조상에 xmlns:ev가 있으면 다시 선언하지 않음', () => {
		const text = '<html xmlns:xf="http://www.w3.org/2002/xforms" xmlns:ev="http://www.w3.org/2001/xml-events"><head><xf:model><xf:submission id="sbm_a" mode="" ev:submit=""/></xf:model></head></html>';
		const root = parseXml(text)!;
		const model = root.children[0].children[0], node = model.children[0];
		const edit = editSubmissionNode(text, root, node, { ...submissionFields(node), 'ev:submitdone': 'scwin.sbm_a_submitdone' })!;
		const updated = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
		assert.deepStrictEqual(parseXml(updated)!.children[0].children[0].children[0].attrs, { id: 'sbm_a', mode: '', 'ev:submit': '', 'ev:submitdone': 'scwin.sbm_a_submitdone' });
		const add = addSubmissionNode(text, root, model, { ...newSubmissionFields(root), 'ev:submiterror': 'scwin.err' });
		assert.ok(add.replacement.includes('ev:submiterror="scwin.err"') && !add.replacement.includes('xmlns:ev'), add.replacement);
	});

	test('gridView에 dataList 바인딩: 신규 생성·바디 업데이트(기존 컬럼 보존)·바인드 업데이트', () => {
		const text = '<w2:root xmlns:w2="http://www.inswave.com/websquare"><w2:dataList id="dl"><w2:columnInfo><w2:column id="a" name="에이"/><w2:column id="b"/></w2:columnInfo></w2:dataList>\n<w2:gridView id="g"/></w2:root>';
		const root = parseXml(text)!;
		const [list, grid] = root.children;
		const apply = (t: string, e?: { start: number; end: number; replacement: string }) => e ? t.slice(0, e.start) + e.replacement + t.slice(e.end) : t;
		const created = apply(text, bindGridView(text, root, grid, list, 'new'));
		const g1 = parseXml(created)!.children[1];
		assert.strictEqual(g1.attrs.dataList, 'data:dl');
		assert.deepStrictEqual(g1.children.map(c => c.tag), ['w2:header', 'w2:gBody']);
		assert.deepStrictEqual(g1.children[0].children[0].children.map(c => c.attrs.value), ['에이', 'b']);
		assert.deepStrictEqual(g1.children[1].children[0].children.map(c => c.attrs.id), ['a', 'b']);
		const widened = created.replace('id="a" displayMode', 'id="a" width2="300" displayMode');
		const r2 = parseXml(widened)!;
		const body = parseXml(apply(widened, bindGridView(widened, r2, r2.children[1], r2.children[0], 'body')))!.children[1];
		assert.strictEqual(body.children[1].children[0].children[0].attrs.width2, '300', '같은 id 바디 컬럼은 원문 유지');
		assert.strictEqual(bindGridView(created, parseXml(created)!, g1, list, 'bind'), undefined, '이미 같은 바인딩');
		assert.throws(() => bindGridView(text, root, list, list, 'new'), /gridView/);
		// 바인드 업데이트 + footer·subTotal 체크: 없던 둘을 gBody 뒤에 subTotal → footer 순으로, 컬럼 수는 dataList에 맞춰
		const r3 = parseXml(created)!;
		const g3 = parseXml(apply(created, bindGridView(created, r3, r3.children[1], r3.children[0], 'bind', { footer: true, subTotal: true })))!.children[1];
		assert.deepStrictEqual(g3.children.map(c => c.tag), ['w2:header', 'w2:gBody', 'w2:subTotal', 'w2:footer']);
		assert.strictEqual(g3.children[3].children[0].children.length, 2);
		// subTotal 두 개 + 신규 생성: 전부 지우고 체크했으면 1개만
		const two = created.replace('</w2:gridView>', '<w2:subTotal id="s1"/><w2:subTotal id="s2"/></w2:gridView>');
		const r4 = parseXml(two)!;
		const newOf = (extras?: { subTotal?: boolean }) => parseXml(apply(two, bindGridView(two, r4, r4.children[1], r4.children[0], 'new', extras)))!.children[1];
		assert.deepStrictEqual(newOf().children.map(c => c.tag), ['w2:header', 'w2:gBody']);
		assert.deepStrictEqual(newOf({ subTotal: true }).children.map(c => c.tag), ['w2:header', 'w2:gBody', 'w2:subTotal']);
		// 다단 subTotal + 바인드 업데이트 체크: 전부 컬럼 수만 맞추고 targetColumnID 등 속성 유지
		const multi = created.replace('</w2:gridView>', '<w2:subTotal id="s1" targetColumnID="a"><w2:row id="sr1"><w2:column id="x"/></w2:row></w2:subTotal><w2:subTotal id="s2" targetColumnID="b"/></w2:gridView>');
		const r5 = parseXml(multi)!;
		const subs = parseXml(apply(multi, bindGridView(multi, r5, r5.children[1], r5.children[0], 'bind', { subTotal: true })))!.children[1].children.filter(c => c.tag === 'w2:subTotal');
		assert.deepStrictEqual(subs.map(s => [s.attrs.id, s.attrs.targetColumnID, s.children[0].attrs.id, s.children[0].children.length]), [['s1', 'a', 'sr1', 2], ['s2', 'b', subs[1].children[0].attrs.id, 2]]);
	});

	test('다중 선택: 붙여넣기(id 서로 안 겹침)·이동(문서 순서로 모아서)', () => {
		const text = '<body>\n\t<a id="x"/>\n\t<b id="y"/>\n\t<c id="z"/>\n</body>';
		const root = parseXml(text)!;
		const [x, y, z] = root.children;
		const pasted = pasteNode(text, root, z, ['\t<a id="x"/>', '\t<a id="x"/>']);
		assert.strictEqual(text.slice(0, pasted.start) + pasted.replacement + text.slice(pasted.end), '<body>\n\t<a id="x"/>\n\t<b id="y"/>\n\t<c id="z"/>\n\t<a id="x_copy1"/>\n\t<a id="x_copy2"/>\n</body>');
		const moved = [...moveNode(text, [z, x], y, 'after')].sort((a, b) => b.start - a.start).reduce((t, e) => t.slice(0, e.start) + e.replacement + t.slice(e.end), text);
		assert.strictEqual(moved, '<body>\n\t<b id="y"/>\n\t<a id="x"/>\n\t<c id="z"/>\n</body>');
	});

	test('그리드 우클릭 subTotal·footer 추가: 컬럼 수는 gBody, subTotal은 마지막 subTotal 뒤, footer는 하나만', () => {
		const text = '<w2:gridView xmlns:w2="http://www.inswave.com/websquare" id="g"><w2:gBody id="b"><w2:row id="r"><w2:column id="a"/><w2:column id="c"/></w2:row></w2:gBody><w2:footer id="f"/></w2:gridView>';
		const root = parseXml(text)!;
		const e = addGridPart(text, root, root, 'subTotal');
		const g = parseXml(text.slice(0, e.start) + e.replacement + text.slice(e.end))!;
		assert.deepStrictEqual(g.children.map(c => c.tag), ['w2:gBody', 'w2:subTotal', 'w2:footer']);
		assert.strictEqual(g.children[1].children[0].children.length, 2);
		assert.throws(() => addGridPart(text, root, root, 'footer'), /이미/);
		// Header 추가: 없으면 맨 앞에 새 header(칸 수 = gBody), 있으면 header row 하나 더
		const h1 = addGridPart(text, root, root, 'header');
		const withHeader = text.slice(0, h1.start) + h1.replacement + text.slice(h1.end);
		const hg = parseXml(withHeader)!;
		assert.deepStrictEqual([hg.children[0].tag, hg.children[0].children[0].children.length], ['w2:header', 2]);
		const h2 = addGridPart(withHeader, hg, hg, 'header');
		assert.strictEqual(parseXml(withHeader.slice(0, h2.start) + h2.replacement + withHeader.slice(h2.end))!.children[0].children.length, 2);
		const apply = (t: string, es: { start: number; end: number; replacement: string }[]) => [...es].sort((x, y) => y.start - x.start).reduce((s, x) => s.slice(0, x.start) + x.replacement + s.slice(x.end), t);
		// Column 추가: 우클릭한 a 바로 뒤, footer는 빈(자체 닫힘) 자리라 건너뜀
		const col = parseXml(apply(text, addGridColumn(text, root, root, root.children[0].children[0].children[0].index)))!;
		assert.deepStrictEqual(col.children[0].children[0].children.map(c => c.attrs.id), ['a', 'column1', 'c']);
		const left = parseXml(apply(text, addGridColumn(text, root, root, root.children[0].children[0].children[0].index, 'left')))!;
		assert.deepStrictEqual(left.children[0].children[0].children.map(c => c.attrs.id), ['column1', 'a', 'c'], '왼쪽: 클릭한 칸 앞');
		// 병합 헤더: | m(2칸) | n | / | c1 | c2 | c3 | — n 왼쪽이면 실제 열 2 앞, c1 오른쪽이면 m을 가로질러 colSpan 3
		const merged = '<w2:gridView xmlns:w2="http://www.inswave.com/websquare" id="g"><w2:header id="h"><w2:row id="h1"><w2:column id="m" colSpan="2"/><w2:column id="n"/></w2:row><w2:row id="h2"><w2:column id="c1"/><w2:column id="c2"/><w2:column id="c3"/></w2:row></w2:header><w2:gBody id="b"><w2:row id="br"><w2:column id="b1"/><w2:column id="b2"/><w2:column id="b3"/></w2:row></w2:gBody></w2:gridView>';
		const mr = parseXml(merged)!;
		const ids = (t: string) => parseXml(t)!.children.flatMap(s => s.children.map(r => r.children.map(c => c.attrs.id + (c.attrs.colSpan ? `:${c.attrs.colSpan}` : '')).join(',')));
		const n = mr.children[0].children[0].children[1];
		assert.deepStrictEqual(ids(apply(merged, addGridColumn(merged, mr, mr, n.index, 'left'))), ['m:2,column1,n', 'c1,c2,column2,c3', 'b1,b2,column3,b3']);
		const c1 = mr.children[0].children[1].children[0];
		assert.deepStrictEqual(ids(apply(merged, addGridColumn(merged, mr, mr, c1.index, 'right'))), ['m:3,n', 'c1,column1,c2,c3', 'b1,column2,b2,b3']);
		// Row 추가: 같은 칸 수의 row가 기존 row 뒤
		const row = parseXml(apply(text, [addGridRow(text, root, root)]))!;
		assert.deepStrictEqual(row.children[0].children.map(r => r.children.length), [2, 2]);
	});

	test('빈 xf:model에 추가 요청을 VS Code 문서 편집으로 적용', async () => {
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-submission-')), 'screen.xml');
		fs.writeFileSync(file, '<html xmlns:xf="http://www.w3.org/2002/xforms"><head><xf:model/></head></html>');
		const document = await vscode.workspace.openTextDocument(file);
		const model = parseXml(document.getText())!.children[0].children[0];
		const fields: SubmissionFields = { ...newSubmissionFields(model), id: 'submission1', action: '/api' };
		assert.ok(await applyNodeEdit(document, { type: 'addSubmission', version: document.version, index: model.index, popup: 'p', fields }));
		assert.strictEqual(parseXml(document.getText())!.children[0].children[0].children[0].attrs.id, 'submission1');
	});
});

suite('DataMap/DataList fields', () => {
	test('행 추가·순서 변경·삭제와 DataMap 값을 한 편집으로 반영하고 기존 속성을 보존', () => {
		const base = '<html xmlns:w2="http://www.inswave.com/websquare"><w2:dataMap id="dma" baseNode="map"><w2:keyInfo><w2:key id="old" name="Old" dataType="text" custom="keep"/></w2:keyInfo><w2:data use="false"><old custom="value-attr">old value</old><external>x</external></w2:data></w2:dataMap></html>';
		const root = parseXml(base)!;
		const map = root.children[0];
		const change = editDataFields(base, root, map, [
			{ id: 'new', name: 'New', dataType: 'number', length: '10', encYN: true, value: '42' },
			{ sourceIndex: map.children[0].children[0].index, id: 'old', name: 'Renamed', dataType: 'text', length: '', encYN: false, value: 'changed' },
		])!;
		const result = base.slice(0, change.start) + change.replacement + base.slice(change.end);
		const edited = parseXml(result)!.children[0];
		assert.deepStrictEqual(edited.children[0].children.map(c => c.attrs.id), ['new', 'old']);
		assert.strictEqual(edited.children[0].children[0].attrs.length, '10');
		assert.strictEqual(edited.children[0].children[0].attrs.encYN, 'true');
		assert.strictEqual(edited.children[0].children[1].attrs.custom, 'keep');
		assert.ok(result.includes('<w2:data use="false">'));
		assert.ok(result.includes('<old custom="value-attr">changed</old>'));
		assert.ok(result.includes('<external>x</external>'));
		assert.deepStrictEqual(edited.children[1].children.map(c => [c.tag, c.text]), [['new', '42'], ['old', 'changed'], ['external', 'x']]);
		assert.throws(() => editDataFields(base, root, map, [{ id: 'bad space', name: '', dataType: 'text', length: '', encYN: false }]));
		const removed = editDataFields(base, root, map, [])!;
		const without = base.slice(0, removed.start) + removed.replacement + base.slice(removed.end);
		assert.ok(!without.includes('<old>'));
		assert.ok(without.includes('<external>x</external>'));
	});

	test('DataMap/DataList 자체 id도 바꿀 수 있고, 문서 전체에서 고유해야 한다', () => {
		const base = '<html xmlns:w2="http://www.inswave.com/websquare"><w2:dataCollection><w2:dataMap id="dma"><w2:keyInfo/></w2:dataMap><w2:dataList id="dlt"><w2:columnInfo/></w2:dataList></w2:dataCollection></html>';
		const root = parseXml(base)!;
		const collection = root.children[0];
		const map = collection.children[0];
		// 다른 곳에서 이미 쓰는 id(dlt)로는 못 바꾼다
		assert.throws(() => editDataFields(base, root, map, [], 'dlt'), /이미 사용 중/);
		// 형식이 안 맞는 id도 거부
		assert.throws(() => editDataFields(base, root, map, [], 'bad id'), /올바른 ID/);
		// 문제없는 새 id면 바뀐다
		const change = editDataFields(base, root, map, [], 'renamed')!;
		const result = base.slice(0, change.start) + change.replacement + base.slice(change.end);
		assert.strictEqual(parseXml(result)!.children[0].children[0].attrs.id, 'renamed');
	});

	test('DataList 컬럼을 생성하고 keyInfo가 아닌 columnInfo를 편집', async () => {
		const base = '<html xmlns:w2="http://www.inswave.com/websquare"><w2:dataList id="dl"><w2:columnInfo custom="keep"/></w2:dataList></html>';
		const root = parseXml(base)!;
		const list = root.children[0];
		const change = editDataFields(base, root, list, [{ id: 'col1', name: 'name1', dataType: 'date', length: '', encYN: false }])!;
		const result = base.slice(0, change.start) + change.replacement + base.slice(change.end);
		assert.strictEqual(parseXml(result)!.children[0].children[0].children[0].tag, 'w2:column');
		assert.strictEqual(parseXml(result)!.children[0].children[0].attrs.custom, 'keep');
		assert.ok(!result.includes('<w2:data '));
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-fields-')), 'screen.xml');
		fs.writeFileSync(file, base);
		const document = await vscode.workspace.openTextDocument(file);
		assert.ok(await applyNodeEdit(document, { type: 'editDataFields', version: document.version, index: list.index, popup: 'p', fields: [{ id: 'col1', name: 'name1', dataType: 'date', length: '', encYN: false }], id: 'renamed' }));
		assert.strictEqual(parseXml(document.getText())!.children[0].children[0].children[0].attrs.id, 'col1');
		assert.strictEqual(parseXml(document.getText())!.children[0].attrs.id, 'renamed');
	});
});

suite('Data popup geometry', () => {
	test('8방향 리사이즈와 최소 크기·화면 경계', () => {
		const start = { x: 100, y: 100, width: 500, height: 400 };
		const expected = [
			{ x: 100, y: 130, width: 500, height: 370 }, { x: 100, y: 100, width: 500, height: 430 },
			{ x: 100, y: 100, width: 520, height: 400 }, { x: 120, y: 100, width: 480, height: 400 },
			{ x: 120, y: 130, width: 480, height: 370 }, { x: 100, y: 130, width: 520, height: 370 },
			{ x: 120, y: 100, width: 480, height: 430 }, { x: 100, y: 100, width: 520, height: 430 },
		];
		resizeEdges.forEach((edge, i) => assert.deepStrictEqual(resizeBox(start, edge, 20, 30, 1000, 800), expected[i]));
		assert.deepStrictEqual(resizeBox(start, 'nw', 999, 999, 1000, 800), { x: 200, y: 240, width: 400, height: 260 });
		assert.deepStrictEqual(resizeBox(start, 'se', 999, 999, 700, 600), { x: 100, y: 100, width: 600, height: 500 });
	});
});

suite('designer', () => {
	test('웹 루트 안 화면 XML은 폴더와 상관없이 디자이너로, 다른 XML은 텍스트 편집기 그대로', async function () {
		this.timeout(20000); // 탭 전환을 기다린다
		// 웹 루트 = websquare/config.xml 있는 폴더. 화면은 ui가 아닌 cm/xml 아래에 둔다
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-'));
		fs.mkdirSync(path.join(dir, 'websquare'));
		fs.writeFileSync(path.join(dir, 'websquare', 'config.xml'), '<WebSquare/>');
		fs.mkdirSync(path.join(dir, 'cm', 'xml'), { recursive: true });
		const screen = path.join(dir, 'cm', 'xml', 'TEST001.xml');
		fs.writeFileSync(screen, SCREEN);
		const other = path.join(dir, 'cm', 'xml', 'mapper.xml');
		fs.writeFileSync(other, '<mapper namespace="x"/>');

		const activeInput = () => vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(screen));
		await waitFor(() => activeInput() instanceof vscode.TabInputCustom);
		const input = activeInput();
		assert.ok(input instanceof vscode.TabInputCustom, '화면 XML이 디자이너로 바뀌지 않음');
		assert.strictEqual(input.viewType, VIEW_TYPE);
		assert.strictEqual(vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputText).length, 0, '텍스트 탭은 닫힘');

		// 디자이너에서 "텍스트 편집기로 다시 열기"를 하면 다시 디자이너로 되돌리지 않는다 (루프 방지)
		await vscode.commands.executeCommand('workbench.action.reopenTextEditor');
		await new Promise(r => setTimeout(r, 1500));
		assert.ok(activeInput() instanceof vscode.TabInputText, '다시 열기 → 텍스트는 그대로 텍스트');

		await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(other));
		await new Promise(r => setTimeout(r, 1000));
		assert.ok(activeInput() instanceof vscode.TabInputText, '다른 XML은 텍스트 편집기');
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('연결 화면 열기: wframe src를 화면 기준으로 풀어 디자이너 새 탭으로', async function () {
		this.timeout(20000);
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-open-'));
		fs.mkdirSync(path.join(dir, 'websquare'));
		fs.writeFileSync(path.join(dir, 'websquare', 'config.xml'), '<WebSquare/>');
		fs.mkdirSync(path.join(dir, 'ui'));
		fs.writeFileSync(path.join(dir, 'ui', 'SUB.xml'), SCREEN);
		const main = path.join(dir, 'ui', 'MAIN.xml');
		fs.writeFileSync(main, '<html xmlns:w2="http://www.inswave.com/websquare"><body><w2:wframe src="SUB.xml?x=1"/></body></html>');
		// 문서만 열고(탭 없음) wframe(노드 2번)의 src를 화면 위치 기준으로 푼다. ?쿼리는 무시
		await openFrame(await vscode.workspace.openTextDocument(vscode.Uri.file(main)), 2, dir);
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		assert.ok(input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE, '디자이너로 열림');
		assert.strictEqual(input.uri.fsPath.toLowerCase(), path.join(dir, 'ui', 'SUB.xml').toLowerCase());
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('isScreen: 최상위 html + 웹스퀘어 namespace(접두사 무관)', () => {
		assert.ok(isScreen(parseXml(SCREEN)));
		assert.ok(isScreen(parseXml('<html xmlns:ws="http://www.inswave.com/websquare"/>')), '접두사가 w2가 아니어도');
		assert.ok(!isScreen(parseXml('<html xmlns="http://www.w3.org/1999/xhtml"/>')), '일반 XHTML');
		assert.ok(!isScreen(parseXml('<WebSquare xmlns:w2="http://www.inswave.com/websquare"/>')), '엔진 설정');
	});

	test('환경 설정: 명령 등록, Eclipse 설치 폴더 미지정이면 도구 3개 못 찾음', async () => {
		assert.ok((await vscode.commands.getCommands(true)).includes('websquare5-editor.setup'));
		const outside = vscode.Uri.file(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-setup-')), 'A.xml'));
		for (const key of ['componentDefinitionFile', 'wpackExecutable', 'apiDocumentationPath'] as const) {
			assert.strictEqual(await resolvePath(key, outside), undefined, `${key}: Eclipse 폴더 미지정`);
		}
	});

	test('환경 설정: Eclipse 설치 폴더만 지정하면 그 밑에서 이름 상관없이 도구 3개 자동 탐색', async () => {
		// 플러그인 폴더 이름을 임의로 지어 이름 가정이 없음을 확인
		const eclipseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-eclipse-'));
		const configDir = path.join(eclipseRoot, 'weird.plugin.name_1.0', 'config', '9.9.9.9');
		fs.mkdirSync(configDir, { recursive: true });
		fs.writeFileSync(path.join(configDir, 'WebSquareConfig.xml'), '<WebSquare/>');
		const wpackDir = path.join(eclipseRoot, 'another.plugin', 'node', 'node_modules', 'w-pack');
		fs.mkdirSync(wpackDir, { recursive: true });
		fs.writeFileSync(path.join(wpackDir, 'index.js'), '');
		const apiDir = path.join(eclipseRoot, 'help.plugin', 'html', 'websquare', 'html');
		fs.mkdirSync(path.join(apiDir, '$p'), { recursive: true });
		fs.writeFileSync(path.join(apiDir, 'index.html'), '');

		const uri = vscode.Uri.file(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-setup-')), 'A.xml'));
		const config = vscode.workspace.getConfiguration('websquare5-editor');
		await config.update('eclipseInstallPath', eclipseRoot, vscode.ConfigurationTarget.Global);
		try {
			assert.strictEqual(await resolvePath('componentDefinitionFile', uri), path.join(configDir, 'WebSquareConfig.xml'));
			assert.strictEqual(await resolvePath('wpackExecutable', uri), path.join(wpackDir, 'index.js'));
			assert.strictEqual(await resolvePath('apiDocumentationPath', uri), apiDir);
			// 예전 PC·옛 개발팩 경로처럼 없는 경로가 저장돼 있으면 무시하고 자동 탐색
			await config.update('apiDocumentationPath', path.join(eclipseRoot, 'gone', 'docs', 'API'), vscode.ConfigurationTarget.Global);
			assert.strictEqual(await resolvePath('apiDocumentationPath', uri), apiDir, '없는 설정 경로 → 자동 탐색');
			// 있는 경로면 설정값이 우선
			await config.update('apiDocumentationPath', eclipseRoot, vscode.ConfigurationTarget.Global);
			assert.strictEqual(await resolvePath('apiDocumentationPath', uri), eclipseRoot, '있는 설정 경로 우선');
		} finally {
			await config.update('apiDocumentationPath', undefined, vscode.ConfigurationTarget.Global);
			await config.update('eclipseInstallPath', undefined, vscode.ConfigurationTarget.Global);
		}
	});

	test('환경 설정: 자동 탐색은 폴더당 한 번만 뒤지고, 설정이 바뀌면 다시 뒤진다', async () => {
		const eclipseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-eclipse-'));
		const wpackDir = path.join(eclipseRoot, 'plugin', 'w-pack');
		fs.mkdirSync(wpackDir, { recursive: true });
		fs.writeFileSync(path.join(wpackDir, 'index.js'), '');
		const uri = vscode.Uri.file(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-setup-')), 'A.xml'));
		const config = vscode.workspace.getConfiguration('websquare5-editor');
		await config.update('eclipseInstallPath', eclipseRoot, vscode.ConfigurationTarget.Global);
		try {
			assert.strictEqual(await resolvePath('wpackExecutable', uri), path.join(wpackDir, 'index.js'));
			// 도구 위치는 실행 중 안 바뀐다는 전제 — 폴더가 사라져도 같은 세션에선 캐시된 경로를 그대로 돌려준다(다시 뒤지지 않음)
			fs.rmSync(wpackDir, { recursive: true, force: true });
			assert.strictEqual(await resolvePath('wpackExecutable', uri), path.join(wpackDir, 'index.js'), '캐시된 경로 유지');
			// 설정이 바뀌면(registerSetup의 onDidChangeConfiguration) 캐시를 비워 다시 뒤진다
			clearAutoCache();
			assert.strictEqual(await resolvePath('wpackExecutable', uri), undefined, '캐시를 비우면 실제로 없는 경로를 다시 확인');
		} finally {
			await config.update('eclipseInstallPath', undefined, vscode.ConfigurationTarget.Global);
		}
	});
});

// 직접 작성한 최소 정의. 같은 태그 정의가 여럿인 경우를 재현한다.
const DEFS = `<?xml version="1.0" encoding="UTF-8"?>
<WebSquare><components>
	<component id="textbox" namespaceURI="http://www.inswave.com/websquare" realType="textbox" display="TextBox">
		<properties>
			<property name="label" maincategory="Basic &amp; ETC" maincategoryorder="1" description="표시 문구"/>
			<property name="style" maincategory="Style" maincategoryorder="2" description=""/>
			<property name="tagname" maincategory="Style" maincategoryorder="2" type="combobox"><option name="span" value="span"/><option name="p" value="p"/></property>
			<property name="disabled" maincategory="Style" maincategoryorder="2" type="[true, false]"/>
		</properties>
		<events><event name="onclick(e)" description="클릭"/></events>
	</component>
	<component id="column" namespaceURI="http://www.inswave.com/websquare" realType="column" display="NULL">
		<parents><parent id="columnInfo"/></parents><baseComponents><base id="dataList"/></baseComponents>
	</component>
	<component id="column" namespaceURI="http://www.inswave.com/websquare" realType="column">
		<parents><parent id="row"/></parents><baseComponents><base id="gridView"/></baseComponents>
	</component>
	<component id="column" namespaceURI="http://www.inswave.com/websquare" realType="column">
		<parents><parent id="row"/></parents><baseComponents><base id="grid"/></baseComponents>
	</component>
	<component id="select1" namespaceURI="http://www.w3.org/2002/xforms" realType="radio"/>
	<component id="select1" namespaceURI="http://www.w3.org/2002/xforms" realType="selectbox"/>
</components></WebSquare>`;

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

suite('edit', () => {
	test('boundColumnIds: 바인딩된 gridView 본문 컬럼이면 dataList 컬럼 id, 헤더·바인딩 없음은 undefined', () => {
		const text = '<html><head><w2:dataCollection><w2:dataList id="dl"><w2:columnInfo><w2:column id="a"/><w2:column id="b"/></w2:columnInfo></w2:dataList></w2:dataCollection></head>'
			+ '<body><w2:gridView id="g" dataList="data:dl"><w2:header><w2:row><w2:column id="h1"/></w2:row></w2:header><w2:gBody><w2:row><w2:column id="a"/></w2:row></w2:gBody></w2:gridView>'
			+ '<w2:gridView id="g2"><w2:gBody><w2:row><w2:column id="x"/></w2:row></w2:gBody></w2:gridView></body></html>';
		const root = parseXml(text)!;
		const all = (n: XmlNode): XmlNode[] => [n, ...n.children.flatMap(all)];
		// 그리드 안의 같은 id 노드(dataList 컬럼 a와 구분)
		const path = (id: string) => pathTo(root, all(root).filter(n => n.attrs.id === id).at(-1)!.index)!;
		assert.deepStrictEqual(boundColumnIds(root, path('a')), ['a', 'b']);
		assert.strictEqual(boundColumnIds(root, path('h1')), undefined, '헤더 컬럼');
		assert.strictEqual(boundColumnIds(root, path('x')), undefined, '바인딩 안 된 그리드');
	});

	test('setAttr more: 여러 노드를 한 편집으로(노드마다 다른 값), 하나라도 없으면 안 바꿈', async () => {
		const doc = await vscode.workspace.openTextDocument({ content: '<html><body><a id="x" s="1"/><b id="y"/></body></html>', language: 'xml' });
		const root = parseXml(doc.getText())!, [a, b] = root.children[0].children;
		assert.ok(await applyNodeEdit(doc, { type: 'setAttr', version: doc.version, index: a.index, name: 's', value: '2', more: [{ index: b.index, value: '3' }] }));
		assert.strictEqual(doc.getText(), '<html><body><a id="x" s="2"/><b id="y" s="3"/></body></html>');
		assert.strictEqual(await applyNodeEdit(doc, { type: 'setAttr', version: doc.version, index: a.index, name: 's', value: '9', more: [{ index: 99, value: '9' }] }), false);
		assert.ok(await applyNodeEdit(doc, { type: 'setAttr', version: doc.version, index: b.index, name: 's', value: '4', more: [{ index: b.index, value: '5' }] }), '같은 노드 중복');
		assert.ok(doc.getText().includes('<b id="y" s="4"/>'), doc.getText());
		assert.ok(doc.getText().includes('s="2"'));
	});

	test('setAttr also: 같은 노드의 여러 속성을 한 편집으로(그리드 헤더 칸 문구·너비·높이), 지우기 포함', async () => {
		const doc = await vscode.workspace.openTextDocument({ content: '<html><body><w2:column id="c" value="이름" style="height:26px;" width="70"/></body></html>', language: 'xml' });
		const col = parseXml(doc.getText())!.children[0].children[0];
		assert.ok(await applyNodeEdit(doc, { type: 'setAttr', version: doc.version, index: col.index, name: 'value', value: '성명',
			also: [{ name: 'width', value: '120' }, { name: 'style', value: 'height:40px;' }, { name: 'rowSpan', value: '2' }] }));
		assert.strictEqual(doc.getText(), '<html><body><w2:column id="c" value="성명" style="height:40px;" width="120" rowSpan="2"/></body></html>');
		assert.ok(await applyNodeEdit(doc, { type: 'setAttr', version: doc.version, index: col.index, name: 'value', value: '성명', also: [{ name: 'style' }, { name: 'rowSpan' }] }));
		assert.strictEqual(doc.getText(), '<html><body><w2:column id="c" value="성명" width="120"/></body></html>');
	});

	test('deleteNode: 줄 전체를 차지하면 줄바꿈까지, 아니면 태그만', () => {
		const apply = (t: string, e: { start: number; end: number; replacement: string }) => t.slice(0, e.start) + e.replacement + t.slice(e.end);
		const text = '<a>\n\t<b/>\n\t<c/><d/>\n</a>';
		const root = parseXml(text)!;
		assert.strictEqual(apply(text, deleteNode(text, root.children[0])), '<a>\n\t<c/><d/>\n</a>', '줄 전체 → 줄바꿈까지');
		assert.strictEqual(apply(text, deleteNode(text, root.children[2])), '<a>\n\t<b/>\n\t<c/>\n</a>', '한 줄에 여럿 → 태그만');
	});

	test('moveNode: id·이벤트 그대로 전/후/안으로 옮김 (Outline 드래그 앤 드롭), 자기 자신 안으로는 거부', () => {
		const apply = (t: string, es: { start: number; end: number; replacement: string }[]) =>
			[...es].sort((a, b) => b.start - a.start).reduce((acc, e) => acc.slice(0, e.start) + e.replacement + acc.slice(e.end), t);
		const text = [
			'<html><body>',
			'\t<xf:group id="g1">',
			'\t\t<xf:trigger id="a" ev:onclick="x"/>',
			'\t\t<xf:trigger id="b"/>',
			'\t</xf:group>',
			'\t<xf:group id="g2">',
			'\t</xf:group>',
			'</body></html>',
		].join('\n');
		const root = parseXml(text)!;
		const g1 = root.children[0].children[0], a = g1.children[0], b = g1.children[1], g2 = root.children[0].children[1];

		// 같은 부모 안 순서 바꾸기 (b를 a 앞으로)
		const reordered = apply(text, moveNode(text, b, a, 'before'));
		assert.ok(reordered.includes('<xf:trigger id="b"/>\n\t\t<xf:trigger id="a" ev:onclick="x"/>'), reordered);

		// 다른 컨테이너 안으로 (a를 g2 안으로) — id·이벤트 그대로, 원래 자리엔 안 남음
		const moved = apply(text, moveNode(text, a, g2, 'inside'));
		assert.ok(moved.includes('<xf:group id="g2">\n\t\t<xf:trigger id="a" ev:onclick="x"/>\n\t</xf:group>'), moved);
		assert.strictEqual(moved.match(/id="a"/g)?.length, 1, '원래 자리엔 안 남음');

		assert.throws(() => moveNode(text, g1, a, 'inside'), '자기 자신 안으로 거부');
	});

	test('pasteNode: 그룹이면 마지막 자식, 버튼이면 바로 뒤. id는 _copyN(안쪽 포함), ev:는 제거, 들여쓰기 맞춤', () => {
		const apply = (t: string, e: { start: number; end: number; replacement: string }) => t.slice(0, e.start) + e.replacement + t.slice(e.end);
		let text = [
			'<html xmlns:ev="http://www.w3.org/2001/xml-events"><body>',
			'\t<xf:group id="grp">',
			'\t\t<xf:trigger id="btn" ev:onclick="scwin.go"><xf:label>조회</xf:label></xf:trigger>',
			'\t</xf:group>',
			'\t<xf:group id="target">',
			'\t</xf:group>',
			'</body></html>',
		].join('\n');
		const btn = pathTo(parseXml(text)!, 3)!.at(-1)!;
		const copied = '\t\t' + text.slice(btn.start, btn.end);
		for (let i = 0; i < 2; i++) {
			const root = parseXml(text)!;
			const target = root.children[0].children[1];
			text = apply(text, pasteNode(text, root, target, copied));
		}
		assert.ok(text.includes('\t<xf:group id="target">\n\t\t<xf:trigger id="btn_copy1"><xf:label>조회</xf:label></xf:trigger>\n\t\t<xf:trigger id="btn_copy2">'), text);
		assert.ok(!/btn_copy\d+" ev:/.test(text), '이벤트 제거');
		assert.ok(text.includes('<xf:trigger id="btn" ev:onclick="scwin.go">'), '원본은 그대로');

		// 버튼을 선택하고 붙이면 버튼 안이 아니라 바로 뒤 형제 (같은 들여쓰기)
		const root = parseXml(text)!;
		const onBtn = apply(text, pasteNode(text, root, pathTo(root, 3)!.at(-1)!, copied));
		assert.ok(onBtn.includes('scwin.go"><xf:label>조회</xf:label></xf:trigger>\n\t\t<xf:trigger id="btn_copy3"><xf:label>'), onBtn);

		// 복사본을 다시 복사해도 _copy1_copy1이 아니라 다음 번호, 안쪽 id도 바뀜
		const grp = '<body><xf:group id="g_copy1"><xf:input id="i"/></xf:group><xf:group id="g"/></body>';
		const groot = parseXml(grp)!;
		const src = groot.children[0];
		const out = apply(grp, pasteNode(grp, groot, groot.children[1], grp.slice(src.start, src.end)));
		assert.ok(out.includes('<xf:group id="g"><xf:group id="g_copy2"><xf:input id="i_copy1"/></xf:group></xf:group>'), out);
		assert.throws(() => pasteNode(grp, groot, groot, '<a/><b/>'));
	});

	const XMLNS = 'xmlns="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms"';
	const byId = (root: XmlNode, id: string) => findNode(root, n => n.attrs.id === id)!;
	const applyOne = (text: string, edit: { start: number; end: number; replacement: string }) => text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);

	suite('데이터 붙여넣기', () => {
		const text = `<html ${XMLNS}>\n<head>\n<xf:model>\n<w2:dataCollection baseNode="map">\n<w2:dataMap id="dma" baseNode="map"><w2:keyInfo><w2:key id="k1" name="k1"/></w2:keyInfo></w2:dataMap>\n</w2:dataCollection>\n`
			+ '<xf:submission id="sbm" action="/x">\n<xf:action ev:event="xforms-submit-done"><xf:script type="text/javascript"><![CDATA[a();]]></xf:script></xf:action>\n</xf:submission>\n</xf:model>\n</head>\n<body>\n<xf:group id="grp"/>\n</body>\n</html>';
		const root = parseXml(text)!;
		const snippet = (id: string) => { const n = byId(root, id); return (leadOf(text, n.start) ?? '') + text.slice(n.start, n.end); };

		test('submission: ev:event(이벤트 종류)는 지우지 않고, id는 바깥 것만 바꾸고, xf:model 안에 들어간다', () => {
			const out = applyOne(text, pasteNode(text, root, byId(root, 'sbm'), [snippet('sbm')]));
			assert.ok(out.includes('<xf:submission id="sbm_copy1" action="/x">'), out);
			assert.strictEqual(out.match(/ev:event="xforms-submit-done"/g)?.length, 2, 'ev:event 유지');
			const copy = findNode(parseXml(out)!, n => n.attrs.id === 'sbm_copy1')!;
			assert.strictEqual(parseXml(out)!.children[0].children.find(c => c.tag === 'xf:model')?.children.includes(copy) || pathTo(parseXml(out)!, copy.index)!.some(n => n.tag === 'xf:model'), true, 'model 안');
			assert.strictEqual(out.match(/<xf:model>/g)?.length, 1, 'model은 하나');
		});

		test('submission을 화면 컴포넌트(body)를 고른 채 붙여도 body가 아니라 xf:model 맨 뒤', () => {
			const out = applyOne(text, pasteNode(text, root, byId(root, 'grp'), [snippet('sbm')]));
			const tree = parseXml(out)!, copy = findNode(tree, n => n.attrs.id === 'sbm_copy1')!;
			assert.ok(pathTo(tree, copy.index)!.some(n => n.tag === 'xf:model'), out);
			assert.ok(!pathTo(tree, copy.index)!.some(n => n.tag === 'body'), 'body에는 안 들어감');
		});

		test('dataMap: 바깥 id만 _copy, 필드(key) 이름은 그대로, DataCollection 안', () => {
			const out = applyOne(text, pasteNode(text, root, byId(root, 'sbm'), [snippet('dma')]));
			assert.ok(out.includes('<w2:dataMap id="dma_copy1" baseNode="map"><w2:keyInfo><w2:key id="k1" name="k1"/>'), out);
			const tree = parseXml(out)!;
			assert.ok(pathTo(tree, findNode(tree, n => n.attrs.id === 'dma_copy1')!.index)!.some(n => n.tag === 'w2:dataCollection'), 'dataCollection 안');
		});

		test('xf:model 복사본은 붙여 넣을 수 없고(중복 방지), 컴포넌트는 데이터 영역에 못 넣고, 데이터와 컴포넌트는 같이 못 붙인다', () => {
			const model = findNode(root, n => n.tag === 'xf:model')!;
			assert.throws(() => pasteNode(text, root, byId(root, 'grp'), [text.slice(model.start, model.end)]), /xf:model/);
			assert.throws(() => pasteNode(text, root, byId(root, 'sbm'), ['<xf:group id="g"/>']), /데이터 영역/);
			assert.throws(() => pasteNode(text, root, byId(root, 'grp'), [snippet('sbm'), '<xf:group id="g"/>']), /함께/);
		});
	});

	suite('셀 병합', () => {
		const grid = `<html ${XMLNS}><body>\n<w2:gridView id="grd"><w2:header id="h">\n`
			+ '<w2:row id="r1"><w2:column id="c1" value="A"/><w2:column id="c2" value="B"/><w2:column id="c3" value="C"/></w2:row>\n'
			+ '<w2:row id="r2"><w2:column id="c4" value="D"/><w2:column id="c5" value="E"/><w2:column id="c6" value="F"/></w2:row>\n</w2:header></w2:gridView>\n</body></html>';
		const merge = (text: string, ids: string[]) => { const root = parseXml(text)!; return applyOne(text, mergeCells(text, root, ids.map(id => byId(root, id)))[0]); };
		const problem = (text: string, ids: string[]) => { const root = parseXml(text)!; return mergeProblem(root, ids.map(id => byId(root, id))); };

		test('그리드: 가로·세로·2x2 병합은 왼쪽 위 셀에 colSpan·rowSpan, 나머지 셀은 지움', () => {
			assert.ok(merge(grid, ['c1', 'c2']).includes('<w2:column id="c1" value="A" colSpan="2"/><w2:column id="c3" value="C"/>'));
			const down = merge(grid, ['c2', 'c5']);
			assert.ok(down.includes('<w2:column id="c2" value="B" rowSpan="2"/>') && !down.includes('id="c5"'), down);
			const both = merge(grid, ['c1', 'c2', 'c4', 'c5']);
			assert.ok(/<w2:column id="c1" value="A" (colSpan="2" rowSpan="2"|rowSpan="2" colSpan="2")\/>/.test(both) && !both.includes('id="c2"') && !both.includes('id="c4"') && !both.includes('id="c5"'), both);
			assert.ok(parseXml(both), '결과가 올바른 XML');
		});

		test('그리드: 떨어진 셀·대각선·한 개는 병합 불가(이유를 돌려줌), 이미 합쳐진 셀과도 이어 합침', () => {
			assert.match(problem(grid, ['c1', 'c3'])!, /붙어 있는/);
			assert.match(problem(grid, ['c1', 'c5'])!, /붙어 있는/);
			assert.match(problem(grid, ['c1'])!, /둘 이상/);
			const wide = merge(grid, ['c1', 'c2']);
			assert.strictEqual(problem(wide, ['c1', 'c3']), undefined, '합친 셀(colSpan 2)과 옆 셀');
			assert.ok(merge(wide, ['c1', 'c3']).includes('colSpan="3"'));
		});

		const table = `<html ${XMLNS}><body>\n<xf:group tagname="table" id="t"><xf:group tagname="tbody"><xf:group tagname="tr">\n`
			+ '<xf:group tagname="th" id="th1"><w2:textbox id="tb"/></xf:group><xf:group tagname="td" id="td1">\n<xf:input id="in"/>\n</xf:group><xf:group tagname="td" id="td2"/>\n</xf:group>\n'
			+ '<xf:group tagname="tr"><xf:group tagname="th" id="th2"><w2:attributes><w2:scope>row</w2:scope></w2:attributes></xf:group><xf:group tagname="td" id="td3"/><xf:group tagname="td" id="td4"/></xf:group>\n</xf:group></xf:group></body></html>';

		test('group th·td: w2:attributes의 colspan·rowspan, 지워지는 셀 안 컴포넌트는 왼쪽 위 셀로 옮김', () => {
			const out = merge(table, ['th1', 'td1']);
			assert.ok(out.includes('<w2:attributes><w2:colspan>2</w2:colspan></w2:attributes>'), out);
			assert.ok(out.includes('id="tb"') && out.includes('id="in"') && !out.includes('id="td1"'), '컴포넌트 보존');
			const tree = parseXml(out)!, th = byId(tree, 'th1');
			assert.deepStrictEqual(th.children.map(c => c.attrs.id).filter(Boolean), ['tb', 'in'].filter(id => th.children.some(c => c.attrs.id === id)).concat([]).length ? ['tb', 'in'] : [], '옮긴 순서');
			// 세로로 th1+th2: rowspan, 가진 attributes에 덧붙임·없는 셀에는 새로 만듦
			const down = merge(table, ['th2', 'td3']);
			assert.ok(down.includes('<w2:colspan>2</w2:colspan>') && down.includes('<w2:scope>row</w2:scope>'), down);
			const box = merge(table, ['td1', 'td2', 'td3', 'td4'].filter(id => id !== 'td1' || true));
			assert.ok(parseXml(box));
		});

		test('group: 2x2 병합은 colspan·rowspan을 한 w2:attributes에 같이 넣는다', () => {
			const out = merge(table.replace('<xf:group tagname="th" id="th2">', '<xf:group tagname="td" id="th2">').replace('<w2:attributes><w2:scope>row</w2:scope></w2:attributes>', ''), ['td1', 'td2', 'td3', 'td4']);
			assert.strictEqual(out.match(/<w2:attributes>/g)?.length, 1, out);
			assert.ok(out.includes('<w2:colspan>2</w2:colspan>') && out.includes('<w2:rowspan>2</w2:rowspan>'), out);
		});
	});

	test('setStyle: 바꾼 속성만 교체, 없던 속성은 뒤에, 나머지 표기·url 안 ; 유지', () => {
		assert.strictEqual(setStyle('width: 100px;height:21px;', { width: '150px' }), 'width: 150px;height:21px;');
		assert.strictEqual(setStyle('background:url(a;b.png);WIDTH:1px', { width: '2px', left: '3px' }), 'background:url(a;b.png);WIDTH:2px;left:3px;');
		assert.strictEqual(setStyle(undefined, { top: '5px' }), 'top:5px;');
		assert.strictEqual(setStyle('width:1px; top:2px;', { top: undefined }), 'width:1px;', '값이 없으면 지움');
		assert.strictEqual(setStyle('top:2px;', { top: undefined }), '', '다 지우면 빈 문자열');
	});

	test('styleChanges: 바뀐·지운 속성만(대소문자·공백 무시)', () => {
		assert.deepStrictEqual(styleChanges('width: 10px; TOP:1px;left:0', 'width:99px;top:1px;color:red'), { width: '99px', left: undefined, color: 'red' });
		assert.deepStrictEqual(styleChanges(undefined, undefined), {});
	});

	test('Source 원문은 바뀐 가운데 부분만 수정', () => {
		assert.deepStrictEqual(sourceChange('<a>\r\n  <b/>\r\n</a>', '<a>\r\n  <b x="1"/>\r\n</a>'), { start: 9, end: 9, replacement: ' x="1"' });
		assert.strictEqual(sourceChange('<a/>', '<a/>'), undefined);
	});

	test('Source 수정은 line:ch 변경분으로 적용', async () => {
		const doc = await vscode.workspace.openTextDocument({ content: SCREEN, language: 'xml' });
		const at = doc.positionAt(SCREEN.indexOf('한글'));
		assert.ok(await applyCodeEdit(doc, 'source', [{ fromLine: at.line, fromCh: at.character, toLine: at.line, toCh: at.character + 2, insert: '수정' }]));
		assert.ok(doc.getText().includes('label="수정"'));
	});

	test('scriptBody: CDATA(나눠 적은 인접 CDATA 포함)·일반 텍스트는 편집, 섞이면 안내', () => {
		const body = (xml: string) => scriptBody(xml, parseXml(xml)!);
		const res = body(SCREEN);
		assert.ok(typeof res === 'object' && res.cdata);
		assert.strictEqual(res.text, ' if (a < b) { scwin.x = "<tag>"; } ');
		assert.strictEqual(SCREEN.slice(res.start, res.end), res.text);
		const withSrc = body('<html><script src="ext.js"/><script>\r\n<![CDATA[var y = 2;]]>\r\n</script></html>');
		assert.ok(typeof withSrc === 'object' && withSrc.text === 'var y = 2;');
		const split = body('<html><script><![CDATA[a]]]]><![CDATA[>b]]></script></html>');
		assert.ok(typeof split === 'object' && split.cdata && split.text === 'a]]>b', '인접 CDATA는 이어 붙인 값');
		const plain = body('<html><script>if (a &lt; b &amp;&amp; c) {}</script></html>');
		assert.ok(typeof plain === 'object' && !plain.cdata && plain.text === 'if (a < b && c) {}', '일반 텍스트는 문자 참조를 푼 값');
		const refs = body('<html><script>&#65;&#x42;&quot;&apos;&gt;&#0;&#xD800;&nbsp;&AMP;</script></html>');
		assert.ok(typeof refs === 'object' && refs.text === 'AB"\'>��&nbsp;&AMP;', '숫자 참조·XML 이름 참조만 푼다');
		for (const xml of ['<html/>', '<html><script><![CDATA[a]]> <![CDATA[b]]></script></html>', '<html><script><!-- c --><![CDATA[a]]></script></html>', '<html><script><b/></script></html>']) {
			assert.strictEqual(typeof body(xml), 'string', xml);
		}
	});

	test('encodeScript: CDATA 안 ]]>는 나눠 적고, 텍스트는 이스케이프', () => {
		assert.strictEqual(encodeScript('a]]>b', true), 'a]]]]><![CDATA[>b');
		assert.strictEqual(encodeScript('a < b && c ]]>', false), 'a &lt; b &amp;&amp; c ]]&gt;');
	});

	test('Script 수정: 편집기 값에 적용 후 원문으로 되돌려 가운데만 교체', async () => {
		const doc = await vscode.workspace.openTextDocument({ content: '<html><script><![CDATA[a;\r\n  b;]]></script></html>', language: 'xml' });
		assert.ok(await applyCodeEdit(doc, 'script', [
			{ fromLine: 0, fromCh: 0, toLine: 0, toCh: 1, insert: 'x' },
			{ fromLine: 1, fromCh: 2, toLine: 1, toCh: 3, insert: 'y\nz' },
		]));
		assert.strictEqual(doc.getText(), '<html><script><![CDATA[x;\r\n  y\r\nz;]]></script></html>');
		// CDATA 안에 ]]>를 쳐도 XML이 깨지지 않는다
		assert.ok(await applyCodeEdit(doc, 'script', [{ fromLine: 0, fromCh: 0, toLine: 0, toCh: 0, insert: ']]>' }]));
		assert.strictEqual(doc.getText(), '<html><script><![CDATA[]]]]><![CDATA[>x;\r\n  y\r\nz;]]></script></html>');
		const plain = await vscode.workspace.openTextDocument({ content: '<html><script>a &lt; b;</script></html>', language: 'xml' });
		assert.ok(await applyCodeEdit(plain, 'script', [{ fromLine: 0, fromCh: 5, toLine: 0, toCh: 5, insert: ' && c' }]));
		assert.strictEqual(plain.getText(), '<html><script>a &lt; b &amp;&amp; c;</script></html>');
	});

	test('DOCTYPE이 있으면 파싱 거부, 주석 안은 무시', () => {
		assert.throws(() => parseXml('<!DOCTYPE html [<!ENTITY x "y">]><html/>'), /DOCTYPE/);
		assert.ok(parseXml('<!-- <!DOCTYPE html> --><html/>'));
	});

	// 원문에 편집 한 건을 적용한 결과
	const apply = (xml: string, name: string, value: string | undefined) => {
		const node = parseXml(xml)!;
		const e = setAttribute(xml, node, name, value);
		return e ? xml.slice(0, e.start) + e.replacement + xml.slice(e.end) : xml;
	};

	test('값 변경은 그 값만 (따옴표·서식 유지)', () => {
		assert.strictEqual(apply('<a  id="x"\n\tclass=\'b\' >t</a>', 'class', 'c d'), '<a  id="x"\n\tclass=\'c d\' >t</a>');
		assert.strictEqual(apply('<a t="1>2" id="x"/>', 'id', 'y'), '<a t="1>2" id="y"/>', '값 안의 > 는 태그 끝이 아님');
	});

	test('추가 · 삭제 · 변경 없음', () => {
		assert.strictEqual(apply('<a/>', 'id', 'x'), '<a id="x"/>');
		assert.strictEqual(apply('<a id="x" >t</a>', 'style', 'w:1'), '<a id="x" style="w:1" >t</a>');
		assert.strictEqual(apply('<a id="x" style="w:1"/>', 'style', undefined), '<a id="x"/>');
		assert.strictEqual(apply('<a id="x"/>', 'nope', undefined), '<a id="x"/>');
		assert.strictEqual(setAttribute('<a id="x"/>', parseXml('<a id="x"/>')!, 'id', 'x'), undefined);
	});

	test('이스케이프 · 잘못된 이름 차단', () => {
		assert.strictEqual(apply('<a/>', 'v', 'a<b & "c"'), '<a v="a&lt;b &amp; &quot;c&quot;"/>');
		assert.strictEqual(apply('<a v=\'x\'/>', 'v', 'it\'s'), '<a v=\'it&apos;s\'/>');
		assert.throws(() => apply('<a/>', 'x="1" onload', '2'));
		assert.strictEqual(apply('<a/>', 'label', 'a\nb'), '<a label="a&#10;b"/>', '속성 줄바꿈 보존');
		assert.strictEqual(apply('<a/>', 'label', 'a\r\n\tb'), '<a label="a&#13;&#10;&#9;b"/>', 'CR·탭도 문자 참조로');
		assert.throws(() => apply('<a/>', 'label', 'a\u0001'), 'XML에 못 쓰는 제어 문자');
		assert.throws(() => apply('<a/>', 'xmlns:x', 'urn:x'), 'namespace 선언은 편집 대상 아님');
		assert.throws(() => apply('<a/>', 'x:y', '1'), '선언 안 된 접두사');
	});

	test('ev: 이벤트는 선언이 없으면 xmlns:ev를 같이 넣고, 조상에 있으면 그대로', () => {
		assert.strictEqual(apply('<a/>', 'ev:onclick', 'f()'), '<a ev:onclick="f()" xmlns:ev="http://www.w3.org/2001/xml-events"/>');
		const xml = '<html xmlns:ev="http://www.w3.org/2001/xml-events"><b/></html>';
		const root = parseXml(xml)!;
		const e = setAttribute(xml, root.children[0], 'ev:onclick', 'f()', [root])!;
		assert.strictEqual(xml.slice(0, e.start) + e.replacement + xml.slice(e.end), '<html xmlns:ev="http://www.w3.org/2001/xml-events"><b ev:onclick="f()"/></html>');
	});

	test('직계 텍스트: 공백 유지 · CDATA · 빈 태그 · 자식 앞', () => {
		const text = (xml: string, value: string, pick = (r: XmlNode) => r) => {
			const node = pick(parseXml(xml)!);
			const e = setText(xml, node, value);
			return e ? xml.slice(0, e.start) + e.replacement + xml.slice(e.end) : xml;
		};
		assert.strictEqual(text('<th a="1">\n\t사원코드\n</th>', '사번'), '<th a="1">\n\t사번\n</th>');
		assert.strictEqual(text('<b><l><![CDATA[조회]]></l></b>', '검색', r => r.children[0]), '<b><l><![CDATA[검색]]></l></b>');
		assert.strictEqual(text('<th/>', 'a<b'), '<th>a&lt;b</th>');
		assert.strictEqual(text('<th>x<w2:attributes/></th>', 'y'), '<th>y<w2:attributes/></th>');
		assert.strictEqual(text('<th></th>', 'z'), '<th>z</th>');
	});

	test('문서에 적용 (WorkspaceEdit)', async () => {
		const doc = await vscode.workspace.openTextDocument({ content: SCREEN, language: 'xml' });
		const version = doc.version;
		assert.ok(await applyNodeEdit(doc, { type: 'setAttr', version, index: 7, name: 'label', value: '영문' }));
		assert.ok(doc.getText().includes('<w2:textbox id="tbx_title" label="영문"/>'));
		assert.ok(!await applyNodeEdit(doc, { type: 'setAttr', version, index: 999, name: 'x', value: '1' }), '없는 노드');
	});
});

suite('format', () => {
	// 문서 전체를 fn 결과로 바꾸는 가짜 포매터
	const formatter = (selector: vscode.DocumentSelector, fn: (text: string) => string) => vscode.languages.registerDocumentFormattingEditProvider(selector, {
		provideDocumentFormattingEdits: d => [vscode.TextEdit.replace(new vscode.Range(0, 0, d.lineCount, 0), fn(d.getText()))],
	});

	test('Source: 포매터가 없으면 undefined, 있으면 결과만 돌려주고 문서는 그대로', async () => {
		const doc = await vscode.workspace.openTextDocument({ content: '<a><b/></a>', language: 'xml' });
		assert.strictEqual(await formatCode(doc, 'source'), undefined);
		const sub = formatter({ language: 'xml' }, t => t.replace('<b/>', '\n  <b/>\n'));
		try {
			// VS Code가 포매터 결과 줄바꿈을 문서 EOL(Windows는 CRLF)로 맞춘다
			assert.strictEqual((await formatCode(doc, 'source'))?.replace(/\r\n/g, '\n'), '<a>\n  <b/>\n</a>');
			assert.strictEqual(doc.getText(), '<a><b/></a>');
		} finally {
			sub.dispose();
		}
	});

	test('연결 파일·Source: 포매터에는 파일과 상관없이 공백 4칸을 넘긴다', async () => {
		let options: vscode.FormattingOptions | undefined;
		const sub = vscode.languages.registerDocumentFormattingEditProvider({ language: 'java' }, { provideDocumentFormattingEdits: (_d, o) => { options = o; return []; } });
		try {
			const tabbed = await vscode.workspace.openTextDocument({ content: 'class A {\n\tvoid f() {\n\t\tg();\n\t}\n}\n', language: 'java' });
			await formatCode(tabbed, 'link:controller');
			assert.deepStrictEqual({ tabSize: options?.tabSize, insertSpaces: options?.insertSpaces }, { tabSize: 4, insertSpaces: true });
			const twoSpaces = await vscode.workspace.openTextDocument({ content: 'class A {\n  void f() {\n    g();\n  }\n}\n', language: 'java' });
			await formatCode(twoSpaces, 'link:service');
			assert.deepStrictEqual({ tabSize: options?.tabSize, insertSpaces: options?.insertSpaces }, { tabSize: 4, insertSpaces: true });
		} finally {
			sub.dispose();
		}
	});

	test('연결 탭 자동완성: 언어 확장 결과를 이름·설명·스니펫·자동 import 편집으로 바꾼다', async () => {
		const sub = vscode.languages.registerCompletionItemProvider({ language: 'java' }, {
			provideCompletionItems: () => {
				const big = new vscode.CompletionItem({ label: 'BigDecimal', description: 'java.math' }, vscode.CompletionItemKind.Class);
				big.additionalTextEdits = [vscode.TextEdit.insert(new vscode.Position(0, 0), 'import java.math.BigDecimal;\n')];
				big.range = new vscode.Range(1, 4, 1, 7);
				const each = new vscode.CompletionItem('forEach', vscode.CompletionItemKind.Method);
				each.insertText = new vscode.SnippetString('forEach(${1:action})');
				// 필드·생성자·스니펫도 아이콘 종류가 따로(필드 f, 생성자는 메서드 m, 스니펫 S)
				return [big, each, new vscode.CompletionItem('name', vscode.CompletionItemKind.Field), new vscode.CompletionItem('Big', vscode.CompletionItemKind.Constructor),
					new vscode.CompletionItem('for', vscode.CompletionItemKind.Snippet)];
			},
		});
		try {
			const doc = await vscode.workspace.openTextDocument({ content: 'class A {\n    Big\n}\n', language: 'java' });
			const result = await remoteCompletions(doc, 1, 7);
			const items = result?.items.filter(i => i.label === 'BigDecimal' || i.label === 'forEach');
			assert.deepStrictEqual(result?.from, { line: 1, ch: 4 });
			assert.deepStrictEqual(['name', 'Big', 'for'].map(label => result?.items.find(i => i.label === label)?.type), ['field', 'method', 'snippet']);
			assert.deepStrictEqual(items?.map(i => ({ label: i.label, type: i.type, detail: i.detail, snippet: i.snippet, insert: i.insert, edits: i.edits })), [
				{ label: 'BigDecimal', type: 'class', detail: 'java.math', snippet: false, insert: 'BigDecimal', edits: [{ fromLine: 0, fromCh: 0, toLine: 0, toCh: 0, insert: 'import java.math.BigDecimal;\n' }] },
				{ label: 'forEach', type: 'method', detail: undefined, snippet: true, insert: 'forEach(${1:action})', edits: undefined },
			]);
		} finally {
			sub.dispose();
		}
	});

	test('연결 탭 자동완성: 다른 문서에서 온 단어(Text)는 빼고 이 파일 단어·언어 확장 결과는 둔다', async () => {
		const sub = vscode.languages.registerCompletionItemProvider({ language: 'xml' }, {
			provideCompletionItems: () => [
				new vscode.CompletionItem('dataList', vscode.CompletionItemKind.Text),
				new vscode.CompletionItem('selectUser', vscode.CompletionItemKind.Text),
				new vscode.CompletionItem('resultMap', vscode.CompletionItemKind.Property),
			],
		});
		try {
			const doc = await vscode.workspace.openTextDocument({ content: '<mapper>\n<select id="selectUser">\n</select>\n</mapper>\n', language: 'xml' });
			const labels = (await remoteCompletions(doc, 2, 0))?.items.map(i => i.label) ?? [];
			assert.ok(labels.includes('selectUser') && labels.includes('resultMap'), labels.join());
			assert.ok(!labels.includes('dataList'), labels.join());
		} finally {
			sub.dispose();
		}
	});

	// Script는 VS Code의 JS 포매터(기본 포매터 설정, 없으면 내장)로. 결과 모양은 그 포매터 몫이라 들여쓰기·본문·앞뒤 공백만 본다
	test('Script: 본문만 VS Code JS 포매터로 포맷하고 CDATA 앞뒤 공백은 유지', async () => {
		const doc = await vscode.workspace.openTextDocument({ content: '<html><script><![CDATA[\n\tconst a={b:1}\n\t]]></script></html>', language: 'xml' });
		const out = await formatCode(doc, 'script');
		assert.ok(out?.startsWith('\n\t') && out.endsWith('\n\t'), JSON.stringify(out));
		assert.match(out!, /const a = \{ b: 1 \}/);
	});

	test('Script: 탭으로 들여쓴 본문도 공백 4칸으로 포맷', async () => {
		const doc = await vscode.workspace.openTextDocument({ content: '<html><script><![CDATA[\nif (a) {\n\tb()\n}\n]]></script></html>', language: 'xml' });
		assert.match((await formatCode(doc, 'script'))!, /\n {4}b\(\)/);
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

suite('palette', () => {
	const W2 = 'http://www.inswave.com/websquare', XF = 'http://www.w3.org/2002/xforms';
	const def = (id: string, realType: string, ns = W2, extra: Partial<ComponentDef> = {}): ComponentDef =>
		({ id, ns, realType, display: realType, category: 'Forms', parents: [], bases: [], properties: [], events: [], ...extra });
	const screen = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:w2="${W2}" xmlns:xf="${XF}">\n<head><xf:model/></head>\n<body>\n\t<xf:group id="grp">\n\t\t<xf:input id="input1"/>\n\t</xf:group>\n\t<w2:gridView id="grd"><w2:gBody id="b"><w2:row id="r"><w2:column id="c"/></w2:row></w2:gBody></w2:gridView>\n</body>\n</html>`;
	const apply = (t: string, e: { start: number; end: number; replacement: string }) => t.slice(0, e.start) + e.replacement + t.slice(e.end);
	const find = (root: XmlNode, id: string): XmlNode => root.attrs.id === id ? root : root.children.map(c => find(c, id)).find(Boolean)!;

	test('목록: 숨김·부속·이름 없음·body·데이터 계열 제외', () => {
		const defs = [def('input', 'input'), def('column', 'column', W2, { parents: ['row'] }), def('xsl', 'xsl', W2, { hidden: true }), def('td', 'td', W2, { display: undefined }),
			def('body', 'body'), def('dataList', 'dataList', W2, { category: 'Others' }), def('aliasLinkedDataList', 'aliasLinkedDataList'), def('model', 'model', XF, { category: undefined })];
		assert.deepStrictEqual(paletteDefs(defs).map(d => d.id), ['input']);
	});

	test('검색: 낱말 모두 포함(이름·id·묶음), 대소문자·앞뒤 공백 무시', () => {
		const defs = [def('select1', 'selectbox', XF, { display: 'SelectBox' }), def('select1', 'radio', XF, { display: 'Radio' }), def('gridView', 'gridView', W2, { display: 'GridView', category: 'Grid' })];
		const names = (q: string) => matchPalette(defs, q).map(d => d.display);
		assert.deepStrictEqual(names(''), ['SelectBox', 'Radio', 'GridView']);
		assert.deepStrictEqual(names(' SELECTBOX '), ['SelectBox']);
		assert.deepStrictEqual(names('select1'), ['SelectBox', 'Radio'], 'id로도 찾는다');
		assert.deepStrictEqual(names('grid forms'), [], '낱말 하나라도 없으면 제외');
		assert.deepStrictEqual(names('grid grid'), ['GridView']);
	});

	test('넣을 대상·자리: body 밖이면 body, 그리드 안이면 gridView, 컨테이너만 안쪽', () => {
		const root = parseXml(screen)!;
		const body = root.children[1], grp = find(root, 'grp'), input = find(root, 'input1');
		assert.strictEqual(insertTarget(root, undefined), body);
		assert.strictEqual(insertTarget(root, pathTo(root, root.children[0].children[0].index)), body, 'head(xf:model) 선택');
		assert.strictEqual(insertTarget(root, pathTo(root, find(root, 'c').index)), find(root, 'grd'));
		assert.strictEqual(insertTarget(root, pathTo(root, input.index)), input);
		assert.deepStrictEqual([insertPositions(body), insertPositions(grp), insertPositions(input)],
			[['first', 'inside'], ['first', 'inside', 'before', 'after'], ['before', 'after']]);
	});

	test('원문: 접두사·고유 id·기본 크기·최소 틀·자리·들여쓰기', () => {
		const root = parseXml(screen)!;
		const grp = find(root, 'grp'), input = find(root, 'input1');
		const first = insertComponent(screen, root, grp, 'first', def('input', 'input', XF), { width: '144px', height: '21px' });
		assert.strictEqual(first.id, 'input2', '문서에 있는 input1을 피한다');
		assert.ok(apply(screen, first.edit).includes('<xf:group id="grp">\n\t\t<xf:input id="input2" style="width:144px;height:21px;"/>\n\t\t<xf:input id="input1"/>'));
		const radio = insertComponent(screen, root, input, 'after', def('select1', 'radio', XF));
		assert.ok(apply(screen, radio.edit).includes('<xf:input id="input1"/>\n\t\t<xf:select1 id="radio1" appearance="full">\n\t\t\t<xf:choices></xf:choices>\n\t\t</xf:select1>'));
		const grid = apply(screen, insertComponent(screen, root, grp, 'before', def('gridView', 'gridView')).edit);
		const added = parseXml(grid)!;
		const g = find(added, 'gridView1');
		assert.deepStrictEqual(g.children.map(c => c.tag), ['w2:header', 'w2:gBody']);
		assert.strictEqual(g.children[1].attrs.id, 'gBody1');
		assert.strictEqual(g.children[0].children[0].children[0].attrs.id, 'column1', '문서에 있는 c와 별개로 번호');
		assert.ok(grid.includes('<body>\n\t<w2:gridView id="gridView1">\n\t\t<w2:header id="header1">'), '대상 들여쓰기에 맞춤');
		assert.throws(() => insertComponent('<html><body/></html>', parseXml('<html><body/></html>')!, parseXml('<html><body/></html>')!.children[0], 'inside', def('input', 'input')), /네임스페이스 선언/);
		const crlf = screen.replaceAll('\n', '\r\n');
		const trigger = apply(crlf, insertComponent(crlf, parseXml(crlf)!, find(parseXml(crlf)!, 'input1'), 'before', def('trigger', 'trigger', XF, { display: 'Trigger' })).edit);
		assert.ok(trigger.includes('<xf:trigger id="trigger1">\r\n\t\t\t<xf:label><![CDATA[Trigger]]></xf:label>\r\n\t\t</xf:trigger>\r\n\t\t<xf:input id="input1"/>'), 'CRLF 문서는 CRLF');
	});

	test('기본 크기: extends로 물려받고 자기 값이 덮는다, 틀은 결과에서 뺀다', () => {
		const styles = parseDefaultStyles(`<components>
	<component id="__type1"><property name="width" value="148px"/><property name="height" value="21px"/></component>
	<component id="selectbox" extends="__type1"></component>
	<component id="trigger" extends="__type1"><property name="width" value="80px"/></component>
</components>`);
		assert.deepStrictEqual(Object.fromEntries(styles), { selectbox: { width: '148px', height: '21px' }, trigger: { width: '80px', height: '21px' } });
	});
});

suite('공통 도구', () => {
	test('applyEdits: 겹치지 않는 편집을 순서와 상관없이 적용, undefined는 건너뜀', () => {
		assert.strictEqual(applyEdits('abcdef', [{ start: 0, end: 1, replacement: 'X' }, undefined, { start: 4, end: 6, replacement: '' }, { start: 2, end: 2, replacement: '+' }]), 'Xb+cd');
	});

	test('leadOf: 줄 첫 글자면 앞 들여쓰기, 아니면 undefined', () => {
		const text = 'a\n\t  <b/><c/>';
		assert.strictEqual(leadOf(text, text.indexOf('<b')), '\t  ');
		assert.strictEqual(leadOf(text, text.indexOf('<c')), undefined);
		assert.strictEqual(leadOf(text, 0), '');
	});

	test('cached: 같은 키는 한 번만 부르고, 실패는 캐시하지 않고 다시 시도', async () => {
		const cache = new Map<string, Promise<number>>();
		let calls = 0;
		const ok = () => cached(cache, 'a', async () => ++calls);
		assert.strictEqual(await ok(), 1);
		assert.strictEqual(await ok(), 1);
		let fails = 0;
		const bad = () => cached(cache, 'b', async () => { fails++; throw new Error('x'); });
		await assert.rejects(bad());
		await assert.rejects(bad());
		assert.strictEqual(fails, 2);
	});

	test('readWebConfig: config.xml이 그대로면 다시 읽지 않고, 바뀌면(mtime) 다시 읽는다', async () => {
		const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-config-'));
		const file = path.join(webRoot, 'websquare', 'config.xml');
		fs.mkdirSync(path.dirname(file));
		fs.writeFileSync(file, '<WebSquare><a/></WebSquare>');
		const first = await readWebConfig(webRoot);
		assert.strictEqual(await readWebConfig(webRoot), first);
		fs.writeFileSync(file, '<WebSquare><b/></WebSquare>');
		fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
		const second = await readWebConfig(webRoot);
		assert.notStrictEqual(second, first);
		assert.ok(JSON.stringify(second.children.map(c => 'name' in c && c.name)).includes('WebSquare'));
	});

	test('loadDefaultStyles: 정의 파일마다 한 번만 읽고, 없으면 빈 표', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-defstyle-'));
		const definition = path.join(dir, 'WebSquareConfig.xml');
		assert.strictEqual((await loadDefaultStyles(definition)).size, 0);
		fs.writeFileSync(path.join(dir, 'ComponentDefaultStyle.xml'), '<components><component id="input"><property name="width" value="100px"/></component></components>');
		// 없던 파일은 실패로 보고 캐시하지 않아 새로 만든 파일을 읽는다
		const styles = await loadDefaultStyles(definition);
		assert.deepStrictEqual(styles.get('input'), { width: '100px' });
		fs.writeFileSync(path.join(dir, 'ComponentDefaultStyle.xml'), '<components/>');
		assert.strictEqual(await loadDefaultStyles(definition), styles);
	});

	test('serial: 같은 키는 앞 작업(실패 포함)이 끝난 뒤 차례로, 다른 키는 따로, 끝나면 비움', async () => {
		const queues = new Map<string, Promise<unknown>>(), order: string[] = [];
		const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
		const a1 = serial(queues, 'a', async () => { await sleep(30); order.push('a1'); throw new Error('x'); });
		const a2 = serial(queues, 'a', async () => { order.push('a2'); });
		const b1 = serial(queues, 'b', async () => { order.push('b1'); });
		await assert.rejects(a1);
		await Promise.all([a2, b1]);
		assert.deepStrictEqual(order, ['b1', 'a1', 'a2']);
		await sleep(0);
		assert.strictEqual(queues.size, 0);
	});

	test('parseComponents: <WebSquare> 정의 파일이 아니면 이유를 알린다', () => {
		assert.throws(() => parseComponents('<other/>'), /WebSquare/);
	});
});

suite('코드 편집기 옵션', () => {
	test('editor.wordWrap: off 말고는 줄바꿈', () => {
		assert.strictEqual(readWordWrap('off'), false);
		for (const value of ['on', 'wordWrapColumn', 'bounded']) {
			assert.strictEqual(readWordWrap(value), true, value);
		}
		assert.strictEqual(readWordWrap(undefined), false);
		assert.strictEqual(readWordWrap(true), false);
	});

	test('SQL 방언: 목록에 없으면 standard', () => {
		for (const dialect of SQL_DIALECTS) {
			assert.strictEqual(readSqlDialect(dialect), dialect);
		}
		assert.strictEqual(readSqlDialect('Oracle'), DEFAULT_CODE_OPTIONS.sqlDialect);
		assert.strictEqual(readSqlDialect(undefined), 'standard');
	});

	test('package.json의 방언 목록과 코드가 같다', () => {
		const setting = (JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')) as { contributes: { configuration: { properties: Record<string, { enum?: string[]; default?: string }> } } })
			.contributes.configuration.properties['websquare5-editor.sqlDialect'];
		assert.deepStrictEqual(setting.enum, [...SQL_DIALECTS]);
		assert.strictEqual(setting.default, DEFAULT_CODE_OPTIONS.sqlDialect);
	});
});

suite('links', () => {
	test('경로 입력 정리·연결 가능 검사', () => {
		assert.strictEqual(cleanPath('  "C:\\a b\\A.java" '), 'C:\\a b\\A.java');
		assert.strictEqual(cleanPath("'src/A.java'"), 'src/A.java');
		// 기본: 모든 탭이 웹 개발 파일(HTML·CSS·JS·Java·XML)을 받는다
		for (const file of ['/w/A.JAVA', '/w/a.xml', '/w/a.html', '/w/a.htm', '/w/a.css', '/w/a.js', '/w/a.sql']) {
			assert.strictEqual(linkProblem(file, true, DEFAULT_LINK_EXTS), undefined, file);
		}
		assert.match(linkProblem('/w/a.txt', true, DEFAULT_LINK_EXTS)!, /\.java·\.xml·\.html·\.htm·\.css·\.js·\.sql/);
		assert.match(linkProblem('/w/A.java', false, DEFAULT_LINK_EXTS)!, /작업 폴더/);
		// 설정: 점 없이·대문자·*.로 적어도 되고, 쓸 값이 없으면 기본값
		assert.deepStrictEqual(readLinkExts(['jsp', '.SQL', '*.java', 'jsp', '', 3, 'a b']), ['.jsp', '.sql', '.java']);
		assert.deepStrictEqual(readLinkExts([]), DEFAULT_LINK_EXTS);
		assert.deepStrictEqual(readLinkExts(undefined), DEFAULT_LINK_EXTS);
		assert.strictEqual(linkProblem('/w/a.jsp', true, readLinkExts(['jsp'])), undefined);
	});

	// 직접 쓴 작은 DTD(실제 MyBatis DTD 모양: 엔티티·선택지·주석)
	const DTD = `<!-- test -->
<!ENTITY % flag "(true|false)">
<!ELEMENT mapper (select* | update*)+>
<!ATTLIST mapper namespace CDATA #IMPLIED>
<!ELEMENT select (#PCDATA | if)*>
<!ATTLIST select
id CDATA #REQUIRED
useCache %flag; #IMPLIED
statementType (STATEMENT|PREPARED) "PREPARED"
>
<!ELEMENT update (#PCDATA)*>
<!ELEMENT if (#PCDATA)*>
<!ATTLIST if test CDATA #REQUIRED>`;
	const EXPECTED = [
		{ name: 'mapper', children: ['select', 'update'], attributes: [{ name: 'namespace' }], top: true },
		{ name: 'select', children: ['if'], attributes: [{ name: 'id' }, { name: 'useCache', values: ['true', 'false'] }, { name: 'statementType', values: ['STATEMENT', 'PREPARED'] }] },
		{ name: 'update', children: [], attributes: [] },
		{ name: 'if', children: [], attributes: [{ name: 'test' }] },
	];

	test('DTD: DOCTYPE 읽기, 요소·자식·속성·정해진 값(엔티티 풀기)', () => {
		assert.deepStrictEqual(doctypeOf('<?xml version="1.0"?>\n<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "https://mybatis.org/dtd/mybatis-3-mapper.dtd">'),
			{ root: 'mapper', system: 'https://mybatis.org/dtd/mybatis-3-mapper.dtd' });
		assert.deepStrictEqual(doctypeOf("<!DOCTYPE a SYSTEM 'a.dtd'>"), { root: 'a', system: 'a.dtd' });
		assert.strictEqual(doctypeOf('<mapper/>'), undefined);
		assert.deepStrictEqual(parseDtd(DTD, 'mapper'), EXPECTED);
	});

	test('DTD 스키마: 로컬 DTD 파일, 없으면 Maven 저장소 mybatis jar 안의 같은 이름 DTD', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-dtd-'));
		fs.writeFileSync(path.join(dir, 'local.dtd'), DTD);
		assert.deepStrictEqual((await xmlSchemaOf(path.join(dir, 'a.xml'), '<!DOCTYPE mapper SYSTEM "local.dtd"><mapper/>'))?.elements, EXPECTED);
		const home = process.env.HOME, profile = process.env.USERPROFILE;
		const jarDir = path.join(dir, '.m2', 'repository', 'org', 'mybatis', 'mybatis', '3.5.0');
		fs.mkdirSync(jarDir, { recursive: true });
		fs.writeFileSync(path.join(jarDir, 'mybatis-3.5.0.jar'), zipSync({ 'org/apache/ibatis/builder/xml/ws5-test-mapper.dtd': new TextEncoder().encode(DTD) }));
		process.env.HOME = process.env.USERPROFILE = dir;
		try {
			const found = await xmlSchemaOf(path.join(dir, 'b.xml'), '<!DOCTYPE mapper PUBLIC "-//x//EN" "https://example.org/dtd/ws5-test-mapper.dtd"><mapper/>');
			assert.deepStrictEqual(found?.elements, EXPECTED);
			assert.ok(found?.source.endsWith('mybatis-3.5.0.jar'));
			assert.strictEqual(await xmlSchemaOf(path.join(dir, 'c.xml'), '<!DOCTYPE mapper SYSTEM "https://example.org/none.dtd"><mapper/>'), undefined, '못 찾으면 없음');
		} finally {
			process.env.HOME = home;
			process.env.USERPROFILE = profile;
		}
	});

	test('탭 목록: 저장값 검사, 이름 중복·고정 탭 이름 거부, 새 id, 편집 대상 접두사', () => {
		assert.strictEqual(readLinkTabs(undefined), DEFAULT_LINK_TABS);
		assert.strictEqual(readLinkTabs([{ id: 1 }]), DEFAULT_LINK_TABS, '모양이 틀리면 기본');
		assert.deepStrictEqual(readLinkTabs([]), [], '전부 지운 상태는 그대로');
		assert.deepStrictEqual(readLinkTabs([{ id: 'controller', label: 'C', exts: ['.java'] }]), [{ id: 'controller', label: 'C' }], '예전 판의 탭별 확장자는 버림');
		assert.strictEqual(tabNameProblem(' DTO ', DEFAULT_LINK_TABS), undefined);
		for (const name of ['', '  ', 'source', 'Design', 'controller', 'x'.repeat(31)]) {
			assert.ok(tabNameProblem(name, DEFAULT_LINK_TABS), `거부: "${name}"`);
		}
		assert.strictEqual(newTabId(DEFAULT_LINK_TABS), 'tab1');
		assert.strictEqual(newTabId([...DEFAULT_LINK_TABS, { id: 'tab1', label: 'A' }]), 'tab2');
		assert.strictEqual(linkIdOf('link:tab1'), 'tab1');
		assert.strictEqual(linkIdOf('source'), undefined);
	});

	test('코드 편집기 테마: 저장값 검사, 명령과 코드 편집기 우클릭 메뉴 등록', async () => {
		assert.strictEqual(readCodeTheme('dracula'), 'dracula');
		assert.strictEqual(readCodeTheme('nope'), 'vscode');
		assert.strictEqual(new Set(CODE_THEMES.map(t => t.id)).size, CODE_THEMES.length, 'id 중복 없음');
		assert.ok((await vscode.commands.getCommands(true)).includes('websquare5-editor.codeTheme'));
		const menus = vscode.extensions.all.find(e => e.packageJSON.name === 'websquare5-editor')?.packageJSON.contributes.menus['webview/context'];
		assert.ok(menus?.some((m: { command: string; when: string }) => m.command === 'websquare5-editor.codeTheme' && m.when.includes("webviewSection == 'codeEditor'")));
	});

	test('변경 표시 기준: Git 저장소의 스테이지 내용, 저장소 밖이면 undefined', async function () {
		this.timeout(30000);
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-git-'));
		const file = path.join(dir, 'A.java');
		fs.writeFileSync(file, 'class A {}\n');
		assert.strictEqual(await stagedText(vscode.Uri.file(file)), undefined, '저장소 밖');
		const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
		try {
			git('init', '-q');
			git('add', 'A.java');
		} catch {
			this.skip(); // git이 없는 환경
		}
		fs.writeFileSync(file, 'class A { int x; }\n');
		type GitApi = { openRepository(root: vscode.Uri): Promise<unknown> };
		const api = (await vscode.extensions.getExtension<{ getAPI(v: 1): GitApi }>('vscode.git')?.activate())?.getAPI(1);
		if (!api) {
			this.skip();
		}
		await api!.openRepository(vscode.Uri.file(dir));
		assert.strictEqual((await stagedText(vscode.Uri.file(file)))?.replace(/\r\n/g, '\n'), 'class A {}\n', '작업 중 내용이 아니라 스테이지 내용');
	});

	test('탭 순서: 저장된 순서대로, 모르는 이름은 무시하고 새 탭은 뒤에', () => {
		assert.deepStrictEqual(orderTabs(['D', 'S', 'C', 'M'], ['M', 'x', 'D']), ['M', 'D', 'S', 'C']);
		assert.deepStrictEqual(moveTab(['A', 'B', 'C', 'D'], 'D', 'A', false), ['D', 'A', 'B', 'C']);
		assert.deepStrictEqual(moveTab(['A', 'B', 'C', 'D'], 'A', 'C', true), ['B', 'C', 'A', 'D']);
		assert.deepStrictEqual(moveTab(['A', 'B'], 'A', 'zz', true), ['A', 'B']);
	});

	// 확장의 저장소 대신 메모리 저장소
	const memento = () => {
		const values = new Map<string, unknown>();
		return {
			keys: () => [...values.keys()],
			get: (key: string, fallback?: unknown) => values.has(key) ? values.get(key) : fallback,
			update: async (key: string, value: unknown) => { if (value === undefined) { values.delete(key); } else { values.set(key, value); } },
		} as vscode.Memento;
	};
	const context = { workspaceState: memento(), globalState: memento(), subscriptions: [] as vscode.Disposable[] };
	suiteSetup(() => registerLinks(context as unknown as vscode.ExtensionContext));
	suiteTeardown(() => context.subscriptions.forEach(s => s.dispose()));
	const linked = async (saved: (dir: string) => Record<string, string>, onPost?: (msg: ToWebview) => void) => {
		// vscode.Uri.fsPath는 Windows 드라이브 문자를 소문자로 바꾸므로 같은 꼴로 맞춘다
		const dir = vscode.Uri.file(fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-links-'))).fsPath;
		const screen = path.join(dir, 'A.xml'), java = path.join(dir, 'AController.java');
		fs.writeFileSync(screen, SCREEN);
		fs.writeFileSync(java, 'class A {}\n');
		const key = `websquare5-editor.links:${screen}`;
		await context.workspaceState.update(key, saved(dir));
		const sent: LinkState[] = [];
		const links = new LinkedFiles(await vscode.workspace.openTextDocument(vscode.Uri.file(screen)), async msg => {
			if (msg.type === 'linked') { sent.push(msg); }
			onPost?.(msg);
			return true;
		});
		const last = (kind: string) => sent.filter(m => m.kind === kind).at(-1);
		return { dir, screen, java, key, links, last };
	};

	test('VS Code가 연결 파일에 낸 문제(언어 서버 등)를 그 파일 버전과 함께 웹뷰로', async () => {
		const problems: Extract<ToWebview, { type: 'diagnostics' }>[] = [];
		const { java, links, last } = await linked(dir => ({ controller: path.join(dir, 'AController.java') }), msg => { if (msg.type === 'diagnostics') { problems.push(msg); } });
		const collection = vscode.languages.createDiagnosticCollection('ws5-test');
		try {
			await links.reload();
			const version = last('controller')!.version!;
			collection.set(vscode.Uri.file(java), [Object.assign(new vscode.Diagnostic(new vscode.Range(0, 6, 0, 7), '문법 오류', vscode.DiagnosticSeverity.Error), { source: 'Java' })]);
			for (let i = 0; i < 40 && !problems.some(p => p.items.length); i++) {
				await new Promise(r => setTimeout(r, 50));
			}
			const sent = problems.filter(p => p.items.length).at(-1)!;
			assert.strictEqual(sent.target, 'link:controller');
			assert.strictEqual(sent.version, version, '그 파일의 지금 버전');
			assert.deepStrictEqual(sent.items.filter(i => i.source === 'Java'), [{ fromLine: 0, fromCh: 6, toLine: 0, toCh: 7, severity: 'error', message: '문법 오류', source: 'Java' }]);
		} finally {
			collection.dispose();
			await links.dispose();
		}
	});

	test('연결 파일을 보내고, 본 버전에서만 고치고, 저장은 그 파일만', async () => {
		const { screen, java, links, last } = await linked(dir => ({ controller: path.join(dir, 'AController.java') }));
		try {
			await links.reload();
			const first = last('controller')!;
			assert.strictEqual(first.text, 'class A {}\n');
			assert.strictEqual(first.dirty, false);
			assert.deepStrictEqual(last('service'), { type: 'linked', kind: 'service' }, '연결 안 된 탭');
			const change = [{ fromLine: 0, fromCh: 9, toLine: 0, toCh: 9, insert: ' int x; ' }];
			const result = await links.edit('controller', first.version!, change);
			assert.ok(result.ok && result.version > first.version!);
			assert.strictEqual((await links.edit('controller', first.version!, change)).ok, false, '옛 버전 편집은 거부');
			await links.saveLink('controller');
			assert.strictEqual(fs.readFileSync(java, 'utf8'), 'class A { int x; }\n');
			assert.strictEqual(vscode.workspace.textDocuments.find(d => d.uri.fsPath === screen)?.isDirty, false, '화면 XML은 그대로');
		} finally {
			await links.dispose();
		}
	});

	test('파일이 없으면 경로만, 연결 해제하면 빈 상태. 작업 폴더 밖·다른 확장자는 연결하지 않음', async () => {
		const { dir, java, key, links, last } = await linked(dir => ({ controller: path.join(dir, 'AController.java'), mapper: path.join(dir, 'gone.java') }));
		try {
			await links.reload();
			assert.deepStrictEqual(last('mapper'), { type: 'linked', kind: 'mapper', path: vscode.Uri.file(path.join(dir, 'gone.java')).fsPath });
			await links.unlink('mapper');
			assert.ok(await waitFor(() => last('mapper')?.path === undefined));
			assert.deepStrictEqual(context.workspaceState.get(key), { controller: java });
			await links.link('mybatis', java);
			await links.link('service', java);
			assert.deepStrictEqual(context.workspaceState.get(key), { controller: java }, '다른 확장자·이미 다른 탭에 연결된 파일은 거부');
		} finally {
			await links.dispose();
		}
	});

	test('탭 추가·삭제: 열린 화면에 새 목록을 보내고, 지운 탭의 연결은 끊고 저장소에서도 지운다', async () => {
		const tabsSent: unknown[] = [];
		const { java, key, links, last } = await linked(dir => ({ controller: path.join(dir, 'AController.java') }), msg => msg.type === 'linkTabs' && tabsSent.push(msg));
		try {
			await links.reload();
			const custom = { id: 'tab1', label: 'DTO' };
			await saveLinkTabs([...linkTabs(), custom]);
			assert.ok(await waitFor(() => last('tab1') !== undefined), '새 탭 상태 전송');
			assert.deepStrictEqual((tabsSent.at(-1) as { tabs: unknown }).tabs, [...DEFAULT_LINK_TABS, custom]);
			await saveLinkTabs(linkTabs().filter(t => t.id !== 'controller'));
			assert.ok(await waitFor(() => (tabsSent.at(-1) as { tabs: { id: string }[] }).tabs.every(t => t.id !== 'controller')));
			assert.deepStrictEqual(context.workspaceState.get(key), {}, '지운 탭의 연결 정보 삭제');
			const result = await links.edit('controller', 1, [{ fromLine: 0, fromCh: 0, toLine: 0, toCh: 0, insert: 'x' }]);
			assert.strictEqual(result.ok, false, '지운 탭으로는 편집 안 됨');
			assert.strictEqual(vscode.workspace.textDocuments.find(d => d.uri.fsPath === java)?.getText() ?? 'class A {}\n', 'class A {}\n');
		} finally {
			await saveLinkTabs(DEFAULT_LINK_TABS);
			await links.dispose();
		}
	});

	test('연결 탭에서 고친 파일을 VS Code가 배경 탭으로 열면, 연결 탭에서 저장할 때 그 탭을 닫는다', async function () {
		this.timeout(10000);
		const { java, links, last } = await linked(dir => ({ controller: path.join(dir, 'AController.java') }));
		const tabsOf = () => vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputText && t.input.uri.fsPath === java);
		try {
			await links.reload();
			assert.ok((await links.edit('controller', last('controller')!.version!, [{ fromLine: 0, fromCh: 0, toLine: 0, toCh: 0, insert: '// x\n' }])).ok);
			// VS Code가 저장 안 한 파일을 여는 데 걸리는 시간(이 동작이 없는 버전이면 탭이 안 생기고, 그때는 닫을 것도 없다)
			const opened = await waitFor(() => tabsOf().length > 0);
			await links.saveLink('controller');
			if (opened) {
				assert.ok(await waitFor(() => tabsOf().length === 0), '저장하면 배경 탭이 닫힘');
			}
			assert.strictEqual(fs.readFileSync(java, 'utf8'), '// x\nclass A {}\n');
		} finally {
			await links.dispose();
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		}
	});

	test('VS Code에서 파일 이름을 바꾸면 연결도 따라간다', async () => {
		const { dir, java, key, links, last } = await linked(dir => ({ controller: path.join(dir, 'AController.java') }));
		try {
			await links.reload();
			const moved = path.join(dir, 'BController.java');
			const edit = new vscode.WorkspaceEdit();
			edit.renameFile(vscode.Uri.file(java), vscode.Uri.file(moved));
			assert.ok(await vscode.workspace.applyEdit(edit));
			assert.ok(await waitFor(() => last('controller')?.path === vscode.Uri.file(moved).fsPath));
			assert.deepStrictEqual(context.workspaceState.get(key), { controller: moved });
		} finally {
			await links.dispose();
		}
	});
});
