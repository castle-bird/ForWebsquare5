import * as assert from 'assert';
import { applyEdits } from '../core/edit';
import { prepareNodeEdit } from '../core/nodeEdit';
import { findNode, parseXml, type XmlNode } from '../core/xmlModel';

const screen = (script: string, body = '<w2:trigger id="btnSave" ev:onclick="scwin.btnSave_onclick"/><w2:trigger id="btnCopy" ev:onclick="scwin.btnSave_onclick"/>') =>
	`<html xmlns:w2="http://www.inswave.com/websquare" xmlns:ev="http://www.w3.org/2001/xml-events"><head><script type="text/javascript"><![CDATA[${script}]]></script></head><body>${body}</body></html>`;
const rename = (text: string, from: string, to: string) => {
	const index = findNode(parseXml(text)!, n => n.attrs.id === from)!.index;
	const result = prepareNodeEdit(text, { type: 'setAttr', version: 1, index, name: 'id', value: to });
	assert.ok(result && !('error' in result));
	return { text: applyEdits(text, result.changes), notice: result.notice ?? '' };
};

suite('id 바꾸기: Script·핸들러', () => {
	test('변수 참조·getComponentById·걸린 핸들러만 바꾸고, 글자·속성 이름·더 긴 이름은 그대로', () => {
		const script = [
			'scwin.btnSave_onclick = function (e) {',
			'\tbtnSave.setDisabled(true);',
			'\tvar c = $p.getComponentById("btnSave");',
			'\tvar msg = "%btnSave% 저장"; // btnSave 주석',
			'\tobj.btnSave = 1; var o = { btnSave: 2 };',
			'\tbtnSave2.hide(); scwin.btnSave_other();',
			'};',
			'scwin.f = function () { scwin.btnSave_onclick(); };',
		].join('\n');
		const { text, notice } = rename(screen(script), 'btnSave', 'btnNew');
		assert.strictEqual(text, screen([
			'scwin.btnNew_onclick = function (e) {',
			'\tbtnNew.setDisabled(true);',
			'\tvar c = $p.getComponentById("btnNew");',
			'\tvar msg = "%btnSave% 저장"; // btnSave 주석',
			'\tobj.btnSave = 1; var o = { btnSave: 2 };',
			'\tbtnSave2.hide(); scwin.btnSave_other();',
			'};',
			'scwin.f = function () { scwin.btnNew_onclick(); };',
		].join('\n'), '<w2:trigger id="btnNew" ev:onclick="scwin.btnNew_onclick"/><w2:trigger id="btnCopy" ev:onclick="scwin.btnNew_onclick"/>'));
		assert.match(notice, /`btnSave` 참조 2곳/);
		assert.match(notice, /`scwin\.btnSave_onclick` → `scwin\.btnNew_onclick`/);
	});

	test('같은 이름 변수가 있거나 새 핸들러 이름이 이미 있으면 그 부분은 그대로 두고 알린다', () => {
		const shadow = rename(screen('function f(btnSave) { btnSave.x(); }\nscwin.btnSave_onclick = function () {};'), 'btnSave', 'btnNew');
		assert.ok(shadow.text.includes('function f(btnSave) { btnSave.x(); }') && shadow.text.includes('scwin.btnNew_onclick = function'));
		assert.match(shadow.notice, /`btnSave` 변수가 있어 `btnSave` 참조 1곳은 그대로/);
		const taken = rename(screen('scwin.btnSave_onclick = function () {};\nscwin.btnNew_onclick = function () {};'), 'btnSave', 'btnNew');
		assert.ok(taken.text.includes('ev:onclick="scwin.btnSave_onclick"') && taken.text.includes('scwin.btnSave_onclick = function'));
		assert.match(taken.notice, /`scwin\.btnNew_onclick`가 이미 있어/);
	});

	test('Script 문법 오류면 id만 바꾸고 Script·핸들러는 그대로', () => {
		const before = screen('scwin.btnSave_onclick = function () { btnSave.x(;');
		const { text, notice } = rename(before, 'btnSave', 'btnNew');
		assert.strictEqual(text, before.replace('id="btnSave"', 'id="btnNew"'));
		assert.match(notice, /문법 오류/);
	});

	test('데이터 id는 Script 참조만(핸들러 없음), 그리드 칸 id는 Script를 안 본다', () => {
		const data = '<w2:dataList id="dlt_a"><w2:columnInfo><w2:column id="c"/></w2:columnInfo></w2:dataList><w2:gridView id="g"><w2:gBody><w2:row><w2:column id="c"/></w2:row></w2:gBody></w2:gridView>';
		const { text } = rename(screen('dlt_a.getRowCount(); c.x();', data), 'dlt_a', 'dlt_b');
		assert.ok(text.includes('dlt_b.getRowCount(); c.x();'));
		const before = screen('c.x();', data);
		const cells: XmlNode[] = [];
		const walk = (n: XmlNode) => { if (n.attrs.id === 'c') { cells.push(n); } n.children.forEach(walk); };
		walk(parseXml(before)!);
		const result = prepareNodeEdit(before, { type: 'setAttr', version: 1, index: cells.at(-1)!.index, name: 'id', value: 'd' });
		assert.ok(result && !('error' in result));
		assert.strictEqual(applyEdits(before, result.changes), before.replace('<w2:row><w2:column id="c"/>', '<w2:row><w2:column id="d"/>'));
	});
});
