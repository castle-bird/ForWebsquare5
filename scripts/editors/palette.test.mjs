import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';

export default async function ({ clickTab, page, lastSent }) {
	// 팔레트: 정의 기반 분류·검색·클릭 요청, Shadow DOM 캔버스 드롭·고정 버튼.
	await clickTab('Design');
	await page.evaluate(() => window.send({ type: 'tabPosition', position: 'top' }));
	await page.waitForFunction(() => document.querySelector('.canvas-frame').firstElementChild.classList.contains('tab-bar'));
	const paletteIds = await page.evaluate(() => {
		const extra = (id, category, realType = id) => ({ id, ns: 'urn:test', realType, display: id, category, parents: [], bases: [], properties: [], events: [] });
		const defs = window.testDefs.map(d => ({ ...d, display: d.display ?? d.id, category: d.realType === 'gridView' ? 'Grid' : d.realType === 'wframe' ? 'Frame' : 'Forms' }));
		defs.push(extra('group', 'Container'), ...['Chart', 'HTML5', 'Navigation', 'Others'].map(category => extra(category.toLowerCase(), category)), { ...extra('hidden-component', 'Forms'), hidden: true });
		window.paletteDefs = defs;
		window.send({ type: 'definitions', defs });
		const text = '<html xmlns:w2="urn:test"><body><w2:group id="group" style="height:180px;"><w2:input id="input" style="height:30px;width:120px;"/><w2:input id="input2" label="추가" style="height:30px;width:120px;"/></w2:group><w2:gridView id="grid" style="height:70px;"><w2:header><w2:row><w2:column id="col" value="Column" width="120"/></w2:row></w2:header><w2:gBody><w2:row><w2:column id="cell"/></w2:row></w2:gBody></w2:gridView><w2:wframe id="frame" style="height:60px;"/></body></html>';
		const root = window.parseXml(text), ids = {};
		const walk = node => { ids[node.attrs.id ?? node.tag] = node.index; node.def = defs.findIndex(d => d.id === node.tag.split(':').at(-1)); node.children.forEach(walk); };
		walk(root);
		const frame = root.children[0].children[2];
		frame.frame = window.parseXml('<body><w2:input id="inner"/></body>'); frame.frame.children[0].def = 0;
		window.send({ type: 'document', version: 1000, text, root, script: { text: '' } });
		return ids;
	});
	assert.equal(await page.$('.palette-pane'), null, '처음에는 팔레트 접힘');
	assert.deepEqual(await page.$$eval('.canvas-frame .tab-bar > button', bs => bs.slice(0, 2).map(b => ({ name: b.className.split(' ')[0], draggable: b.draggable, tab: b.getAttribute('role') }))), [
		{ name: 'tab-palette', draggable: false, tab: null }, { name: 'tab-move', draggable: false, tab: null },
	], '팔레트·화살표는 정렬 탭에 포함되지 않는다');
	await page.click('.tab-palette');
	await page.waitForSelector('.palette-pane');
	assert.deepEqual(await page.$$eval('.palette-category', bs => bs.map(b => b.textContent)), ['Chart', 'Container', 'Forms', 'Frame', 'Grid', 'HTML5', 'Navigation', 'Others']);
	assert.equal(await page.$('[data-component="hidden-component"]'), null, '숨긴 컴포넌트 제외');
	await page.evaluate(() => [...document.querySelectorAll('.palette-category')].find(b => b.textContent === 'Forms').click());
	assert.ok(await page.$('[data-component="input"] .codicon-edit'), '기존 컴포넌트 아이콘');
	await page.evaluate(index => {
		const shadow = [...document.querySelectorAll('.design-canvas div')].find(el => el.shadowRoot).shadowRoot;
		shadow.querySelector(`[data-wse="${index}"]`).click(); window.sent.length = 0;
	}, paletteIds.group);
	const choosePosition = async label => {
		await page.waitForSelector('.palette-pane .context-menu', { visible: true });
		const buttons = await page.$$('.palette-pane .context-menu button');
		const labels = await page.$$eval('.palette-pane .context-menu button', bs => bs.map(b => b.textContent));
		await buttons[labels.indexOf(label)].click();
		await page.waitForFunction(() => !document.querySelector('.palette-pane .context-menu'));
	};
	await page.click('[data-component="input"]');
	await page.waitForSelector('.palette-pane .context-menu', { visible: true });
	assert.equal(await lastSent('insertComponent'), undefined, '컴포넌트 클릭만으로 호스트 팝업·삽입 요청하지 않음');
	assert.deepEqual(await page.$$eval('.palette-pane .context-menu button', bs => bs.map(b => b.textContent)), ['하위 맨 앞', '하위 맨 뒤', '앞', '뒤']);
	assert.ok(await page.evaluate(() => {
		const row = document.querySelector('[data-component="input"]').getBoundingClientRect(), menu = document.querySelector('.palette-pane .context-menu').getBoundingClientRect();
		return Math.abs(menu.left - row.right - 2) < 1 && Math.abs(menu.top - row.top) < 1;
	}), '클릭한 팔레트 항목 우측에 위치 메뉴 연결');
	await choosePosition('뒤');
	assert.deepEqual(await lastSent('insertComponent'), { type: 'insertComponent', version: 1000, index: paletteIds.group, position: 'after', component: { id: 'input', ns: 'urn:test', realType: 'input' } }, '선택한 위치·문서 버전·대상으로 삽입 요청');
	await page.evaluate(() => { window.sent.length = 0; });
	await page.click('[data-component="input"]');
	await page.waitForSelector('.palette-pane .context-menu', { visible: true });
	assert.equal(await page.$eval('.palette-pane .context-menu button', b => b.textContent), '하위 맨 앞', '최근 선택과 무관하게 위치 순서를 고정');
	await page.keyboard.press('Escape');
	assert.equal(await page.$('.palette-pane .context-menu'), null);
	assert.equal(await lastSent('insertComponent'), undefined, 'Esc 취소는 삽입하지 않음');
	for (const [selected, labels] of [[paletteIds.input, ['앞', '뒤']], [paletteIds.body, ['하위 맨 앞', '하위 맨 뒤']], [paletteIds.cell, ['앞', '뒤']]]) {
		await page.evaluate(index => {
			const target = document.querySelector('.canvas-host').shadowRoot.querySelector('[data-wse="' + index + '"]') ?? document.querySelector('.tree-row[data-index="' + index + '"]');
			if (!target) { throw Error('선택 대상 없음: ' + index); }
			target.click();
		}, selected);
		await page.click('[data-component="input"]');
		await page.waitForSelector('.palette-pane .context-menu', { visible: true });
		assert.deepEqual((await page.$$eval('.palette-pane .context-menu button', bs => bs.map(b => b.textContent))).sort(), labels.sort(), '대상별 가능한 자리만 표시');
		await page.mouse.click(5, 5);
		assert.equal(await page.$('.palette-pane .context-menu'), null, '바깥 클릭 취소');
	}
	await page.evaluate(index => document.querySelector('.canvas-host').shadowRoot.querySelector('[data-wse="' + index + '"]').click(), paletteIds.group);
	await page.focus('[data-component="input"]');
	await page.keyboard.press('Enter');
	await page.waitForSelector('.palette-pane .context-menu', { visible: true });
	await page.keyboard.press('Enter');
	assert.equal((await lastSent('insertComponent')).position, 'first', '키보드로 열기·위치 선택');
	await page.type('.palette-search input', 'radio');
	assert.deepEqual(await page.$$eval('.palette-category', bs => bs.map(b => b.textContent)), ['Forms']);
	await page.click('[data-component="radio"]');
	await choosePosition('하위 맨 뒤');
	assert.equal((await lastSent('insertComponent')).component.realType, 'radio', 'select1 태그가 같은 Radio·SelectBox 구분');
	await page.$eval('.palette-search input', input => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); });
	await page.waitForFunction(() => document.querySelectorAll('.palette-category').length === 8);
	const paletteDrop = (index, ratio, invalid) => page.evaluate((index, ratio, invalid) => {
		const shadow = [...document.querySelectorAll('.design-canvas div')].find(el => el.shadowRoot).shadowRoot;
		const target = shadow.querySelector(`[data-wse="${index}"]`), source = document.querySelector('[data-component="input"]');
		const transfer = new DataTransfer(); source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
		if (invalid) { transfer.setData('application/x-websquare5-component', invalid); }
		const r = target.getBoundingClientRect(), y = r.top + r.height * ratio, x = r.left + r.width * ratio;
		const over = new DragEvent('dragover', { bubbles: true, composed: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y });
		target.dispatchEvent(over); window.sent.length = 0;
		return new Promise(resolve => setTimeout(() => {
			const indicator = shadow.querySelector('.wse-frame.drop')?.className;
			target.dispatchEvent(new DragEvent('drop', { bubbles: true, composed: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
			source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
			resolve({ accepted: over.defaultPrevented, indicator, sent: window.sent.find(m => m.type === 'insertComponent') ?? null });
		}, 60));
	}, index, ratio, invalid);
	for (const [index, ratio, expected, position] of [[paletteIds.group, .5, paletteIds.group, 'inside'], [paletteIds.group, .1, paletteIds.group, 'before'], [paletteIds.group, .9, paletteIds.group, 'after'], [paletteIds.input, .1, paletteIds.input, 'before'], [paletteIds.input, .9, paletteIds.input, 'after'], [paletteIds.col, .5, paletteIds.grid, 'inside'], [paletteIds.body, .99, paletteIds.body, 'inside']]) {
		const dropped = await paletteDrop(index, ratio);
		if (index === paletteIds.col) { // 그리드는 형제 삽입만: 열 위치가 아니라 gridView 전체의 가장자리 기준.
			assert.equal(dropped.sent.index, paletteIds.grid); assert.ok(['before', 'after'].includes(dropped.sent.position));
		} else {
			assert.ok(dropped.accepted && dropped.indicator?.includes(position), '드롭 위치 표시: ' + position);
			assert.deepEqual(dropped.sent, { type: 'insertComponent', version: 1000, component: { id: 'input', ns: 'urn:test', realType: 'input' }, index: expected, position });
		}
	}
	const frameDrop = await paletteDrop(paletteIds.frame, .5);
	assert.equal(frameDrop.sent.index, paletteIds.frame, '연결 화면에는 형제로 넣는다');
	assert.ok(['before', 'after'].includes(frameDrop.sent.position));
	assert.equal((await paletteDrop(paletteIds.group, .5, '{bad json')).sent, null, '잘못된 드래그 데이터 거부');
	assert.equal((await paletteDrop(paletteIds.group, .5, JSON.stringify({ version: 1000, component: { id: 'hidden-component', ns: 'urn:test', realType: 'hidden-component' } }))).sent, null, '숨김 항목 드롭 거부');
	// 실제 마우스 HTML5 drag도 Shadow DOM으로 전달된다.
	await page.setDragInterception(true);
	const sourceComponent = await page.$('[data-component="input"]');
	const groupElement = (await page.evaluateHandle(index => [...document.querySelectorAll('.design-canvas div')].find(el => el.shadowRoot).shadowRoot.querySelector(`[data-wse="${index}"]`), paletteIds.group)).asElement();
	await page.evaluate(() => { window.sent.length = 0; });
	await sourceComponent.dragAndDrop(groupElement);
	assert.equal((await lastSent('insertComponent')).position, 'inside', '실제 마우스로 그룹 중앙에 놓기');
	await page.setDragInterception(false);
	// 고정 버튼을 움직여도 탭 순서 저장은 발생하지 않는다.
	for (const selector of ['.tab-palette', '.tab-move']) {
		const box = await (await page.$(selector)).boundingBox();
		await page.evaluate(() => { window.sent.length = 0; });
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 25, { steps: 4 }); await page.mouse.up();
		assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'setTabOrder')), false, '고정 버튼 드래그 제외');
	}
	await page.click('.tab-palette');
	await page.waitForFunction(() => !document.querySelector('.palette-pane'));
	await page.click('.tab-palette');
	await page.waitForSelector('.palette-pane');
	await page.evaluate(() => document.fonts.ready);
	assert.ok(await page.evaluate(() => document.fonts.check('16px codicon')), '컴포넌트·패널 버튼 아이콘 폰트 로드');
	await page.evaluate(() => [...document.querySelectorAll('.palette-category')].filter(b => ['Forms', 'Container'].includes(b.textContent)).forEach(b => b.click()));

	// 즐겨찾기는 삽입 버튼과 별 버튼을 분리하고, 항상 열린 상단 목록에 표시한다.
	await page.evaluate(() => { window.send({ type: 'paletteFavorites', keys: [] }); window.sent.length = 0; });
	// 캔버스의 기존 컴포넌트 이동: XML 이동 요청만 보내고 좌표/스타일은 편집하지 않는다.
	const canvasNodes = await page.evaluate(() => {
		const root = document.querySelector('.canvas-host').shadowRoot;
		const input = root.querySelector('input[data-wse]'), group = root.querySelector('[data-wse-id="group"]') ?? input.closest('[data-wse]')?.parentElement.closest('[data-wse]');
		const grid = root.querySelector('.w2grid[data-wse]');
		return { input: Number(input.dataset.wse), group: Number(group.dataset.wse), grid: Number(grid.dataset.wse) };
	});
	assert.equal(await page.evaluate(i => document.querySelector('.canvas-host').shadowRoot.querySelector(`[data-wse="${i}"]`).draggable, canvasNodes.input), true);
	const canvasDrag = async (from, to, ratio, drop = true) => page.evaluate(async ({ from, to, ratio, drop }) => {
		const root = document.querySelector('.canvas-host').shadowRoot;
		const source = root.querySelector(`[data-wse="${from}"]`), target = root.querySelector(`[data-wse="${to}"]`);
		const dataTransfer = new DataTransfer(), rect = target.getBoundingClientRect();
		source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
		target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX: rect.left + rect.width * ratio, clientY: rect.top + rect.height * ratio }));
		await new Promise(resolve => setTimeout(resolve, 60));
		const hint = { indicator: root.querySelector('.wse-frame.drop')?.className, text: [...root.querySelectorAll('.wse-chip')].map(el => el.textContent).join(' '), moving: root.querySelectorAll('.wse-frame.moving').length, handles: root.querySelectorAll('.wse-handle').length };
		if (drop) { target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX: rect.left + rect.width * ratio, clientY: rect.top + rect.height * ratio })); }
		source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
		return hint;
	}, { from, to, ratio, drop });
	await page.evaluate(() => { window.sent.length = 0; });
	await canvasDrag(canvasNodes.input, canvasNodes.grid, 0.1);
	assert.ok(await page.evaluate(({input,grid}) => window.sent.some(m => m.type === 'move' && m.dragged === input && m.target === grid && m.position === 'before'), canvasNodes), '컴포넌트 앞 이동');
	await canvasDrag(canvasNodes.input, canvasNodes.grid, 0.9);
	assert.ok(await page.evaluate(() => window.sent.some(m => m.type === 'move' && m.position === 'after')), '컴포넌트 뒤 이동');
	await canvasDrag(canvasNodes.input, canvasNodes.group, 0.5);
	assert.ok(await page.evaluate(() => window.sent.some(m => m.type === 'move' && m.position === 'inside')), '그룹 중앙으로 이동');
	await page.evaluate(() => { window.sent.length = 0; });
	await canvasDrag(canvasNodes.group, canvasNodes.input, 0.5);
	await canvasDrag(canvasNodes.input, canvasNodes.input, 0.5);
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'move')), false, '자기 자신·자손으로 이동 금지');
	// 같은 줄 입력은 좌우, flex reverse는 화면 방향과 XML 순서를 대응시킨다.
	for (const [direction, ratio, side, position] of [['row', .1, 'left', 'before'], ['row', .9, 'right', 'after'], ['row-reverse', .1, 'left', 'after'], ['column', .1, 'top', 'before'], ['column-reverse', .1, 'top', 'after']]) {
		await page.evaluate(({group, direction}) => {
			const el = document.querySelector('.canvas-host').shadowRoot.querySelector(`[data-wse="${group}"]`);
			el.style.display = 'flex'; el.style.flexDirection = direction;
			window.sent.length = 0;
		}, {group: canvasNodes.group, direction});
		const hint = await canvasDrag(canvasNodes.input, paletteIds.input2, ratio);
		assert.ok(hint.indicator.includes(side), direction + ' 실제 삽입선 방향');
		assert.equal(hint.text, '', '끌기 중 상단 팝업 없음');
		assert.equal(hint.moving, 0, '별도 이동 대상 테두리 없음');
		assert.equal(hint.handles, 0, '끌기 중 크기 손잡이 숨김');
		assert.equal((await lastSent('move')).position, position, '화면 방향과 XML 순서 대응');
		assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.drop, .wse-frame.moving').length), 0, '놓은 뒤 표시 정리');
	}
	await page.evaluate(group => {
		const el = document.querySelector('.canvas-host').shadowRoot.querySelector(`[data-wse="${group}"]`);
		el.style.removeProperty('display'); el.style.removeProperty('flex-direction');
	}, canvasNodes.group);
	const inlineHint = await canvasDrag(canvasNodes.input, paletteIds.input2, .1, false);
	assert.ok(inlineHint.indicator.includes('left'), '기본 inline 입력도 왼쪽 선');
	await page.setDragInterception(true);
	const sourceMove = await page.evaluateHandle(i => document.querySelector('.canvas-host').shadowRoot.querySelector(`[data-wse="${i}"]`), canvasNodes.input);
	const targetMove = await page.evaluateHandle(i => document.querySelector('.canvas-host').shadowRoot.querySelector(`[data-wse="${i}"]`), canvasNodes.grid);
	await sourceMove.asElement().dragAndDrop(targetMove.asElement());
	await page.setDragInterception(false);
	await page.waitForFunction(() => window.sent.some(m => m.type === 'move'));
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'editAttr' || m.type === 'insertComponent')), false, '이동으로 좌표/스타일 변경·새 컴포넌트 삽입 없음');
	// 그리드는 이동 손잡이로: 칸에 마우스를 올리면 왼쪽 위에 손잡이, 끌면 그리드 이동(실제 마우스 끌기)
	const shadowQuery = sel => page.evaluateHandle(sel => document.querySelector('.canvas-host').shadowRoot.querySelector(sel), sel);
	await (await shadowQuery(`[data-wse="${canvasNodes.grid}"] td[data-wse], [data-wse="${canvasNodes.grid}"] th[data-wse]`)).asElement().hover();
	await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-grid-handle'), { timeout: 3000 });
	await page.screenshot({path:path.join(tmpdir(), 'ws5-grid-handle.png')});
	await page.evaluate(() => { window.sent.length = 0; });
	await page.setDragInterception(true);
	await (await shadowQuery('.wse-grid-handle')).asElement().dragAndDrop((await shadowQuery(`[data-wse="${canvasNodes.input}"]`)).asElement());
	await page.setDragInterception(false);
	await page.waitForFunction(g => window.sent.some(m => m.type === 'move' && m.dragged === g), { timeout: 3000 }, canvasNodes.grid)
		.catch(async () => assert.fail(`그리드 이동 안 됨: ${JSON.stringify(await page.evaluate(() => window.sent))}`));
	console.log('Design: 기존 컴포넌트 실제 드래그·앞/뒤/그룹 이동·자기 자신/자손 거부, 그리드 이동 손잡이 passed');
	await page.evaluate(i => document.querySelector('.canvas-host').shadowRoot.querySelector(`[data-wse="${i}"]`).click(), paletteIds.group);
	await page.evaluate(() => { window.sent.length = 0; });
	const categoryStar = type => `.palette-list section:not(.palette-favorites) .palette-row:has([data-component="${type}"]) .palette-star`;
	assert.equal(await page.$eval('.palette-favorites h2', el => el.textContent), '즐겨찾기');
	assert.equal(await page.$('.palette-favorites [aria-expanded], .palette-favorites summary'), null, '즐겨찾기는 아코디언이 아니다');
	await page.click(categoryStar('input'));
	await page.waitForSelector('.palette-favorites [data-component="input"]');
	assert.deepEqual(await lastSent('setPaletteFavorite'), { type: 'setPaletteFavorite', favorite: true, component: { id: 'input', ns: 'urn:test', realType: 'input' } });
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'insertComponent')), false, '별 클릭은 컴포넌트를 삽입하지 않는다');
	assert.equal(await page.$eval(categoryStar('input'), b => b.getAttribute('aria-pressed')), 'true');
	assert.ok(await page.$('.palette-favorites .codicon-star-full'), '선택한 별은 채워진 아이콘');
	assert.ok(await page.evaluate(() => document.querySelector('.palette-favorites').compareDocumentPosition(document.querySelector('.palette-category')) & Node.DOCUMENT_POSITION_FOLLOWING), '즐겨찾기가 분류 목록보다 먼저');
	await page.click('.palette-favorites [data-component="input"]');
	await choosePosition('하위 맨 뒤');
	assert.equal((await lastSent('insertComponent')).index, paletteIds.group, '즐겨찾기 항목 클릭도 기존 선택 기준으로 삽입');
	await page.setDragInterception(true);
	await (await page.$('.palette-favorites [data-component="input"]')).dragAndDrop(groupElement);
	assert.equal((await lastSent('insertComponent')).position, 'inside', '즐겨찾기도 실제 마우스로 드롭');
	await page.setDragInterception(false);
	assert.notEqual(await page.$eval(categoryStar('input'), s => getComputedStyle(s).color), await page.$eval(categoryStar('radio'), s => getComputedStyle(s).color), '등록한 별은 테마 강조색');
	await page.click('.palette-favorites .palette-star');
	assert.equal(await page.$('.palette-favorites [data-component]'), null, '별을 다시 누르면 즐겨찾기 해제');
	assert.equal(await page.$eval(categoryStar('input'), b => b.getAttribute('aria-pressed')), 'false');
	assert.ok(await page.$(`${categoryStar('input')} .codicon-star-empty`), '해제한 별은 빈 아이콘');
	await page.click(categoryStar('radio'));
	assert.equal(await page.$eval(categoryStar('selectbox'), b => b.getAttribute('aria-pressed')), 'false', '같은 태그인 SelectBox와 Radio를 구분');
	await page.click(categoryStar('selectbox'));
	assert.equal(await page.$$eval('.palette-favorites [data-component]', bs => bs.length), 2);
	const favoriteOrder = () => page.$$eval('.palette-favorites .palette-component', buttons => buttons.map(b => b.dataset.component));
	assert.deepEqual(await favoriteOrder(), ['radio', 'selectbox']);
	assert.equal(await page.$eval('.palette-favorites .palette-drag-handle', b => b.textContent), '⠿', 'DataList와 같은 손잡이');
	await page.evaluate(() => { window.sent.length = 0; });
	const selectHandle = await page.$('.palette-favorites .palette-row:has([data-component="selectbox"]) .palette-drag-handle');
	const radioRow = await page.$('.palette-favorites .palette-row:has([data-component="radio"])');
	const [handleBox, radioBox] = [await selectHandle.boundingBox(), await radioRow.boundingBox()];
	await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2); await page.mouse.down();
	await page.mouse.move(handleBox.x + handleBox.width / 2, radioBox.y + 2, { steps: 8 }); await page.mouse.up();
	await page.waitForFunction(() => window.sent.some(m => m.type === 'reorderPaletteFavorites'));
	assert.deepEqual(await favoriteOrder(), ['selectbox', 'radio'], '손잡이 실제 드래그로 앞으로 이동');
	const reordered = await page.evaluate(() => window.sent.find(m => m.type === 'reorderPaletteFavorites').keys);
	assert.deepEqual(reordered.map(key => JSON.parse(key)[2]), ['selectbox', 'radio']);
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'insertComponent')), false, '정렬 손잡이는 캔버스 삽입을 요청하지 않는다');
	await page.evaluate(keys => window.send({ type: 'paletteFavorites', keys }), reordered);
	await page.click('.tab-palette'); await page.click('.tab-palette');
	assert.deepEqual(await favoriteOrder(), ['selectbox', 'radio'], '재개방 후 저장된 순서 유지');
	await page.focus('.palette-favorites .palette-drag-handle');
	await page.keyboard.press('ArrowDown');
	assert.deepEqual(await favoriteOrder(), ['radio', 'selectbox'], '손잡이 키보드 이동');
	await page.$eval('[aria-label="컴포넌트 검색"]', input => { input.value = 'Radio'; input.dispatchEvent(new Event('input', { bubbles: true })); });
	// React controlled input은 실제 키 입력으로 검색한다.
	await page.click('[aria-label="컴포넌트 검색"]'); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.type('Radio');
	const reorders = () => page.evaluate(() => window.sent.filter(m => m.type === 'reorderPaletteFavorites').length);
	const reorderCount = await reorders();
	await page.focus('.palette-favorites .palette-drag-handle'); await page.keyboard.press('ArrowDown');
	assert.equal(await reorders(), reorderCount, '검색 중 방향키는 보이는 즐겨찾기끼리만(숨은 항목과 자리 안 바꿈)');
	await page.click('[aria-label="컴포넌트 검색"]'); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace');
	assert.deepEqual(await favoriteOrder(), ['radio', 'selectbox'], '검색에 숨긴 즐겨찾기도 제자리에 보존');
	const restoredKey = JSON.stringify(['urn:test', 'input', 'input']);
	await page.evaluate(key => window.send({ type: 'paletteFavorites', keys: [key] }), restoredKey);
	await page.click('.tab-palette'); await page.click('.tab-palette');
	await page.waitForSelector('.palette-favorites [data-component="input"]');
	assert.equal(await page.$$eval('.palette-favorites [data-component]', bs => bs.length), 1, '저장소에서 받은 목록은 패널 재개방 후에도 유지');
	await page.evaluate(() => [...document.querySelectorAll('.palette-category')].find(b => b.textContent === 'Forms').click());
	assert.ok(await page.$$eval('.palette-star', stars => { const right = stars.filter(s => s.getClientRects().length && s.closest('.palette-row').getClientRects().length && s.getBoundingClientRect().width).map(s => s.getBoundingClientRect().right); return right.length > 1 && Math.max(...right) - Math.min(...right) < 1; }), '상단 목록·분류 목록의 별은 같은 우측 끝에 정렬');
	// 우측 패널은 DOM·탭 상태를 버리지 않고 라이브러리 API로 접는다.
	assert.ok(await page.$eval('.canvas-frame .tab-bar', bar => bar.lastElementChild.classList.contains('tab-panel-right')), '우측 토글은 탭 줄 맨 오른쪽');
	assert.deepEqual(await page.$eval('.tab-panel-right', b => ({ draggable: b.draggable, role: b.getAttribute('role') })), { draggable: false, role: null });
	const rightBefore = await page.evaluate(() => { window.rightPaneBefore = document.querySelector('.right-panel .pane'); return { width: document.querySelector('.right-panel').getBoundingClientRect().width, canvas: document.querySelector('.canvas-frame').getBoundingClientRect().width, active: [...document.querySelectorAll('.right-panel [role="tab"][aria-selected="true"]')].map(b => b.textContent) }; });
	await page.click('.tab-panel-right');
	// 버튼 상태는 패널 폭 변경 이벤트(onResize) 뒤에 바뀐다 → 둘 다 기다린다
	await page.waitForFunction(() => document.querySelector('.right-panel').getBoundingClientRect().width < 1 && document.querySelector('.tab-panel-right').getAttribute('aria-expanded') === 'false');
	assert.equal(await page.$eval('.right-panel-content', panel => panel.inert), true, '숨긴 패널은 키보드 포커스 대상에서 제외');
	assert.ok(await page.$eval('.canvas-frame', (frame, width) => frame.getBoundingClientRect().width > width + 100, rightBefore.canvas), '닫힌 패널의 공간은 캔버스가 사용');
	await page.click('.tab-panel-right');
	await page.waitForFunction(() => document.querySelector('.right-panel').getBoundingClientRect().width > 200);
	assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.right-panel [role="tab"][aria-selected="true"]')].map(b => b.textContent)), rightBefore.active, '재개방 후 선택한 우측 탭 유지');
	assert.equal(await page.evaluate(() => window.rightPaneBefore === document.querySelector('.right-panel .pane')), true, '패널 내용을 재생성하지 않는다');
	assert.ok(Math.abs(await page.$eval('.right-panel', panel => panel.getBoundingClientRect().width) - rightBefore.width) < 2, '재개방 후 원래 패널 폭 복원');
	const rightToggleBox = await (await page.$('.tab-panel-right')).boundingBox();
	await page.evaluate(() => { window.sent.length = 0; });
	await page.mouse.move(rightToggleBox.x + rightToggleBox.width / 2, rightToggleBox.y + rightToggleBox.height / 2); await page.mouse.down();
	await page.mouse.move(rightToggleBox.x - 80, rightToggleBox.y + 30, { steps: 4 }); await page.mouse.up();
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'setTabOrder')), false, '우측 토글은 끌어서 탭을 옮길 수 없다');
	console.log('Palette favorites: 별 정렬·등록/해제·상단 목록·복원·클릭/실제 드롭; 우측 패널 접기/펼치기·상태/폭 유지·드래그 제외 passed');

	if (process.env.PALETTE_SCREENSHOT) { await page.screenshot({ path: process.env.PALETTE_SCREENSHOT }); }
	console.log('Palette: 묶음·아이콘·검색·선택 기준 클릭·드롭 위치·실제 마우스 드롭·고정 버튼 passed');
}
