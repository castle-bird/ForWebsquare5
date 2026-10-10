import * as assert from 'assert';
import { parseXml, findNode } from '../core/xmlModel';
import { selectionIndex } from '../core/selection';
import { pasteNode } from '../core/paste';
import { applyEdits } from '../core/edit';

suite('구조 편집 선택 유지', () => {
	const doc = (body: string) => {
		const text = '<html xmlns:xf="http://www.w3.org/2002/xforms" xmlns:w2="http://www.inswave.com/websquare"><head/><body>' + body + '</body></html>';
		return { text, root: parseXml(text)! };
	};
	const index = (d: ReturnType<typeof doc>, id: string) => findNode(d.root, n => n.attrs.id === id)!.index;
	test('Group Undo·Redo에서 내부·외부 컴포넌트 유지, 없어진 Group 선택 해제', () => {
		const before = doc('<xf:input id="a"/><xf:input id="b"/><xf:input id="c"/>');
		const after = doc('<xf:group id="group1"><xf:input id="a"/><xf:input id="b"/></xf:group><xf:input id="c"/>');
		for (const id of ['a', 'b', 'c']) {
			assert.strictEqual(selectionIndex(after, before, index(after, id)), index(before, id));
			assert.strictEqual(selectionIndex(before, after, index(before, id)), index(after, id));
		}
		assert.strictEqual(selectionIndex(after, before, index(after, 'group1')), undefined);
	});
	test('Group·단일 컴포넌트 붙여넣기는 기존 대상 선택 유지', () => {
		for (const id of ['', ' id="target"']) {
			for (const xml of ['<xf:input id="copy"/>', '<xf:group id="copy"><xf:input id="child"/></xf:group>']) {
				const before = doc('<xf:group' + id + ' class="target"/>');
				const target = findNode(before.root, n => n.attrs.class === 'target')!;
				const text = applyEdits(before.text, [pasteNode(before.text, before.root, target, xml)]);
				const after = { text, root: parseXml(text)! };
				const selected = findNode(after.root, n => n.attrs.class === 'target')!.index;
				assert.strictEqual(selectionIndex(before, after, target.index), selected);
				assert.strictEqual(selectionIndex(after, before, selected), target.index, 'Undo도 대상 유지');
			}
		}
		const before = doc('<xf:group class="target"/><xf:input/>');
		const after = doc('<xf:group class="target"><xf:group class="target"/></xf:group><xf:input/>');
		const target = findNode(before.root, n => n.attrs.class === 'target')!;
		assert.strictEqual(selectionIndex(before, after, target.index), undefined, '같은 속성이 중복되면 추측하지 않음');
	});
	test('서로 다른 그리드·헤더/바디의 같은 ID는 해당 범위에 유지', () => {
		const grids = '<w2:gridView id="g1"><w2:header><w2:column id="col"/></w2:header><w2:gBody><w2:column id="col"/></w2:gBody></w2:gridView><w2:gridView id="g2"><w2:gBody><w2:column id="col"/></w2:gBody></w2:gridView>';
		const before = doc(grids), after = doc('<xf:group id="group1"/>' + grids);
		const collect = (d: ReturnType<typeof doc>) => {
			const nodes: number[] = [];
			const visit = (n: typeof d.root) => { if (n.attrs.id === 'col') { nodes.push(n.index); } n.children.forEach(visit); };
			visit(d.root); return nodes;
		};
		assert.deepStrictEqual(collect(after).map(i => selectionIndex(after, before, i)), collect(before));
	});
	test('ID 없는 고유 요소·ID 변경·동일 문서·삭제 처리', () => {
		const before = doc('<xf:input value="one"/><xf:input id="a"/>');
		const after = doc('<xf:group id="group1"/><xf:input value="one"/><xf:input id="a"/>');
		const input = findNode(before.root, n => n.attrs.value === 'one')!;
		assert.strictEqual(selectionIndex(before, after, input.index), input.index + 1);
		assert.strictEqual(selectionIndex(before, doc('<xf:input value="one"/><xf:input id="renamed"/>'), index(before, 'a')), index(before, 'a'));
		assert.strictEqual(selectionIndex(before, doc('<xf:input value="one"/>'), index(before, 'a')), undefined);
		assert.strictEqual(selectionIndex(before, before, input.index), input.index);
		const duplicates = doc('<xf:input/><xf:input/>');
		const first = findNode(duplicates.root, n => n.tag === 'xf:input')!;
		assert.strictEqual(selectionIndex(duplicates, doc('<xf:input/>'), first.index), undefined, 'ID 없는 동일 요소 삭제는 엉뚱한 선택 대신 해제');
	});
});
