import assert from 'node:assert/strict';

export default async function ({ page }) {
	await page.evaluate(() => {
		document.body.style.setProperty('--vscode-font-family', 'sans-serif');
		document.body.style.setProperty('--vscode-editor-font-family', 'monospace');
		document.querySelector('.canvas-host').shadowRoot.querySelector('input[data-wse]').click();
	});
	await page.waitForSelector('.kv td.key');
	const family = selector => page.$eval(selector, e => getComputedStyle(e).fontFamily);
	const size = await page.$eval('.kv td.key', e => { const s = getComputedStyle(e); return [s.fontSize, s.lineHeight]; });
	const open = async () => {
		await page.click('.canvas-frame .tab-settings');
		const box = await page.evaluate(() => {
			const b = [...document.querySelectorAll('.context-menu button')].find(b => b.textContent === '패널 글꼴 변경').getBoundingClientRect();
			return { x: b.left + 10, y: b.top + b.height / 2 };
		});
		assert.equal(await page.$eval('.context-menu button .codicon-chevron-right', e => getComputedStyle(e).fontFamily), 'codicon', '패널 글꼴 메뉴 화살표는 Codicon');
		await page.mouse.move(box.x, box.y);
		await page.waitForSelector('[role="menu"][aria-label="패널 글꼴 변경"]');
	};
	const choose = async font => {
		await open();
		await page.evaluate(font => [...document.querySelectorAll('[role="menuitemradio"]')].find(b => b.textContent === font).click(), font);
		assert.equal(await page.$('.context-menu'), null, '선택 후 메뉴 닫힘');
	};
	await open();
	assert.deepEqual(await page.$$eval('[role="menuitemradio"]', es => es.map(e => [e.textContent, e.getAttribute('aria-checked')])), [['VS Code UI', 'false'], ['VS Code Editor', 'true']], '기본 Editor와 두 항목');
	await page.keyboard.press('Escape');
	for (const [font, mode, expected] of [['VS Code UI', 'ui', 'sans-serif'], ['VS Code Editor', 'editor', 'monospace']]) {
		await choose(font);
		assert.deepEqual(await page.evaluate(() => window.sent.findLast(m => m.type === 'setPanelFont')), { type: 'setPanelFont', font: mode }, '저장 요청');
		for (const tab of ['Property', 'Event']) {
			await page.evaluate(tab => window.tab(tab, '.pane').click(), tab);
			assert.equal(await family('.kv td.key'), expected, tab + ' Key');
			assert.equal(await family('.kv .value'), expected, tab + ' Value');
			assert.equal(await family('.kv-search select'), expected, tab + ' 검색 Key·Value 선택');
			assert.equal(await family('.kv-search input'), expected, tab + ' 검색 입력칸');
			await page.click('.kv .value');
			assert.equal(await family('.kv .edit'), expected, tab + ' 입력칸');
			await page.keyboard.press('Enter');
		}
		await page.evaluate(() => window.tab('Property', '.pane').click());
		await page.evaluate(() => [...document.querySelectorAll('.kv .key')].find(e => e.textContent === 'label').click());
		await page.waitForSelector('.help');
		assert.equal(await family('.help'), expected, 'Key 도움말');
		await page.keyboard.press('Escape');
		for (const tab of ['Outline', 'Data']) {
			await page.evaluate(tab => window.tab(tab, '.pane').click(), tab);
			assert.equal(await family('.tree-row'), expected, tab + ' 트리');
		}
		assert.deepEqual(await page.$eval('.kv td.key', e => { const s = getComputedStyle(e); return [s.fontSize, s.lineHeight]; }), size, '글자 크기·행 높이 유지');
		assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-chip')).fontFamily), 'monospace', 'Design 칩 유지');
		await page.evaluate(() => window.tab('Script').click());
		assert.equal(await family('.tab-body:not([hidden]) .cm-content'), 'monospace', 'Script 코드 유지');
		await page.evaluate(() => window.tab('Design').click());
	}
	await page.evaluate(() => window.send({ type: 'panelFont', font: 'ui' }));
	assert.equal(await family('.kv td.key'), 'sans-serif', '저장 복원·다른 화면의 변경 수신');
	await open();
	assert.equal(await page.$eval('[role="menuitemradio"][aria-checked="true"]', e => e.textContent), 'VS Code UI', '수신된 선택 표시');
	await page.keyboard.press('Escape');
	console.log('Panel font: 두 항목·저장 요청·복원·우측 패널만 적용 passed');
}
