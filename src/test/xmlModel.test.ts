import * as assert from 'assert';
import { isWs, isXf, nodeAt, parseXml, pathTo } from '../core/xmlModel';

suite('XML 노드 조회', () => {
	test('루트·깊은 자식·형제를 원래 객체로 반환하고 없는 번호·undefined는 없음', () => {
		const root = parseXml('<html><head/><body><a><b/></a><c/></body></html>')!;
		const nodes = [root, root.children[0], root.children[1], root.children[1].children[0], root.children[1].children[0].children[0], root.children[1].children[1]];
		for (const n of nodes) {
			assert.strictEqual(nodeAt(root, n.index), n);
			assert.strictEqual(nodeAt(root, n.index), pathTo(root, n.index)?.at(-1));
		}
		assert.strictEqual(nodeAt(root, 99), undefined);
		assert.strictEqual(nodeAt(root), undefined);
	});

	test('하위 트리 밖과 연결 frame 안의 노드는 조회하지 않는다', () => {
		const root = parseXml('<html><body><frame/><a/></body></html>')!;
		const frame = root.children[0].children[0];
		frame.frame = parseXml('<html><body><b/><c/><d/></body></html>');
		assert.strictEqual(nodeAt(frame, root.index), undefined);
		assert.strictEqual(nodeAt(root, 4), undefined);
	});

	test('isWs·isXf: 접두어가 아니라 xmlns로 푼 namespace와 로컬 이름으로 판별', () => {
		const root = parseXml('<html xmlns:ws="http://www.inswave.com/websquare" xmlns:f="http://www.w3.org/2002/xforms" xmlns:w2="urn:other">'
			+ '<head><f:model><ws:dataCollection/></f:model></head><body><w2:gridView/><gridView xmlns="http://www.inswave.com/websquare"/></body></html>')!;
		const [head, body] = root.children, model = head.children[0];
		assert.ok(isXf(model, 'model') && !isWs(model, 'model'));
		assert.ok(isWs(model.children[0], 'dataCollection'), '다른 접두어(ws:)도 WebSquare');
		assert.ok(!isWs(body.children[0], 'gridView'), 'w2: 접두어라도 다른 namespace면 아님');
		assert.ok(isWs(body.children[1], 'gridView'), '기본 namespace(접두어 없음)');
		assert.ok(!isWs(undefined, 'gridView'));
	});
});
