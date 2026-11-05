import * as assert from 'assert';
import { dataFlow } from '../core/dataFlow';
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
});
