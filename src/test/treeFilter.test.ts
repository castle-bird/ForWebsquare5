import * as assert from 'assert';
import { filterTree } from '../core/treeFilter';
import { findNode, parseXml, type XmlNode } from '../core/xmlModel';

const root = parseXml('<body><group id="grp_top" class="wrap"><button id="btn_save" class="btn primary"/><button id="btn_cancel"/></group><input id="ipt_name"/></body>')!;
const labels = (n: XmlNode) => [n.tag, n.attrs.id ?? '', n.attrs.class?.split(' ').map(c => `.${c}`).join('') ?? ''];
const children = (n: XmlNode) => n.children;
const byId = (id: string) => findNode(root, n => n.attrs.id === id)!;
const ids = (set: Set<XmlNode>) => [...set].map(n => n.attrs.id ?? n.tag);

suite('트리 검색', () => {
	test('검색어가 비면 걸러내지 않는다', () => {
		assert.strictEqual(filterTree([root], children, labels, ''), undefined);
		assert.strictEqual(filterTree([root], children, labels, '  \t '), undefined);
	});
	test('맞는 노드와 그 조상만 남기고, 맞지 않는 형제는 뺀다', () => {
		const found = filterTree([root], children, labels, 'save')!;
		assert.deepStrictEqual(ids(found.match), ['btn_save']);
		assert.deepStrictEqual(ids(found.keep).sort(), ['body', 'btn_save', 'grp_top']);
		assert.ok(!found.keep.has(byId('btn_cancel')) && !found.keep.has(byId('ipt_name')));
	});
	test('대소문자 무시, id·태그·class 어디든, 낱말은 모두 맞아야 한다', () => {
		assert.deepStrictEqual(ids(filterTree([root], children, labels, 'BTN_CAN')!.match), ['btn_cancel']);
		assert.deepStrictEqual(ids(filterTree([root], children, labels, '.primary')!.match), ['btn_save']);
		assert.deepStrictEqual(ids(filterTree([root], children, labels, 'button primary')!.match), ['btn_save']);
		assert.deepStrictEqual(ids(filterTree([root], children, labels, 'button nothing')!.match), []);
	});
	test('조상도 맞으면 함께 맞고, 맞는 노드가 없으면 keep도 비어 있다', () => {
		const found = filterTree([root], children, labels, 'btn')!;
		assert.deepStrictEqual(ids(found.match), ['btn_save', 'btn_cancel']);
		assert.deepStrictEqual(filterTree([root], children, labels, 'zzz')!.keep.size, 0);
		assert.deepStrictEqual(filterTree([root], children, labels, 'grp')!.terms, ['grp']);
	});
	test('보이는 트리의 자식 목록만 따른다(숨겨진 자식은 보지 않는다)', () => {
		const found = filterTree([root], n => n.attrs.id === 'grp_top' ? [] : n.children, labels, 'btn')!;
		assert.strictEqual(found.match.size, 0);
	});
});
