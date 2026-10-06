import * as assert from 'assert';
import { parseXml } from '../core/xmlModel';
import { applyEdits } from '../core/edit';
import { editHistory, readHistory } from '../core/info';

const NS = 'xmlns="http://www.w3.org/1999/xhtml" xmlns:w2="http://www.inswave.com/websquare"';
const headOf = (text: string) => { const root = parseXml(text)!; return { root, head: root.children.find(c => c.tag === 'head')! }; };
const row = (no: string, desc: string, date = '20250101', user = 'zz') => ({ no, desc, date, user });

suite('Info 탭 개정 이력', () => {
	test('있는 historyInfo를 다시 쓰고(들여쓰기·접두사 유지) 바뀐 게 없으면 편집 없음', () => {
		const text = `<html ${NS}>\n\t<head meta_programId="BM003M01">\n\t\t<w2:historyInfo>\n\t\t\t<w2:history meta_no="1" meta_desc="asd" meta_date="20250101" meta_user="zz"></w2:history>\n\t\t</w2:historyInfo>\n\t\t<w2:type>COMPONENT</w2:type>\n\t</head>\n\t<body/>\n</html>`;
		const { root, head } = headOf(text);
		assert.deepStrictEqual(readHistory(head), [row('1', 'asd')]);
		assert.strictEqual(editHistory(text, root, head, [row('1', 'asd')]), undefined);
		const out = applyEdits(text, [editHistory(text, root, head, [row('1', 'asd'), row('2', 'a"<&b')])]);
		assert.ok(out.includes('\t\t<w2:historyInfo>\n\t\t\t<w2:history meta_no="1" meta_desc="asd" meta_date="20250101" meta_user="zz"></w2:history>\n'
			+ '\t\t\t<w2:history meta_no="2" meta_desc="a&quot;&lt;&amp;b" meta_date="20250101" meta_user="zz"></w2:history>\n\t\t</w2:historyInfo>\n\t\t<w2:type>'), out);
		assert.deepStrictEqual(readHistory(headOf(out).head).map(r => r.desc), ['asd', 'a"<&b']);
		const empty = applyEdits(text, [editHistory(text, root, head, [])]);
		assert.ok(empty.includes('<w2:historyInfo></w2:historyInfo>'), empty);
	});

	test('historyInfo가 없으면 head 맨 앞에 만들고(CRLF·공백 들여쓰기), 다른 내용이 섞이면 거부', () => {
		const text = `<html ${NS}>\r\n    <head>\r\n        <xf:model/>\r\n    </head>\r\n</html>`;
		const { root, head } = headOf(text);
		const out = applyEdits(text, [editHistory(text, root, head, [row('1', 'x')])]);
		assert.strictEqual(out, `<html ${NS}>\r\n    <head>\r\n        <w2:historyInfo>\r\n            <w2:history meta_no="1" meta_desc="x" meta_date="20250101" meta_user="zz"></w2:history>\r\n        </w2:historyInfo>\r\n        <xf:model/>\r\n    </head>\r\n</html>`);
		const mixed = `<html ${NS}><head><w2:historyInfo><!-- keep --><w2:history meta_no="1"/></w2:historyInfo></head></html>`;
		const m = headOf(mixed);
		assert.throws(() => editHistory(mixed, m.root, m.head, []));
		const bare = '<html><head><title/></head></html>', b = headOf(bare);
		assert.throws(() => editHistory(bare, b.root, b.head, [row('1', 'x')]), /namespace/);
	});
});
