import assert from 'node:assert/strict';

export default async function ({ page }) {
	await page.evaluate(() => {
		const text = '<html xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms" xmlns:ev="http://www.w3.org/2001/xml-events"><head><xf:model><w2:dataCollection baseNode="map"><w2:dataMap id="dma1"><w2:keyInfo><w2:key id="k1"/></w2:keyInfo></w2:dataMap><w2:dataList id="dl1"><w2:columnInfo><w2:column id="c1"/></w2:columnInfo></w2:dataList></w2:dataCollection><xf:submission id="sbm1" action="/a/list.do" method="post" ref=\'data:json,[{"id":"dl1","action":"modified"}]\' target=\'data:json,{"id":"dma1"}\' ev:submitdone="scwin.sbm1_submitdone"/><xf:submission id="sbm_bad" action="/c" ref=\x27data:json,{bad\x27 target="data:json,dma_none"/></xf:model></head><body/></html>';
		window.sent.length = 0;
		window.send({ type: 'document', version: 90, text, root: window.parseXml(text), script: { text: '' } });
	});
	// 메인 탭 줄에는 데이터 흐름 버튼이 없고, ERD 탭 상단 바의 버튼으로 기존 테이블과 겹치지 않게 데이터 흐름을 그린다
	assert.equal(await page.$('.tab-bar button[aria-label="데이터 흐름"]'), null, '메인 탭 줄에는 버튼 없음');
	await page.evaluate(() => window.tab('ERD').click());
	await page.waitForFunction(() => window.tab('ERD')?.getAttribute('aria-selected') === 'true');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'loadUsedTables'));
	await page.evaluate(() => {
		window.lastSave = () => window.sent.findLast(m => m.type === 'saveUsedTables')?.data;
		window.send({
			type: 'usedTables', folder: 'C:/x', file: 'C:/x/ui/a.json',
			data: { tables: [{ id: 't1', name: 'TB_BASE', desc: '', crud: [], columns: [], keysOnly: false, color: '', x: 80, y: 128 }], links: [], memos: [], groups: [], shapes: [] },
		});
	});
	const button = '.used-tables-bar button[aria-label="데이터 흐름"]';
	await page.waitForSelector(button);
	await page.click(button);
	await page.waitForFunction(() => window.lastSave()?.groups.length === 6, { timeout: 3000 });
	const saved = await page.evaluate(() => window.lastSave());
	assert.equal(saved.tables.length, 1, '기존 테이블 유지');
	assert.ok(saved.groups.every(g => g.x >= 80 + 360 + 96), '기존 테이블 영역과 겹치지 않게 오른쪽 배치');
	assert.deepEqual(saved.groups.map(g => [g.title, g.color]), [
		['sbm1', 'blue'], ['Request', 'red'], ['Response', 'green'],
		['sbm_bad', 'blue'], ['Request', 'red'], ['Response', 'green'],
	]);
	assert.deepEqual(saved.shapes.map(s => [s.kind, s.text, s.color]), [
		['controller', '/a/list.do', 'blue'],
		['dataList', 'dl1', 'gray'],
		['dataMap', 'dma1', 'gray'],
		['controller', '/c', 'blue'],
		['rect', '[문법 오류]\ndata:json,{bad', 'red'],
		['rect', '[잘못된 형식]\ndma_none', 'orange'],
	]);
	assert.equal(saved.links.length, 4, '요청→Action, Action→응답 선 연결');

	// Action 도형 우클릭 → Controller 이동
	await page.waitForSelector('.used-shape');
	const actPos = await page.evaluate(() => {
		const el = [...document.querySelectorAll('.used-shape')].find(n => n.textContent?.includes('/a/list.do'));
		const r = el.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	});
	await page.mouse.click(actPos.x, actPos.y, { button: 'right' });
	await page.waitForSelector('.context-menu');
	await page.$$eval('.context-menu button', bs => bs.find(b => b.textContent.startsWith('Controller 이동')).click());
	assert.deepEqual(await page.evaluate(() => window.sent.findLast(m => m.type === 'openAction')), { type: 'openAction', action: '/a/list.do' });
}
