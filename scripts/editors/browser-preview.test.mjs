import assert from 'node:assert/strict';

export default async function ({ page }) {
	await page.waitForSelector('.canvas-frame .tab-bar .tab-run');
	const settle = (ms = 300) => page.evaluate(ms => new Promise(resolve => setTimeout(resolve, ms)), ms);
	const sentOf = type => page.evaluate(type => window.sent.filter(m => m.type === type), type);
	// ERD 탭 바로 앞(왼쪽)에 있는 재생 모양 버튼
	assert.deepEqual(await page.$eval('.canvas-frame .tab-bar .tab-run', b => [b.classList.contains('codicon-play'), b.nextElementSibling?.textContent, b.disabled]), [true, 'ERD', false], 'ERD 바로 왼쪽, Design에서는 켜짐');

	await page.evaluate(() => { window.sent.length = 0; window.send({ type: 'styles', css: ['.a{color:red}'] }); });
	await page.click('.canvas-frame .tab-bar .tab-run');
	const opened = await sentOf('openInBrowser');
	assert.equal(opened.length, 1, '누르면 스냅샷 전송');
	assert.ok(opened[0].html.startsWith('<div class="wse-page"'), `화면 HTML: ${opened[0].html.slice(0, 60)}`);
	assert.ok(!/data-wse|draggable/.test(opened[0].html), '편집용 속성 제거');
	assert.equal(opened[0].css[0], '.a{color:red}', '프로젝트 CSS가 먼저');
	assert.ok(opened[0].css.at(-1).includes('.wse-page'), '캔버스 CSS가 마지막');
	assert.ok(!/\.wse-page \.w2group \{/.test(opened[0].css.at(-1)), '그룹 점선(편집용 안내선)은 뺌');
	assert.deepEqual(opened[0].imports, [], '외부 폰트 없음');
	assert.ok(await page.evaluate(() => [...document.querySelector('.canvas-host').shadowRoot.adoptedStyleSheets].some(s => [...s.cssRules].some(r => r.selectorText === '.wse-page .w2group' && r.style.outline))), '편집 캔버스에는 그룹 점선이 그대로 있음');

	// 미리보기가 열려 있지 않으면 화면이 바뀌어도 보내지 않는다
	await page.evaluate(() => { window.sent.length = 0; window.send({ type: 'styles', css: ['.b{color:blue}'] }); });
	await settle(500);
	assert.equal((await sentOf('updateBrowserPreview')).length, 0, '미리보기가 닫혀 있으면 갱신 없음');

	// 열려 있는 동안(확장이 알려 줌) 화면이 바뀌면 잠깐 모아 새 스냅샷을 한 번 보낸다
	await page.evaluate(() => { window.send({ type: 'browserPreview', on: true }); window.sent.length = 0; window.send({ type: 'styles', css: ['.c{color:green}'] }); window.send({ type: 'styles', css: ['.d{color:orange}'] }); });
	await settle(600);
	const updates = await sentOf('updateBrowserPreview');
	assert.equal(updates.length, 1, `연속 변경은 한 번으로: ${updates.length}`);
	assert.equal(updates[0].css[0], '.d{color:orange}', '마지막 CSS가 반영');

	// Design이 아닌 탭에서는 꺼지고 갱신도 멈춘다(캔버스가 없다)
	await page.evaluate(() => { window.sent.length = 0; window.tab('Info').click(); });
	await settle(500);
	assert.equal(await page.$eval('.canvas-frame .tab-bar .tab-run', b => b.disabled), true, 'Design이 아니면 꺼짐');
	await page.evaluate(() => window.send({ type: 'styles', css: ['.e{color:black}'] }));
	await settle(500);
	assert.equal((await sentOf('updateBrowserPreview')).length, 0, '다른 탭에서는 갱신 없음');

	// 확장이 미리보기를 끝냈다고 알리면 다시 보내지 않는다
	await page.evaluate(() => { window.sent.length = 0; window.tab('Design').click(); });
	await settle(500);
	const back = await sentOf('updateBrowserPreview');
	assert.equal(back.length, 1, 'Design으로 돌아오면 바로 맞춤');
	assert.equal(back[0].css?.[0], '.e{color:black}', '다른 탭에 있는 동안 바뀐 CSS는 돌아오면 전체로');
	await page.evaluate(() => window.tab('Info').click());
	await settle(300);
	await page.evaluate(() => { window.sent.length = 0; window.tab('Design').click(); });
	await settle(500);
	const same = await sentOf('updateBrowserPreview');
	assert.deepEqual(same.map(m => [typeof m.html, m.css, m.imports]), [['string', undefined, undefined]], 'CSS가 그대로면 화면 HTML만');
	await page.evaluate(() => { window.send({ type: 'browserPreview', on: false }); window.sent.length = 0; window.send({ type: 'styles', css: ['.f{color:gray}'] }); });
	await settle(500);
	assert.equal((await sentOf('updateBrowserPreview')).length, 0, '끝나면 갱신 없음');
}
