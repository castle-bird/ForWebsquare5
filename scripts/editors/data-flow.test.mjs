import assert from 'node:assert/strict';

export default async function ({ page }) {
	await page.evaluate(() => {
		const text = '<html xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms" xmlns:ev="http://www.w3.org/2001/xml-events"><head><xf:model><w2:dataCollection baseNode="map"><w2:dataMap id="dma1"><w2:keyInfo><w2:key id="k1"/></w2:keyInfo></w2:dataMap><w2:dataList id="dl1"><w2:columnInfo><w2:column id="c1"/></w2:columnInfo></w2:dataList></w2:dataCollection><xf:submission id="sbm1" action="/a/list.do" method="post" ref=\'data:json,[{"id":"dl1","action":"modified"}]\' target=\'data:json,{"id":"dma1"}\' ev:submitdone="scwin.sbm1_submitdone"/><xf:submission id="sbm_aVeryLongSubmissionIdentifierThatDoesNotFitTheColumn" action="/b"/><xf:submission id="sbm_bad" action="/c" ref=\x27data:json,{bad\x27 target="data:json,dma_none"/></xf:model></head><body/></html>';
		window.sent.length = 0;
		window.send({ type: 'document', version: 90, text, root: window.parseXml(text), script: { text: '' } });
	});
	const button = 'button[aria-label="데이터 흐름"]';
	await page.waitForFunction(selector => !document.querySelector(selector)?.disabled, {}, button);
	await page.click(button);
	await page.waitForSelector('.data-flow');
	const row = await page.$eval('.data-flow .flow-card:nth-child(1)', row => ({
		sides: [...row.querySelectorAll('.flow-side')].map(side => side.textContent),
		url: row.querySelector('.flow-url').textContent, handler: row.querySelector('.flow-handler').textContent,
	}));
	assert.deepEqual(row.sides, ['요청Listdl1modified', '응답Mapdma1'], 'dataList가 요청, dataMap이 응답');
	assert.equal(row.url, '/a/list.do');
	assert.equal(row.handler, 'submitdonescwin.sbm1_submitdone');
	// 해석 못 한 ref는 문법 오류, 없는 id는 없는 데이터라고 글로 알린다
	assert.deepEqual(await page.$$eval('.data-flow .flow-card:nth-child(3) .flow-problem', es => es.map(e => e.textContent)), ['ref 문법 오류', '잘못된 형식']);
	assert.match(await page.$eval('.data-flow .flow-notice', e => e.textContent), /Script에서 동적으로 만든 .*보이지 않을 수 있습니다/, 'XML만 보인다는 안내');
	// 긴 id는 줄여 보이고 옆 칸(화살표)과 겹치지 않는다
	assert.equal(await page.$$eval('.data-flow .flow-edit', buttons => buttons.filter(b => b.getBoundingClientRect().right > b.closest('.flow-card-head, .flow-column, .flow-side').getBoundingClientRect().right + 0.5).length), 0, '칸 밖으로 넘침 없음');
	// 긴 글자는 …로 자르지 않고 줄을 바꿔 전부 보인다
	assert.equal(await page.$$eval('.data-flow :is(.flow-id, .flow-url, .flow-handler code)', els => els.filter(e => e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).textOverflow === 'ellipsis').length), 0, '글자가 잘리지 않음');
	// 글꼴은 "패널 글꼴 변경" 설정을 따르고 글자·핸들러·버튼·제목이 모두 같다
	const fonts = () => page.$$eval('.data-flow .popup-title, .data-flow .flow-id, .data-flow .flow-url, .data-flow .flow-handler code, .data-flow .btn', els => [...new Set(els.map(e => getComputedStyle(e).fontFamily))]);
	for (const font of ['editor', 'ui']) {
		await page.evaluate(font => window.send({ type: 'panelFont', font }), font);
		await page.waitForFunction(font => document.querySelector('.data-flow').dataset.panelFont === font, {}, font);
		assert.equal((await fonts()).length, 1, `${font} 글꼴 하나`);
	}
	// 데이터 이름을 누르면 우측 패널이 Property·Data 탭으로 바뀌고 그 데이터 줄이 선택된다(Event·Outline 탭에 있었어도)
	await page.evaluate(() => { for (const name of ['Event', 'Outline']) { [...document.querySelectorAll('.right-panel [role="tab"]')].find(t => t.textContent === name)?.click(); } });
	await page.click('.data-flow .flow-card:nth-child(1) .flow-side button.flow-data');
	const tabs = () => page.$$eval('.right-panel [role="tab"][aria-selected="true"]', ts => ts.map(t => t.textContent));
	await page.waitForFunction(() => document.querySelector('.right-panel .tree-row.selected'));
	assert.deepEqual((await tabs()).sort(), ['Data', 'Property'], 'Property·Data 탭 활성화');
	assert.equal(await page.$eval('.right-panel [role="tree"] .tree-row.selected', e => e.textContent.includes('dl1')), true, 'Data 트리에서 dl1 선택');
	// Submission 이름을 눌러도 같다(Event·Outline 탭에 있었어도)
	await page.evaluate(() => { for (const name of ['Event', 'Outline']) { [...document.querySelectorAll('.right-panel [role="tab"]')].find(t => t.textContent === name)?.click(); } });
	await page.click('.data-flow .flow-card:nth-child(1) .flow-card-head button.flow-data');
	await page.waitForFunction(() => document.querySelector('.right-panel .tree-row.selected')?.textContent.includes('sbm1'));
	assert.deepEqual((await tabs()).sort(), ['Data', 'Property'], 'Submission 클릭도 Property·Data 탭 활성화');
	// Controller 이동은 팝업을 닫지 않는다(Script·Java를 보며 열어 둔다)
	await page.click('.data-flow .flow-column .flow-go');
	assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'openAction')), { type: 'openAction', action: '/a/list.do' });
	assert.ok(await page.$('.data-flow'), 'Controller 이동 뒤에도 팝업 유지');
	// 데이터 옆 연필 버튼으로 편집 팝업(더블클릭이 아니라 보이는 버튼)
	assert.equal(await page.$$eval('dialog.popup', d => d.length), 1);
	await page.click('.data-flow .flow-card:nth-child(1) .flow-side .flow-edit');
	await page.waitForFunction(() => document.querySelectorAll('dialog.popup').length === 2);
	// 위에 뜬 편집 팝업이 닫기 버튼을 가릴 수 있어 먼저 닫는다
	await page.click('dialog.popup:not(.data-flow) .popup-close');
	await page.waitForFunction(() => document.querySelectorAll('dialog.popup').length === 1);
	// 응답 칸의 데이터 이름을 더블클릭해도 같은 편집 팝업(Data 탭 더블클릭과 같다)
	await page.click('.data-flow .flow-card:nth-child(1) .flow-link + .flow-side button.flow-data', { count: 2 });
	await page.waitForFunction(() => document.querySelectorAll('dialog.popup').length === 2);
	await page.click('dialog.popup:not(.data-flow) .popup-close');
	await page.waitForFunction(() => document.querySelectorAll('dialog.popup').length === 1);
	await page.click('.data-flow .btn-secondary');
	assert.equal(await page.$('.data-flow'), null);
}
