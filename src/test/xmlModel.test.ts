import * as assert from 'assert';
import { nodeAt, parseXml, pathTo } from '../core/xmlModel';

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
});
