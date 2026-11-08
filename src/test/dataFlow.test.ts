import * as assert from 'assert';
import { applyDataFlow, dataFlow } from '../core/dataFlow';
import { emptyTables } from '../core/tables';
import { parseXml } from '../core/xmlModel';

suite('dataFlow', () => {
	const screen = (submissions: string) => parseXml(`<html xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms" xmlns:ev="http://www.w3.org/2001/xml-events"><head><xf:model><w2:dataCollection>
		<w2:dataMap id="dma_a"><w2:keyInfo><w2:key id="k1"/><w2:key id="k2"/></w2:keyInfo></w2:dataMap>
		<w2:dataList id="dlt_a"><w2:columnInfo><w2:column id="c1"/></w2:columnInfo></w2:dataList>
		</w2:dataCollection>${submissions}</xf:model></head><body/></html>`)!;

	test('요청·응답 데이터는 종류와 무관하게 id로 잇는다', () => {
		const [flow] = dataFlow(screen(`<xf:submission id="sbm_a" action="/a/list.do" method="post" mode="asynchronous"
			ref='data:json,[{"id":"dlt_a","action":"modified"},{"id":"dma_a"}]' target='data:json,{"id":"dma_a"}' ev:submitdone="scwin.sbm_a_submitdone"/>`));
		assert.strictEqual(flow.action, '/a/list.do');
		assert.deepStrictEqual(flow.request.items.map(i => [i.id, i.action, i.data?.kind]), [['dlt_a', 'modified', 'dataList'], ['dma_a', '', 'dataMap']]);
		assert.deepStrictEqual(flow.response.items.map(i => [i.id, i.data?.kind, i.data?.fields]), [['dma_a', 'dataMap', ['k1', 'k2']]]);
		assert.deepStrictEqual(flow.handlers, [{ event: 'submitdone', handler: 'scwin.sbm_a_submitdone' }]);
	});
	test('없는 데이터·해석 못 한 값·빈 값', () => {
		const [flow, empty] = dataFlow(screen(`<xf:submission id="s1" ref="data:json,dlt_none" target="/x"/><xf:submission id="s2"/>`));
		assert.strictEqual(flow.request.items[0].data, undefined);
		assert.deepStrictEqual(flow.response, { items: [], raw: '/x' });
		assert.deepStrictEqual([empty.request, empty.response, empty.handlers], [{ items: [] }, { items: [] }, []]);
	});
	test('모델이 없으면 빈 목록', () => {
		assert.deepStrictEqual(dataFlow(undefined), []);
	});
	test('ERD 그룹·도형·선 생성 및 기존 영역 비겹침', () => {
		const flows = dataFlow(screen(`<xf:submission id="sbm_a" action="/a/list.do" method="post"
			ref='data:json,[{"id":"dma_a"},{"id":"dlt_a","action":"modified"}]' target='data:json,{"id":"dlt_a"}'/>`));
		const base = {
			...emptyTables(),
			tables: [{ id: 't1', name: 'TB_USER', desc: '', crud: [], columns: [], keysOnly: false, color: '' as const, x: 100, y: 160 }],
		};
		const { data, ids } = applyDataFlow(base, flows);
		assert.ok(ids.length > 0);
		assert.strictEqual(data.tables.length, 1);
		assert.deepStrictEqual(data.groups.map(g => [g.title, g.color]), [
			['sbm_a', 'blue'],
			['Request', 'red'],
			['Response', 'green'],
		]);
		const [outer, req, res] = data.groups;
		assert.ok(outer.x >= 100 + 360 + 96, '기존 테이블 오른쪽 여백에 겹치지 않게 배치');
		assert.ok(req.x > outer.x && res.x + res.w < outer.x + outer.w, 'Request·Response가 Submission 그룹 안');
		assert.deepStrictEqual(data.shapes.map(s => [s.kind, s.text, s.color]), [
			['controller', '/a/list.do', 'blue'],
			['dataMap', 'dma_a', 'gray'],
			['dataList', 'dlt_a', 'gray'],
			['dataList', 'dlt_a', 'gray'],
		]);
		assert.strictEqual(data.links.length, 3);

		// 사용자가 그룹·도형 위치를 옮긴 뒤 다시 실행해도 커스텀 위치가 초기화되지 않는다
		const moved = {
			...data,
			groups: data.groups.map(g => ({ ...g, x: g.x + 200, y: g.y + 300 })),
			shapes: data.shapes.map(s => ({ ...s, x: s.x + 200, y: s.y + 300 })),
		};
		const again = applyDataFlow(moved, flows).data;
		assert.deepStrictEqual(again.groups.map(g => [g.x, g.y]), moved.groups.map(g => [g.x, g.y]));
		assert.deepStrictEqual(again.shapes.map(s => [s.x, s.y]), moved.shapes.map(s => [s.x, s.y]));
	});
});
