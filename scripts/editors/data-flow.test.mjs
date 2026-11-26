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

	// Action 도형 우클릭 → Controller 이동(fitView 전환이 끝난 뒤 클릭)
	await page.waitForFunction(() => {
		const el = [...document.querySelectorAll('.used-shape')].find(n => n.textContent?.includes('/a/list.do'));
		if (!el) { return false; }
		const r = el.getBoundingClientRect();
		const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
		const key = `${Math.round(r.x)},${Math.round(r.y)}`;
		const stable = window.__actPos === key;
		window.__actPos = key;
		return stable && hit?.closest('.used-shape') === el;
	}, { timeout: 3000 });
	const actPos = await page.evaluate(() => {
		const el = [...document.querySelectorAll('.used-shape')].find(n => n.textContent?.includes('/a/list.do'));
		const r = el.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	});
	await page.mouse.click(actPos.x, actPos.y, { button: 'right' });
	await page.waitForSelector('.context-menu');
	await page.$$eval('.context-menu button', bs => bs.find(b => b.textContent.startsWith('Controller 이동')).click());
	assert.deepEqual(await page.evaluate(() => window.sent.findLast(m => m.type === 'openAction')), { type: 'openAction', action: '/a/list.do' });

	// 연결된 MyBatis 매퍼 XML → "매퍼 테이블" 추출(기존 TB_BASE 유지, 새 테이블·CRUD·조인 추가)
	await page.evaluate(() => {
		const mapper = `<mapper namespace="com.example.UserMapper">
			<select id="selectUsers">SELECT u.USER_ID, d.DEPT_NM FROM TB_USER u INNER JOIN TB_DEPT d ON u.DEPT_CD = d.DEPT_CD</select>
			<insert id="insertUser">INSERT INTO TB_USER (USER_ID) VALUES (#{userId})</insert>
		</mapper>`;
		window.send({ type: 'linked', kind: 'mybatis', path: 'mappers/UserMapper.xml', text: mapper, version: 1, dirty: false });
	});
	await page.click('.used-tables-bar button[aria-label="매퍼 테이블"]');
	await page.waitForFunction(() => window.lastSave()?.tables.some(t => t.name === 'TB_USER'), { timeout: 5000 });
	const withMapper = await page.evaluate(() => window.lastSave());
	assert.deepEqual(withMapper.tables.map(t => [t.name, t.crud]), [
		['TB_BASE', []],
		['TB_USER', ['C', 'R']],
		['TB_DEPT', ['R']],
	]);
	assert.ok(withMapper.links.some(l => l.label === 'DEPT_CD'), '조인 선 생성');
}
