import assert from 'node:assert/strict';

export default async function ({ page, pickProperty }) {
	// 연결 화면(wframe) 안쪽 더블클릭 → 그 화면 열기 요청, 문구 편집 입력칸은 안 열림
	const inner = await page.evaluate(() => {
		const root = document.querySelector('.canvas-host').shadowRoot;
		const r = root.querySelector('[data-wse-frame] input').getBoundingClientRect();
		return { x: r.x + 5, y: r.y + r.height / 2, frame: Number(root.querySelector('[data-wse-frame]').getAttribute('data-wse')) };
	});
	await page.mouse.click(inner.x, inner.y, {count:2});
	await page.waitForFunction(() => window.sent.some(m => m.type === 'openFrame'));
	assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'openFrame')), { type: 'openFrame', index: inner.frame });
	assert.equal(await page.evaluate(() => !!document.querySelector('.canvas-host').shadowRoot.querySelector('.edit')), false);
	console.log('Frame: 더블클릭 → 연결 화면 열기 passed');
	// 패널 구분선: 두께 1px(라이브러리 inline flex에 안 묻힘), 선 옆 3px을 잡아도 끌린다
	assert.deepEqual(await page.$$eval('.resizer', es => es.map(e => Math.min(e.offsetWidth, e.offsetHeight))), [1, 1]);
	const split = await page.$eval('.resizer[aria-orientation="vertical"]', e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top + 200 }; });
	const canvasWidth = () => page.$eval('.canvas-frame', e => e.offsetWidth);
	const canvasBefore = await canvasWidth();
	await page.mouse.move(split.x + 3, split.y); await page.mouse.down();
	await page.mouse.move(split.x - 97, split.y, {steps:5}); await page.mouse.up();
	assert.ok(Math.abs(await canvasWidth() - (canvasBefore - 100)) <= 3, `패널 너비: ${canvasBefore} → ${await canvasWidth()}`);
	console.log('Split: 두께·잡는 범위 passed');
	// Property 값: 정의에 정해진 값 목록이 있어도 입력칸 + 목록. 고르면 바로 반영, 목록 밖 값도 입력
	await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('input[data-wse]'));
	await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('input[data-wse]').click());
	await page.evaluate(() => { window.sent.length = 0; });
	await pickProperty(page, 'disabled', 'true');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'disabled' && m.value === 'true'));
	await page.evaluate(() => [...document.querySelectorAll('.kv tr')].find(tr => tr.querySelector('.key')?.textContent === 'disabled').querySelector('.value').click());
	await page.waitForSelector('.kv input[role="combobox"]');
	await page.$eval('.kv input[role="combobox"]', i => i.select());
	await page.keyboard.type('custom'); await page.keyboard.press('Enter');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'disabled' && m.value === 'custom'));
	console.log('Property: 정해진 값 입력칸 + 목록 passed');
	// Key 도움말: 누른 칸 왼쪽에 붙고(floating-ui) 화면 안, Esc로 닫힘
	await page.evaluate(() => [...document.querySelectorAll('.kv td.key')].find(td => td.textContent === 'label').click());
	await page.waitForFunction(() => { const h = document.querySelector('.help'); return h && getComputedStyle(h).visibility === 'visible'; });
	const helpBox = await page.evaluate(() => {
		const h = document.querySelector('.help').getBoundingClientRect(), k = [...document.querySelectorAll('.kv td.key')].find(td => td.textContent === 'label').getBoundingClientRect();
		return { right: h.right, left: h.left, top: h.top, bottom: h.bottom, keyLeft: k.left, keyTop: k.top, text: document.querySelector('.help').textContent };
	});
	assert.equal(helpBox.text, 'label화면에 보이는 글자');
	assert.ok(Math.abs(helpBox.right - (helpBox.keyLeft - 6)) <= 1 && Math.abs(helpBox.top - helpBox.keyTop) <= 1, `도움말이 Key 칸 왼쪽: ${JSON.stringify(helpBox)}`);
	assert.ok(helpBox.left >= 0 && helpBox.bottom <= await page.evaluate(() => innerHeight), '도움말이 화면 안');
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => !document.querySelector('.help'));
	console.log('Property: Key 도움말 자리 passed');
	// Style 칸: Shift+Enter는 줄바꿈(반영 안 함), Enter로 반영하고 입력칸에서 나옴
	await page.click('.style-area .style-value');
	await page.keyboard.type('width:1px;');
	await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
	await page.keyboard.type('height:2px;');
	assert.equal(await page.$eval('.style-area textarea', el => el.value), 'width:1px;\nheight:2px;');
	assert.ok(!await page.evaluate(() => window.sent.some(m => m.name === 'style')), 'Shift+Enter로는 반영 안 함');
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'style' && m.value === 'width:1px;\nheight:2px;'));
	assert.equal(await page.$('.style-area textarea'), null, 'Enter로 닫힘');
	assert.ok(!await page.evaluate(() => document.activeElement?.closest('.style-area')?.matches('textarea')), '입력칸에서 나옴');
	console.log('Style: Shift+Enter 줄바꿈·Enter 반영 passed');
	// Property 표 Key 열 너비: 머리 칸 손잡이를 끌면 바뀌고 Event 탭에도 유지된다
	await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('input[data-wse]'));
	await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('input[data-wse]').click());
	const handle = await page.waitForSelector('.kv-wrap > .col-resizer');
	const box = await handle.boundingBox();
	const keyWidth = () => page.$eval('.kv th', e => e.offsetWidth);
	const before = await keyWidth();
	const rowY = await page.$eval('.kv tbody tr:not(.category) td', e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }); // 머리 칸이 아닌 td 줄에서 끌기
	await page.mouse.move(box.x + 2, rowY); await page.mouse.down();
	await page.mouse.move(box.x + 42, rowY, {steps:5}); await page.mouse.up();
	// 마우스를 놓은 직후엔 마지막 pointermove 렌더가 아직일 수 있어 기다린다(바로 읽으면 가끔 32px만 반영돼 보였다)
	await page.waitForFunction(w => Math.abs(document.querySelector('.kv th').offsetWidth - w) <= 2, {timeout: 2000}, before + 40)
		.catch(async () => assert.fail(`Key 열 너비: ${before} → ${await keyWidth()}`));
	const resized = await keyWidth();
	await page.evaluate(() => window.tab('Event', '.pane').click());
	assert.equal(await keyWidth(), resized, 'Event 탭에도 너비 유지');
	// Event 값 옆 script 버튼: 핸들러 이름을 속성에 채우고 Script 탭으로 넘어간다
	await page.evaluate(() => { window.sent.length = 0; });
	await page.click('.kv .script-btn');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'ev:onclick' && m.value === 'scwin.ipt_name_onclick'));
	console.log('Event: script 버튼 → 핸들러 연결 passed');
	console.log('Property: Key 열 너비 조절 passed');
}
