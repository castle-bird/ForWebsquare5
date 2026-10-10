import assert from 'node:assert/strict';

export default async function ({ page }) {
	await page.evaluate(() => {
		window.send({ type: 'definitions', defs: [...window.testDefs, { id: 'group', ns: 'urn:test', realType: 'group', parents: [], bases: [], properties: [], events: [] }] });
		const text = '<html xmlns:t="urn:test"><head/><body><t:input id="a"/><t:input id="b"/><t:group id="p"><t:input id="c"/></t:group></body></html>';
		window.send({ type: 'document', version: 300000, text, root: window.parseXml(text), script: { text: '' } });
		window.tab('Outline', '.pane').click();
	});
	await page.evaluate(() => [...document.querySelectorAll('.pane .codicon-expand-all')].find(b => b.offsetParent)?.click());
	const row = id => page.evaluate(id => {
		const r = [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.id')?.textContent === id);
		const b = r.getBoundingClientRect();
		return { x: b.x + 70, y: b.y + b.height / 2, index: Number(r.dataset.index) };
	}, id);
	await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row .id')].some(el => el.textContent === 'c'));
	const a = await row('a'), b = await row('b'), c = await row('c');
	const command = async () => {
		await page.waitForFunction(() => [...document.querySelectorAll('[role=menuitem]')].some(b => b.textContent === '그룹으로 감싸기'));
		return page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].find(b => b.textContent === '그룹으로 감싸기').disabled);
	};
	for (const multi of [false, true]) {
		await page.mouse.click(a.x, a.y);
		if (multi) {
			await page.keyboard.down('Control');
			await page.mouse.click(b.x, b.y);
			await page.keyboard.up('Control');
		}
		await page.evaluate(() => { window.sent.length = 0; });
		await page.mouse.click(a.x, a.y, { button: 'right' });
		assert.equal(await command(), false);
		await page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].find(b => b.textContent === '그룹으로 감싸기').click());
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'wrap')), { type: 'wrap', version: 300000, index: a.index, ...multi && { more: [b.index] } });
	}
	await page.mouse.click(a.x, a.y);
	await page.keyboard.down('Control');
	await page.mouse.click(c.x, c.y);
	await page.keyboard.up('Control');
	await page.mouse.click(a.x, a.y, { button: 'right' });
	assert.equal(await command(), true, '다른 부모를 선택하면 감싸기 비활성');
	await page.keyboard.press('Escape');
}
