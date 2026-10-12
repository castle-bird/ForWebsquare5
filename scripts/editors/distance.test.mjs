import assert from 'node:assert/strict';

export default async function ({ page, clickTab }) {
	await clickTab('Design');
	await page.evaluate(() => {
		const text = '<html xmlns:w2="urn:test"><body><w2:group id="measureParent" style="position:relative;width:700px;height:550px;padding:0;margin:0;border:0"><w2:input id="measureA" style="left:40px;top:50px"/><w2:input id="measureB" style="left:180px;top:50px"/><w2:input id="measureC" style="left:40px;top:150px"/><w2:input id="measureD" style="left:200px;top:170px"/></w2:group></body></html>';
		const root = window.parseXml(text);
		root.children[0].children[0].def = window.testDefs.length;
		root.children[0].children[0].children.forEach(n => { n.def = 0; });
		window.send({ type: 'definitions', defs: [...window.testDefs, { id: 'group', ns: 'urn:test', realType: 'group', parents: [], bases: [], properties: [], events: [] }] });
		window.send({ type: 'styles', css: ['#measureParent input {position:absolute;box-sizing:border-box;width:100px;height:40px;margin:0;padding:0;border:1px solid black;}'] });
		window.send({ type: 'document', version: 42, text, root, script: { text: '' } });
		window.sent.length = 0;
	});
	await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#measureA'));
	const point = id => page.evaluate(id => {
		const r = document.querySelector('.canvas-host').shadowRoot.querySelector('#' + id).getBoundingClientRect();
		return { x: r.left + (id === 'measureParent' ? 5 : r.width / 2), y: r.top + (id === 'measureParent' ? 5 : r.height / 2) };
	}, id);
	const hover = async id => { const p = await point(id); await page.mouse.move(p.x, p.y); };
	const exists = () => page.evaluate(() => !!document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-measure'));
	const labels = () => page.evaluate(() => [...document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-measure text')].map(t => t.textContent));
	const waitLabels = async expected => {
		await page.waitForFunction(expected => JSON.stringify([...document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-measure text')].map(t => t.textContent)) === JSON.stringify(expected), {}, expected);
		assert.deepEqual(await labels(), expected);
	};
	await hover('measureB');
	await page.keyboard.down('Alt');
	assert.equal(await exists(), false, '선택 없으면 측정 없음');
	await page.keyboard.up('Alt');
	const p = await point('measureA');
	await page.mouse.click(p.x, p.y);
	await hover('measureB');
	assert.equal(await exists(), false, 'Alt 없으면 기존 hover만');
	await page.keyboard.down('Alt');
	await waitLabels(['40px']);
	assert.equal(await page.evaluate(() => !!document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-chip')), false, '측정 중 정보 칩이 숫자를 덮지 않음');
	const horizontal = await page.evaluate(() => {
		const s = document.querySelector('.canvas-host').shadowRoot, r = s.querySelector('.wse-measure').getBoundingClientRect();
		const line = s.querySelector('.wse-measure .distance'), a = s.querySelector('#measureA').getBoundingClientRect(), b = s.querySelector('#measureB').getBoundingClientRect();
		return { from: Number(line.getAttribute('x1')) + r.left, to: Number(line.getAttribute('x2')) + r.left, right: a.right, left: b.left, events: getComputedStyle(s.querySelector('.wse-measure')).pointerEvents };
	});
	assert.equal(horizontal.from, horizontal.right); assert.equal(horizontal.to, horizontal.left); assert.equal(horizontal.events, 'none');
	await hover('measureC'); await waitLabels(['60px']);
	await hover('measureD'); await waitLabels(['60px', '80px']);
	assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-measure .guide').length), 2, '대각선은 보조선으로 경계 위치 표시');
	await page.keyboard.down('Control');
	const c = await point('measureC'); await page.mouse.click(c.x, c.y);
	await page.keyboard.up('Control');
	await hover('measureD'); await waitLabels(['60px']);
	assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length), 2, '다중 선택은 전체 경계 기준');
	await page.evaluate(() => { document.querySelector('.canvas-host').shadowRoot.querySelector('#measureC').style.display = 'none'; });
	await waitLabels(['60px', '80px']);
	await page.evaluate(() => { document.querySelector('.canvas-host').shadowRoot.querySelector('#measureC').style.display = ''; });
	await waitLabels(['60px']);

	await page.mouse.click(p.x, p.y);
	await hover('measureB'); await waitLabels(['40px']);
	await page.evaluate(() => { const s = document.querySelector('.canvas-host').shadowRoot; s.querySelector('#measureA').dispatchEvent(new DragEvent('dragstart', { bubbles: true, composed: true, dataTransfer: new DataTransfer() })); });
	await page.waitForFunction(() => !document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-measure'));
	await page.evaluate(() => window.dispatchEvent(new Event('dragend')));
	await waitLabels(['40px']);
	await hover('measureParent'); await waitLabels(['40px', '560px', '50px', '460px']);
	await page.evaluate(() => { const b = document.querySelector('.canvas-host').shadowRoot.querySelector('#measureB'); b.style.left = '80px'; b.style.top = '70px'; });
	await hover('measureB'); await waitLabels(['40px', '40px', '20px', '20px']);
	await page.evaluate(() => { const b = document.querySelector('.canvas-host').shadowRoot.querySelector('#measureB'); b.style.left = '180px'; b.style.top = '50px'; });
	await hover('measureA');
	await page.waitForFunction(() => !document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-measure'));
	await hover('measureB'); await waitLabels(['40px']);
	await page.keyboard.up('Alt');
	await page.waitForFunction(() => !document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-measure'));
	await page.keyboard.down('Alt'); await waitLabels(['40px']);
	await page.evaluate(() => window.dispatchEvent(new Event('blur')));
	await page.waitForFunction(() => !document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-measure'));
	await page.keyboard.up('Alt');
	await page.mouse.move(1199, 799);
	await page.keyboard.down('Alt');
	await hover('measureB'); await waitLabels(['40px']);
	await page.evaluate(() => { document.querySelector('.canvas-host').shadowRoot.querySelector('#measureB').style.width = '110px'; document.querySelector('.canvas-host').shadowRoot.querySelector('#measureB').style.left = '192.5px'; });
	await waitLabels(['52.5px']);
	await page.evaluate(() => { const group = document.querySelector('.canvas-host').shadowRoot.querySelector('#measureParent'); group.style.overflow = 'auto'; group.style.width = '280px'; group.scrollLeft = 20; });
	await waitLabels(['52.5px']);
	await page.waitForFunction(() => {
		const s = document.querySelector('.canvas-host').shadowRoot, svg = s.querySelector('.wse-measure'), line = svg?.querySelector('.distance');
		return line && Number(line.getAttribute('x1')) === s.querySelector('#measureA').getBoundingClientRect().right - svg.getBoundingClientRect().left;
	});
	const scrolled = await page.evaluate(() => {
		const s = document.querySelector('.canvas-host').shadowRoot, a = s.querySelector('#measureA').getBoundingClientRect(), svg = s.querySelector('.wse-measure').getBoundingClientRect();
		return { expected: a.right - svg.left, actual: Number(s.querySelector('.wse-measure .distance').getAttribute('x1')) };
	});
	assert.equal(scrolled.actual, scrolled.expected, '부모 스크롤 뒤에도 선 위치 동기화');
	await page.mouse.move(1199, 799);
	await page.waitForFunction(() => !document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-measure'));
	await page.keyboard.up('Alt');
	assert.equal(await page.evaluate(() => window.sent.some(m => ['editAttr', 'move', 'setCode', 'insertComponent'].includes(m.type))), false, '측정은 XML·선택 대상의 스타일을 편집하지 않음');
	console.log('Distance: 실제 Alt·hover, 가로·세로·대각선·부모·소수·키 해제·blur·스크롤 passed');
}
