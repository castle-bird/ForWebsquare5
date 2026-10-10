import * as assert from 'assert';
import { applyEdits } from '../core/edit';
import { prepareNodeEdit, type NodeEdit } from '../core/nodeEdit';
import { findNode, parseXml } from '../core/xmlModel';

const indexOf = (text: string, id: string) => findNode(parseXml(text)!, n => n.attrs.id === id)!.index;
const plan = (text: string, message: NodeEdit) => {
	const result = prepareNodeEdit(text, message);
	assert.ok(result && !('error' in result));
	return result;
};

suite('XML 편집 계획', () => {
	test('중복 ID는 편집 없이 오류로 반환하고, 그리드 칸끼리 맞바꾸기는 허용', () => {
		const text = '<html><body><w2:gridView id="g"><w2:gBody><w2:row><w2:column id="a"/><w2:column id="b"/></w2:row></w2:gBody></w2:gridView></body></html>';
		const g = indexOf(text, 'g'), a = indexOf(text, 'a'), b = indexOf(text, 'b');
		const conflict = prepareNodeEdit(text, { type: 'setAttr', version: 1, index: a, name: 'id', value: 'b' });
		assert.ok(conflict && 'error' in conflict);
		assert.match(conflict.error, /이미 사용 중인 ID/);
		const swapped = plan(text, { type: 'editGridCells', version: 1, index: g, popup: 'p', cells: [{ index: a, attrs: { id: 'b' } }, { index: b, attrs: { id: 'a' } }] });
		assert.strictEqual(applyEdits(text, swapped.changes), text.replace('id="a"', 'id="TEMP"').replace('id="b"', 'id="a"').replace('id="TEMP"', 'id="b"'));
		assert.deepStrictEqual(prepareNodeEdit(text, { type: 'editGridCells', version: 1, index: g, popup: 'p', cells: [{ index: a, attrs: { id: 'b' } }] }), conflict);
	});

	test('여러 노드는 한 계획으로, 같은 노드 중복은 첫 값만, 없는 노드는 전체 거부', () => {
		const text = "<html><body><a id='a'/><b id='b'/></body></html>";
		const a = indexOf(text, 'a'), b = indexOf(text, 'b');
		const request: NodeEdit = { type: 'setAttr', version: 1, index: a, name: 'value', value: 'x', more: [{ index: b, value: 'y' }, { index: a, value: 'ignored' }] };
		const changed = plan(text, request);
		assert.strictEqual(changed.changes.length, 2);
		assert.strictEqual(applyEdits(text, changed.changes), "<html><body><a id='a' value=\"x\"/><b id='b' value=\"y\"/></body></html>");
		assert.strictEqual(prepareNodeEdit(text, { ...request, more: [{ index: 999, value: 'z' }] }), undefined);
		assert.strictEqual(plan(text, { type: 'setAttr', version: 1, index: a, name: 'id', value: 'a' }).changes.length, 0);
		assert.throws(() => prepareNodeEdit(text, { ...request, name: 'bad name' }));
	});

	test('데이터·컬럼 ID 변경과 관련 바인딩을 같은 계획에 담고 성공 알림을 반환', () => {
		const text = '<html xmlns:w2="http://www.inswave.com/websquare"><head><xf:model><w2:dataCollection><w2:dataList id="list"><w2:columnInfo><w2:column id="name"/></w2:columnInfo></w2:dataList></w2:dataCollection></xf:model></head><body><w2:gridView dataList="data:list"/><xf:input ref="data:list.name"/></body></html>';
		const changed = plan(text, { type: 'setAttr', version: 1, index: indexOf(text, 'list'), name: 'id', value: 'renamed' });
		assert.strictEqual(applyEdits(text, changed.changes), text.replace('id="list"', 'id="renamed"').replaceAll('data:list', 'data:renamed'));
		assert.match(changed.notice!, /바인딩 2곳/);
		const column = plan(text, { type: 'setAttr', version: 1, index: indexOf(text, 'name'), name: 'id', value: 'title' });
		assert.strictEqual(applyEdits(text, column.changes), text.replace('id="name"', 'id="title"').replace('data:list.name', 'data:list.title'));
		assert.match(column.notice!, /바인딩 1곳/);
	});

	test('이동·삭제는 모든 대상이 있을 때만, 자기 자손으로 이동은 거부', () => {
		const text = '<html><body><a id="a"><b id="b"/></a><c id="c"/></body></html>';
		const a = indexOf(text, 'a'), b = indexOf(text, 'b'), c = indexOf(text, 'c');
		const moved = plan(text, { type: 'move', version: 1, dragged: c, target: a, position: 'before' });
		assert.strictEqual(applyEdits(text, moved.changes), '<html><body><c id="c"/><a id="a"><b id="b"/></a></body></html>');
		assert.throws(() => prepareNodeEdit(text, { type: 'move', version: 1, dragged: a, target: b, position: 'inside' }), /자기 자신/);
		assert.strictEqual(prepareNodeEdit(text, { type: 'delete', version: 1, index: a, more: [999] }), undefined);
		assert.strictEqual(prepareNodeEdit(text, { type: 'mergeCells', version: 1, index: a, more: [999] }), undefined);
	});

	test('Data 루트는 삭제하지 않고 하위 데이터·submission 삭제는 허용', () => {
		const text = '<html xmlns:d="http://www.inswave.com/websquare" xmlns:f="http://www.w3.org/2002/xforms"><head><f:model id="model"><d:dataCollection id="collection"><d:dataMap id="map"/><d:dataList id="list"/></d:dataCollection><f:submission id="submission"/></f:model></head><body/></html>';
		for (const id of ['model', 'collection']) {
			const request: NodeEdit = { type: 'delete', version: 1, index: indexOf(text, id) };
			assert.strictEqual(prepareNodeEdit(text, request), undefined, id + ' 루트 보호');
			assert.strictEqual(prepareNodeEdit(text, { ...request, index: indexOf(text, 'map'), more: [request.index] }), undefined, '루트가 섞인 다중 삭제는 전체 거부');
		}
		assert.strictEqual(prepareNodeEdit(text, { type: 'delete', version: 1, index: -1 }), undefined, '가상 Submission 루트');
		for (const id of ['map', 'list', 'submission']) {
			const removed = plan(text, { type: 'delete', version: 1, index: indexOf(text, id) });
			assert.ok(!findNode(parseXml(applyEdits(text, removed.changes))!, n => n.attrs.id === id));
		}
	});

	test('XML 문서가 없으면 적용하지 않고 DOCTYPE 거부는 유지', () => {
		const request: NodeEdit = { type: 'setText', version: 1, index: 0, value: 'changed' };
		assert.strictEqual(prepareNodeEdit('', request), undefined);
		assert.throws(() => prepareNodeEdit('<!DOCTYPE html><html/>', request), /DOCTYPE/);
	});
});
