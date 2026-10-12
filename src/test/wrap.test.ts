import * as assert from 'assert';
import { applyEdits } from '../core/edit';
import { prepareNodeEdit } from '../core/nodeEdit';
import { findNode, parseXml, XFORMS_NS } from '../core/xmlModel';
import { wrapComponents } from '../core/wrap';

suite('그룹으로 감싸기', () => {
	const screen = (body: string, ns = 'xmlns:xf="' + XFORMS_NS + '"') => '<html ' + ns + '><head/><body>' + body + '</body></html>';
	const wrap = (text: string, ids: string[]) => {
		const root = parseXml(text)!;
		const nodes = ids.map(id => findNode(root, n => n.attrs.id === id)!);
		const result = prepareNodeEdit(text, { type: 'wrap', version: 1, index: nodes[0].index, more: nodes.slice(1).map(n => n.index) });
		assert.ok(result && !('error' in result));
		return applyEdits(text, result.changes);
	};
	test('단일 컴포넌트 원문·CDATA·이벤트 보존, 고유 Group ID 생성', () => {
		const raw = "<xf:group id='a' ev:onclick='scwin.click'><script><![CDATA[\n  const a = '<b>';\n]]></script></xf:group>";
		const text = screen('<xf:group id="group1"/>' + raw);
		const after = wrap(text, ['a']);
		assert.ok(after.includes(raw));
		const group = findNode(parseXml(after)!, n => n.attrs.id === 'group2')!;
		assert.strictEqual(group.tag, 'xf:group');
		assert.strictEqual(group.children[0].attrs.id, 'a');
	});
	test('다중 선택은 문서 순서대로 감싸고 비선택 형제·주석은 보존', () => {
		const text = screen('\r\n  <xf:input id="a"/>\r\n  <!-- keep -->\r\n  <xf:input id="b"/>\r\n  <xf:input id="c"/>\r\n');
		const after = wrap(text, ['c', 'a']);
		const root = parseXml(after)!, body = findNode(root, n => n.tag === 'body')!;
		assert.deepStrictEqual(body.children.map(n => n.attrs.id), ['group1', 'b']);
		assert.deepStrictEqual(body.children[0].children.map(n => n.attrs.id), ['a', 'c']);
		assert.ok(after.includes('<!-- keep -->'));
		assert.ok(!/(?:^|[^\r])\n/.test(after));
		assert.strictEqual(body.children[0].index, findNode(parseXml(text)!, n => n.attrs.id === 'a')!.index);
	});
	test('상속 네임스페이스 별칭·충돌·기본 네임스페이스 처리', () => {
		for (const [ns, tag] of [
			['xmlns:f="' + XFORMS_NS + '"', 'f:group'],
			['xmlns:xf="urn:other"', 'xf1:group'],
			['xmlns="' + XFORMS_NS + '"', 'group']
		]) {
			const after = wrap(screen('<input id="a"/>', ns), ['a']);
			assert.strictEqual(findNode(parseXml(after)!, n => n.attrs.id === 'group1')!.tag, tag);
			const { SaxesParser } = require('saxes');
			new SaxesParser({ xmlns: true }).write(after).close();
		}
	});
	test('서로 다른 부모·화면 구조·그리드 내부·표 구조·없는 인덱스 거부', () => {
		const text = screen('<xf:group id="p"><xf:input id="a"/></xf:group><xf:input id="b"/><w2:gridView id="g"><w2:column id="c"/></w2:gridView><xf:group id="t" tagname="table"><xf:group id="row" tagname="tr"/></xf:group>');
		const root = parseXml(text)!;
		for (const ids of [['a', 'b'], ['c'], ['row']]) {
			assert.throws(() => wrapComponents(text, root, ids.map(id => findNode(root, n => n.attrs.id === id)!)));
		}
		assert.throws(() => wrapComponents(text, root, [findNode(root, n => n.tag === 'body')!]));
		assert.strictEqual(prepareNodeEdit(text, { type: 'wrap', version: 1, index: 999 }), undefined);
		assert.strictEqual(prepareNodeEdit(text, { type: 'wrap', version: 1, index: findNode(root, n => n.attrs.id === 'b')!.index, more: [999] }), undefined);
	});
});
