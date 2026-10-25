import assert from 'node:assert/strict';

export default async function ({ page }) {
	await page.waitForSelector('.canvas-frame .tab-bar .tab-pill.current');
	const settle = () => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 400)));
	// 알약이 놓인 x와 탭 버튼의 x를 같은 기준(탭 줄)으로 잰다
	const pill = kind => page.$eval(`.canvas-frame .tab-bar .tab-pill.${kind}`, p => ({ x: new DOMMatrix(getComputedStyle(p).transform).m41, w: p.getBoundingClientRect().width, shown: getComputedStyle(p).opacity === '1' }));
	const tabBox = name => page.evaluate(name => { const t = window.tab(name); return { x: t.offsetLeft, w: t.offsetWidth }; }, name);
	const center = name => page.evaluate(name => { const r = window.tab(name).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, name);
	const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1, `${msg}: ${a} vs ${b}`);

	await settle();
	const design = await tabBox('Design');
	let current = await pill('current');
	assert.equal(current.shown, true, '고른 탭 알약이 보임');
	near(current.x, design.x, '처음엔 Design 자리');
	assert.equal((await pill('hover')).shown, false, '올라가지 않았으면 hover 알약은 숨김');

	// hover: 알약이 그 탭으로 가고, 고른 탭 알약은 그대로
	const info = await tabBox('Info');
	const box = await center('Info');
	await page.mouse.move(box.x, box.y);
	await settle();
	const hover = await pill('hover');
	assert.equal(hover.shown, true, 'hover 알약이 보임');
	near(hover.x, info.x, 'hover 알약이 Info로 따라감');
	near(hover.w, info.w, 'hover 알약 너비는 Info 너비');
	near((await pill('current')).x, design.x, 'hover해도 고른 탭 알약은 그대로');

	// 옆 탭으로 틈을 지나 옮겨도 알약이 숨지 않고 미끄러진다(이동 중간 위치가 있어야 함)
	const script = await tabBox('Script');
	const next = await center('Script');
	// Info 위에서 Script로 옮기는 동안 hover 알약의 x·투명도를 프레임마다 모은다
	const slide = async () => {
		await page.mouse.move(box.x, box.y);
		await settle();
		await page.evaluate(() => {
			const p = document.querySelector('.canvas-frame .tab-bar .tab-pill.hover');
			window.samples = [];
			const sample = () => { const s = getComputedStyle(p); window.samples.push({ x: new DOMMatrix(s.transform).m41, opacity: +s.opacity }); window.sampling = requestAnimationFrame(sample); };
			sample();
		});
		await page.mouse.move(next.x, next.y, { steps: 12 });
		await settle();
		return page.evaluate(() => { cancelAnimationFrame(window.sampling); return window.samples; });
	};
	const samples = await slide();
	assert.ok(samples.some(s => s.x > info.x + 1 && s.x < script.x - 1), `hover 알약이 Info에서 Script로 중간 위치를 거쳐 미끄러짐: ${JSON.stringify(samples.map(s => Math.round(s.x)))}`);
	assert.ok(samples.every(s => s.opacity > 0.9), `틈을 지나도 hover 알약이 숨지 않음: ${JSON.stringify(samples.map(s => s.opacity))}`);
	near((await pill('hover')).x, script.x, 'hover 알약이 Script로 따라감');
	await page.mouse.move(box.x, box.y, { steps: 12 });
	await settle();

	// 클릭: 고른 탭 알약이 클릭한 탭으로 이동
	await page.mouse.click(box.x, box.y);
	await settle();
	current = await pill('current');
	near(current.x, info.x, '클릭하면 고른 알약이 Info로 이동');
	near(current.w, info.w, '고른 알약 너비는 Info 너비');

	// 탭 줄을 벗어나면 hover 알약은 사라짐
	await page.mouse.move(box.x, box.y + 300);
	await settle();
	assert.equal((await pill('hover')).shown, false, '벗어나면 hover 알약 숨김');
	// 탭 버튼 자체는 배경을 그리지 않는다(알약이 그림)
	assert.equal(await page.evaluate(() => getComputedStyle(window.tab('Info')).backgroundColor), 'rgba(0, 0, 0, 0)', '탭 버튼 배경은 투명');

	// 설정 메뉴의 "애니메이션"을 끄면 알약이 이동 없이 바로 옮겨지고, 확장에 저장을 요청한다
	await page.evaluate(() => { window.sent.length = 0; });
	await page.click('.canvas-frame .tab-settings');
	const menuAnimation = () => page.$eval('.context-menu', m => getComputedStyle(m).animationName);
	assert.equal(await menuAnimation(), 'menu-in', '켜면 메뉴가 열릴 때 애니메이션');
	assert.equal(await page.evaluate(() => [...document.querySelectorAll('.context-menu [role="menuitemcheckbox"]')].find(b => b.textContent === '애니메이션').getAttribute('aria-checked')), 'true', '기본은 켜짐');
	await page.evaluate(() => [...document.querySelectorAll('.context-menu [role="menuitemcheckbox"]')].find(b => b.textContent === '애니메이션').click());
	assert.deepEqual(await page.evaluate(() => window.sent.filter(m => m.type === 'setAnimation')), [{ type: 'setAnimation', on: false }], '끄면 저장 요청');
	await page.click('.canvas-frame .tab-settings');
	assert.equal(await menuAnimation(), 'none', '끄면 메뉴 애니메이션 없음');
	await page.keyboard.press('Escape');
	const still = await slide();
	assert.ok(!still.some(s => s.x > info.x + 1 && s.x < script.x - 1), `끄면 중간 위치 없이 바로 이동: ${JSON.stringify(still.map(s => Math.round(s.x)))}`);
	near((await pill('hover')).x, script.x, '꺼도 hover 알약은 Script 자리');
}
