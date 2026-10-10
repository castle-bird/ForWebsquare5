import assert from 'node:assert/strict';

export default async function ({ clickTab, page }) {
	// 셀 병합: 그리드 컬럼·group(th·td) 셀을 Ctrl+클릭으로 둘 이상 골라 우클릭 메뉴·Outline 메뉴·Ctrl+M으로. 붙어 있을 때만
	await clickTab('Design');
	const WS = 'http://www.inswave.com/websquare', XF = 'http://www.w3.org/2002/xforms';
	const mergeDoc = await page.evaluate((WS, XF) => {
		const text = `<html xmlns:w2="${WS}" xmlns:xf="${XF}"><body><w2:gridView id="grd"><w2:header id="h"><w2:row id="r1"><w2:column id="c1" value="A"/><w2:column id="c2" value="B"/><w2:column id="c3" value="C"/></w2:row></w2:header></w2:gridView>`
			+ '<xf:group tagname="table" id="t"><xf:group tagname="tbody"><xf:group tagname="tr" id="tr1"><xf:group tagname="th" id="th1"/><xf:group tagname="td" id="td1"/></xf:group></xf:group></xf:group></body></html>';
		const root = window.parseXml(text), first = window.testDefs.length;
		window.send({ type: 'definitions', defs: [...window.testDefs, { id: 'gridView', ns: WS, realType: 'gridView', parents: [], bases: [], properties: [], events: [] }, { id: 'group', ns: XF, realType: 'group', parents: [], bases: [], properties: [], events: [] }] });
		const walk = n => { n.def = n.tag === 'w2:gridView' ? first : n.tag === 'xf:group' ? first + 1 : n.def; n.children.forEach(walk); };
		walk(root);
		window.send({ type: 'document', version: 900, text, root, script: { text: '' } });
		const ids = {}; const index = n => { if (n.attrs.id) { ids[n.attrs.id] = n.index; } n.children.forEach(index); };
		index(root);
		return ids;
	}, WS, XF);
	await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('[data-wse]'), { timeout: 5000 });
	const cell = id => page.evaluateHandle(i => document.querySelector('.canvas-host').shadowRoot.querySelector(`[data-wse="${i}"]`), mergeDoc[id]);
	const row = id => page.evaluateHandle(i => [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.id')?.textContent === i), id);
	const clickRow = async (id, options) => (await row(id)).asElement().click(options);
	const ctrlClick = async handle => { await page.keyboard.down('Control'); await (await handle.asElement()).click(); await page.keyboard.up('Control'); };
	const menuItems = () => page.$$eval('.context-menu button', bs => bs.map(b => ({ text: b.textContent, disabled: b.disabled })));
	const lastMerge = () => page.evaluate(() => window.sent.findLast(m => m.type === 'mergeCells'));
	// 그리드: 붙은 두 컬럼 → 병합 켜짐 → 요청
	await (await (await cell('c1')).asElement()).click();
	await ctrlClick(await cell('c2'));
	await (await (await cell('c2')).asElement()).click({ button: 'right' });
	await page.waitForSelector('.context-menu');
	const gridMenu = await menuItems();
	assert.deepEqual(gridMenu.find(i => i.text === '병합'), { text: '병합', disabled: false }, '그리드 우클릭: 붙은 셀 → 병합 켜짐');
	assert.ok(gridMenu.length > 2, '그리드 메뉴(컬럼·행 추가 등)는 그대로');
	await page.evaluate(() => { window.sent.length = 0; });
	await page.$$eval('.context-menu button', bs => bs.find(b => b.textContent === '병합').click());
	assert.deepEqual(await lastMerge(), { type: 'mergeCells', version: 900, index: mergeDoc.c1, more: [mergeDoc.c2] }, '병합 요청(왼쪽 위 셀이 대표)');
	// 떨어진 두 컬럼 → 병합 꺼짐(요청 없음)
	await (await (await cell('c1')).asElement()).click();
	await ctrlClick(await cell('c3'));
	await (await (await cell('c3')).asElement()).click({ button: 'right' });
	await page.waitForSelector('.context-menu');
	assert.deepEqual((await menuItems()).find(i => i.text === '병합'), { text: '병합', disabled: true }, '그리드 우클릭: 떨어진 셀 → 병합 꺼짐');
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => !document.querySelector('.context-menu'));
	// 칸을 누른 채 끌기: 지나간 범위의 칸을 모두 고르고(누른 칸이 대표), 그리드는 안 옮김. 이어 우클릭 병합
	const centerOf = async id => { const b = await (await cell(id)).asElement().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
	const [from, to] = [await centerOf('c1'), await centerOf('c3')];
	await page.evaluate(() => { window.sent.length = 0; });
	await page.mouse.move(from.x, from.y); await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up();
	const picked = () => page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length);
	await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length === 3, { timeout: 3000 })
		.catch(async () => assert.fail(`끌어서 고른 칸 수: ${await picked()}`));
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'move')), false, '그리드는 안 옮김');
	await (await (await cell('c2')).asElement()).click({ button: 'right' });
	await page.waitForSelector('.context-menu');
	await page.$$eval('.context-menu button', bs => bs.find(b => b.textContent === '병합').click());
	assert.deepEqual(await lastMerge(), { type: 'mergeCells', version: 900, index: mergeDoc.c1, more: [mergeDoc.c2, mergeDoc.c3] }, '끌어 고른 칸을 우클릭 병합');
	// 끌지 않은 클릭은 그 칸 하나만
	await (await (await cell('c2')).asElement()).click();
	await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length === 1, { timeout: 3000 });
	// 가로 스크롤 그리드: 오른쪽 가장자리 밖으로 끌고 있으면 굴러가며 가려진 칸까지 고름
	const edge = await page.evaluate(i => {
		const c1 = document.querySelector('.canvas-host').shadowRoot.querySelector(`[data-wse="${i}"]`);
		let grid = c1.parentElement;
		while (grid && getComputedStyle(grid).overflowX !== 'auto') { grid = grid.parentElement; }
		const g = grid.getBoundingClientRect(), c = c1.getBoundingClientRect();
		grid.dataset.testWidth = grid.style.width;
		grid.style.width = `${c.right - g.left + 4}px`;
		const r = grid.getBoundingClientRect();
		return { x: r.right + 30, y: c.top + c.height / 2, overflow: grid.scrollWidth > grid.clientWidth };
	}, mergeDoc.c1);
	assert.ok(edge.overflow, '테스트 그리드에 가로 스크롤');
	await page.mouse.move(from.x, from.y); await page.mouse.down();
	await page.mouse.move(edge.x, edge.y, { steps: 8 });
	await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length === 3, { timeout: 3000 })
		.catch(async () => assert.fail(`가장자리 밖으로 끌어 고른 칸 수: ${await picked()}`));
	await page.mouse.up();
	await page.evaluate(i => {
		let grid = document.querySelector('.canvas-host').shadowRoot.querySelector(`[data-wse="${i}"]`).parentElement;
		while (grid && getComputedStyle(grid).overflowX !== 'auto') { grid = grid.parentElement; }
		grid.style.width = grid.dataset.testWidth; grid.scrollLeft = 0;
	}, mergeDoc.c1);
	console.log('Design: 가로 스크롤 그리드 끌기 → 자동 스크롤·가려진 칸 고르기 passed');
	// 손잡이를 누르면 그리드 선택, 그리드를 고른 상태에서도 칸 끌기는 범위 고르기(그리드 이동 아님)
	await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-grid-handle').click());
	await page.waitForFunction(() => /gridView|grd/.test(document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-chip')?.textContent ?? ''), { timeout: 3000 })
		.catch(async () => assert.fail(`손잡이 클릭 뒤 선택: ${await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-chip')?.textContent)}`));
	await page.evaluate(() => { window.sent.length = 0; });
	await page.mouse.move(from.x, from.y); await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up();
	await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length === 3, { timeout: 3000 });
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'move')), false, '그리드를 골라도 칸 끌기는 이동 아님');
	console.log('Design: 그리드 셀 병합(붙은 셀만), 끌어서 여러 칸 고르기 passed');
	// group 표의 th·td: Design 우클릭 → 병합만 있는 메뉴, Outline 우클릭·Ctrl+M도 같은 요청
	await (await (await cell('th1')).asElement()).click();
	await page.evaluate(() => document.activeElement.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() })));
	await ctrlClick(await cell('td1'));
	await (await (await cell('td1')).asElement()).click({ button: 'right' });
	await page.waitForSelector('.context-menu');
	// 이 테스트에서 복사한 컴포넌트가 있어 붙여 넣기 > 앞·뒤도 표시된다.
	assert.deepEqual(await menuItems(), [{ text: 'CSS 보기', disabled: false }, { text: '병합', disabled: false }, { text: '병합 해제', disabled: true }, { text: '붙여 넣기 > 앞', disabled: false }, { text: '붙여 넣기 > 뒤', disabled: false }], 'group th·td 우클릭: 병합 메뉴');
	await page.evaluate(() => { window.sent.length = 0; });
	await page.$$eval('.context-menu button', bs => bs.find(b => b.textContent === '병합').click());
	assert.deepEqual(await lastMerge(), { type: 'mergeCells', version: 900, index: mergeDoc.th1, more: [mergeDoc.td1] }, 'group 셀 병합 요청');
	await page.evaluate(() => { window.sent.length = 0; });
	await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row')].some(r => r.querySelector('.id')?.textContent === 'th1'));
	await clickRow('th1');
	await page.keyboard.down('Control'); await clickRow('td1'); await page.keyboard.up('Control');
	await clickRow('td1', { button: 'right' });
	await page.waitForSelector('.context-menu');
	assert.deepEqual(await menuItems(), [{ text: '병합', disabled: false }, { text: '병합 해제', disabled: true }, { text: '붙여 넣기 > 앞', disabled: false }, { text: '붙여 넣기 > 뒤', disabled: false }], 'Outline 우클릭: 병합 메뉴');
	await page.$$eval('.context-menu button', bs => bs.find(b => b.textContent === '병합').click());
	assert.deepEqual(await lastMerge(), { type: 'mergeCells', version: 900, index: mergeDoc.th1, more: [mergeDoc.td1] }, 'Outline 병합 요청');
	console.log('Design·Outline: group th·td 병합(우클릭 메뉴) passed');
	// F2(이클립스처럼): 화면에서 컴포넌트를 고른 뒤면 부모로(Outline 선택도 같이), body에서 멈춤. Outline에서 고른 뒤의 F2는 그대로 id 바꾸기
	{
		const picked = () => page.evaluate(() => { const r = document.querySelector('.pane .tree-row.selected'); return r && `${r.querySelector('.tag')?.textContent}#${r.querySelector('.id')?.textContent ?? ''}`; });
		await (await (await cell('td1')).asElement()).click();
		assert.equal(await picked(), 'xf:group:td#td1', '화면에서 td1 고름');
		const up = async () => { await page.keyboard.press('F2'); await new Promise(r => setTimeout(r, 50)); return picked(); };
		assert.equal(await up(), 'xf:group:tr#tr1', 'F2 → 부모 tr1');
		assert.equal(await up(), 'xf:group:tbody#', 'F2 → tbody(id 없음)');
		assert.equal(await up(), 'xf:group:table#t', 'F2 → table');
		assert.equal(await up(), 'body#', 'F2 → body');
		assert.equal(await up(), 'body#', 'body 위로는 안 감');
		assert.equal(await page.$('.pane .tree-rename'), null, '화면에서 고른 뒤 F2는 id 입력칸을 안 엶');
		assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length), 1, '캔버스 선택도 하나');
		await clickRow('td1');
		await page.keyboard.press('F2');
		await page.waitForSelector('.pane .tree-rename', { timeout: 3000 }).catch(() => assert.fail('Outline에서 고른 뒤 F2는 id 바꾸기'));
		await page.keyboard.press('Escape');
		console.log('Design·Outline: F2 화면은 부모 고르기·Outline은 id 바꾸기 passed');
	}
	// 복사(Ctrl+C·X) 뒤 컴포넌트 우클릭: 붙여 넣기 > 앞·뒤(화면·Outline). 병합 메뉴가 있는 칸이면 그 아래에
	{
		await (await (await cell('td1')).asElement()).click();
		await page.evaluate(() => document.activeElement.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() })));
		await (await (await cell('th1')).asElement()).click({ button: 'right' });
		await page.waitForSelector('.context-menu');
		assert.deepEqual((await menuItems()).map(m => m.text), ['CSS 보기', '병합', '병합 해제', '붙여 넣기 > 앞', '붙여 넣기 > 뒤'], '칸 우클릭: 병합 아래에 붙여 넣기');
		await page.evaluate(() => { window.sent.length = 0; [...document.querySelectorAll('.context-menu button')].find(b => b.textContent === '붙여 넣기 > 앞').click(); });
		const pasted = await page.evaluate(() => window.sent.find(m => m.type === 'paste'));
		assert.deepEqual({ index: pasted?.index, position: pasted?.position, xml: pasted?.xml.map(x => x.trim()) }, { index: mergeDoc.th1, position: 'before', xml: ['<xf:group tagname="td" id="td1"/>'] }, '앞에 붙여 넣기 요청');
		await clickRow('t', { button: 'right' });
		await page.waitForSelector('.context-menu');
		assert.deepEqual((await menuItems()).map(m => m.text), ['그룹으로 감싸기', '붙여 넣기 > 앞', '붙여 넣기 > 뒤'], 'Outline 컴포넌트 우클릭: 그룹 감싸기·붙여 넣기');
		await page.evaluate(() => { window.sent.length = 0; [...document.querySelectorAll('.context-menu button')].find(b => b.textContent === '붙여 넣기 > 뒤').click(); });
		assert.deepEqual(await page.evaluate(() => { const m = window.sent.find(m => m.type === 'paste'); return m && [m.index, m.position]; }), [mergeDoc.t, 'after'], '뒤에 붙여 넣기 요청');
		await (await page.evaluateHandle(() => [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.tag')?.textContent === 'body'))).asElement().click({ button: 'right' });
		assert.equal(await page.$('.context-menu'), null, 'body는 앞뒤 붙여 넣기 없음');
		console.log('Design·Outline: 우클릭 붙여 넣기 > 앞·뒤 passed');
	}
	// 병합 풀기(우클릭)와 열 옮기기·지우기(우클릭·Delete): 합친 머리 칸 c1(2칸) + c3, 본문 b1 b2 b3
	const colDoc = await page.evaluate((WS, XF) => {
		const text = `<html xmlns:w2="${WS}" xmlns:xf="${XF}"><body><w2:gridView id="grd"><w2:header id="h"><w2:row id="r1"><w2:column id="c1" value="A" colSpan="2"/><w2:column id="c3" value="C"/></w2:row></w2:header>`
			+ '<w2:gBody id="gb"><w2:row id="br"><w2:column id="b1"/><w2:column id="b2"/><w2:column id="b3"/></w2:row></w2:gBody></w2:gridView></body></html>';
		const root = window.parseXml(text), first = window.testDefs.length;
		const walk = n => { n.def = n.tag === 'w2:gridView' ? first : n.def; n.children.forEach(walk); };
		walk(root);
		window.send({ type: 'document', version: 900, text, root, script: { text: '' } });
		const ids = {}; const index = n => { if (n.attrs.id) { ids[n.attrs.id] = n.index; } n.children.forEach(index); };
		index(root);
		return ids;
	}, WS, XF);
	const colCell = id => page.evaluateHandle(i => document.querySelector('.canvas-host').shadowRoot.querySelector(`[data-wse="${i}"]`), colDoc[id]);
	await page.waitForFunction(i => document.querySelector('.canvas-host')?.shadowRoot?.querySelector(`[data-wse="${i}"]`), { timeout: 5000 }, colDoc.b3);
	const lastOf = type => page.evaluate(type => window.sent.findLast(m => m.type === type), type);
	const openMenu = async id => {
		await (await (await colCell(id)).asElement()).click({ button: 'right' });
		await page.waitForSelector('.context-menu');
		return menuItems();
	};
	const pickMenu = async text => { await page.$$eval('.context-menu button', (bs, text) => bs.find(b => b.textContent.startsWith(text)).click(), text); await page.waitForFunction(() => !document.querySelector('.context-menu')); };
	const c1Menu = await openMenu('c1');
	assert.deepEqual(c1Menu.filter(i => /열|병합/.test(i.text)), [
		{ text: '열 왼쪽으로 이동', disabled: true }, { text: '열 오른쪽으로 이동', disabled: false }, { text: '열 삭제Delete', disabled: false },
		{ text: '병합', disabled: true }, { text: '병합 해제', disabled: false }], '합친 칸 우클릭: 맨 왼쪽이라 왼쪽 이동 꺼짐, 병합 해제 켜짐');
	await pickMenu('병합 해제');
	assert.deepEqual(await lastOf('unmergeCells'), { type: 'unmergeCells', version: 900, index: colDoc.c1, more: [] }, '우클릭 병합 해제');
	await openMenu('c1');
	await pickMenu('열 삭제');
	assert.deepEqual(await lastOf('gridColumns'), { type: 'gridColumns', version: 900, index: colDoc.grd, cells: [colDoc.c1], op: 'delete' }, '우클릭 열 삭제');
	assert.deepEqual((await openMenu('b2')).find(i => i.text === '병합 해제'), { text: '병합 해제', disabled: true }, '합치지 않은 칸은 병합 해제 꺼짐');
	await pickMenu('열 왼쪽으로 이동');
	assert.deepEqual(await lastOf('gridColumns'), { type: 'gridColumns', version: 900, index: colDoc.grd, cells: [colDoc.b2], op: 'left' }, '우클릭 열 왼쪽으로');
	assert.equal((await openMenu('b2')).find(i => i.text === '열 오른쪽으로 이동').disabled, true, 'c1 묶음(2칸) 밖으로는 못 옮김');
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => !document.querySelector('.context-menu'));
	// Delete: 그리드 칸이면 칸 하나가 아니라 그 열
	await (await (await colCell('b3')).asElement()).click();
	await page.evaluate(() => { window.sent.length = 0; });
	await page.keyboard.press('Delete');
	assert.deepEqual(await lastOf('gridColumns'), { type: 'gridColumns', version: 900, index: colDoc.grd, cells: [colDoc.b3], op: 'delete' }, 'Delete는 열 삭제');
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'delete')), false, '칸만 지우지 않음');
	console.log('Design: 병합 풀기·열 옮기기·열 삭제(우클릭·Delete) passed');
}
