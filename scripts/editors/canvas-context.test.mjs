import assert from 'node:assert/strict';

export default async function ({ page }) {
	const ids = await page.evaluate(() => {
		window.send({ type: 'definitions', defs: [...window.testDefs, { id: 'group', ns: 'urn:test', realType: 'group', parents: [], bases: [], properties: [], events: [] }] });
		const text = '<html xmlns:w2="urn:test" xmlns:xf="http://www.w3.org/2002/xforms"><body><w2:input id="copySource" style="width:100px;height:24px"/><w2:group id="table" tagname="table"><w2:group tagname="tbody"><w2:group tagname="tr"><w2:group id="parentCell" tagname="td" style="padding:20px"><xf:select1 id="radio" appearance="full"><xf:choices><xf:item><xf:label>Radio option</xf:label><xf:value>1</xf:value></xf:item></xf:choices></xf:select1><xf:select id="checkbox" appearance="full"><xf:choices><xf:item><xf:label>Check option</xf:label><xf:value>1</xf:value></xf:item></xf:choices></xf:select><w2:input id="nestedInput" style="width:100px;height:24px"/></w2:group></w2:group></w2:group></w2:group></body></html>';
		const root = window.parseXml(text), ids = {};
		const walk = n => {
			if (n.attrs.id) { ids[n.attrs.id] = n.index; }
			if (n.tag === 'w2:group') { n.def = window.testDefs.length; }
			if (n.tag === 'w2:input') { n.def = 0; }
			if (n.tag === 'xf:select1') { n.def = 4; }
			if (n.tag === 'xf:select') { n.def = 5; }
			n.children.forEach(walk);
		};
		walk(root);
		window.send({ type: 'document', version: 2, text, root, script: { text: '' } });
		return ids;
	});
	await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#radio input'));
	const click = async (selector, button = 'left') => {
		const p = await page.evaluate(selector => {
			const r = document.querySelector('.canvas-host').shadowRoot.querySelector(selector).getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		}, selector);
		await page.mouse.click(p.x, p.y, { button });
	};
	await click('#copySource');
	await page.keyboard.down('Control'); await page.keyboard.press('c'); await page.keyboard.up('Control');
	for (const [id, selector] of [['radio', '#radio input'], ['radio', '#radio label'], ['checkbox', '#checkbox label'], ['nestedInput', '#nestedInput']]) {
		await click(selector);
		await page.waitForFunction(id => document.querySelector('.pane .tree-row.selected .id')?.textContent === id, {}, id);
		await page.evaluate(() => { window.sent.length = 0; });
		await click(selector, 'right');
		await page.waitForSelector('.context-menu');
		assert.equal(await page.evaluate(() => document.querySelector('.pane .tree-row.selected .id')?.textContent), id, '우클릭해도 자식 컴포넌트 선택 유지: ' + selector);
		assert.equal(await page.evaluate(() => [...document.querySelectorAll('.context-menu button')].some(b => b.textContent === '병합')), false, '부모 셀의 병합 메뉴로 바뀌지 않음');
		await page.evaluate(() => [...document.querySelectorAll('.context-menu button')].find(b => b.textContent === '붙여 넣기 > 뒤').click());
		assert.deepEqual(await page.evaluate(() => { const m = window.sent.find(m => m.type === 'paste'); return m && { index: m.index, position: m.position }; }), { index: ids[id], position: 'after' }, '부모 Group 대신 자식 컴포넌트의 뒤로 붙여 넣기');
	}
	await page.evaluate(() => {
		const el = document.querySelector('.canvas-host').shadowRoot.querySelector('#parentCell');
		el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true }));
	});
	await page.waitForSelector('.context-menu');
	assert.ok(await page.evaluate(() => [...document.querySelectorAll('.context-menu button')].some(b => b.textContent === '병합')), '셀 자체 우클릭은 기존 병합 메뉴 유지');
	console.log('Canvas 우클릭: 셀 Group 안 Radio·Checkbox·Input 선택·붙여 넣기 기준 유지, 셀 병합 메뉴 유지 passed');
}
