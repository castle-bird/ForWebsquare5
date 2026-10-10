import assert from 'node:assert/strict';

export default async function ({ page }) {
	await page.evaluate(() => {
		const defs = [...window.testDefs, { id: 'group', ns: 'urn:test', realType: 'group', parents: [], bases: [], properties: [], events: [] }];
		const text = '<html xmlns:w2="urn:test"><body><w2:group id="cssParent" class="parent" style="padding:20px;height:150px"><w2:input id="cssInput" class="same"/><w2:input id="cssUnique" class="unique"/><w2:input id="cssNone"/></w2:group><w2:gridView id="cssGrid"><w2:gBody><w2:row><w2:column id="cssCell"/></w2:row></w2:gBody></w2:gridView></body></html>';
		const root = window.parseXml(text);
		root.children[0].children[0].def = window.testDefs.length;
		root.children[0].children[0].children.forEach(n => { n.def = 0; });
		root.children[0].children[1].def = 2;
		window.send({ type: 'definitions', defs });
		const rule = (selector, file, line, media = [], supports = []) => ({ selector, match: selector, file, line, ch: 0, media, supports });
		window.send({ type: 'styles', css: ['.same{margin:3px}.parent > .same{padding:2px}.unique{margin:2px}'], rules: [
			rule('.same', '/css/common.css', 2),
			rule('.parent > .same, #cssInput', '/css/screen.css', 5),
			rule('.other .same', '/css/other.css', 1),
			rule('.same', '/css/print.css', 2, ['print']),
			rule('.same', '/css/future.css', 2, [], ['(display: not-a-display)']),
			rule('.unique', '/css/screen.css', 8),
			rule('td', '/css/grid.css', 11),
			rule('[invalid', '/css/broken.css', 0),
			rule('.same', 'C:\\css\\common.css', 9),
		] });
		window.send({ type: 'document', version: 2, text, root, script: { text: '' } });
	});
	await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#cssInput'));
	const open = async id => {
		const point = await page.evaluate(id => {
			const r = document.querySelector('.canvas-host').shadowRoot.querySelector(id === 'cssCell' ? '#cssGrid td' : '#' + id).getBoundingClientRect();
			window.sent.length = 0;
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		}, id);
		await page.mouse.click(point.x, point.y, { button: 'right' });
		await page.waitForSelector('.context-menu');
	};
	const submenu = '.context-menu[aria-label="CSS 보기"]';
	const show = async () => {
		const trigger = await page.$('.context-menu button[aria-haspopup="menu"]');
		await trigger.click();
		await page.waitForSelector(submenu, { visible: true });
	};
	const go = async at => {
		const buttons = await page.$$(submenu + ' button');
		await buttons[at].click();
		await page.waitForFunction(() => window.sent.some(m => m.type === 'openCss'));
		assert.equal(await page.$('.context-menu'), null, '선택하면 부모·하위 메뉴 함께 닫힘');
		return page.evaluate(() => window.sent.find(m => m.type === 'openCss').rules);
	};
	await open('cssInput');
	assert.equal(await page.$eval('.context-menu button', b => b.textContent), 'CSS 보기');
	assert.equal(await page.$eval('.context-menu button .codicon-chevron-right', e => getComputedStyle(e).fontFamily), 'codicon', '하위 메뉴 화살표는 VS Code Codicon');
	await page.hover('.context-menu button[aria-haspopup="menu"]');
	await page.waitForSelector(submenu, { visible: true });
	assert.deepEqual(await page.$$eval(submenu + ' button', bs => bs.map(b => b.textContent)), ['common.css', 'screen.css', 'common.css'], '파일명만 표시, 같은 이름의 다른 위치도 보존');
	const position = await page.evaluate(() => {
		const trigger = document.querySelector('.context-menu button[aria-haspopup="menu"]').getBoundingClientRect();
		const child = document.querySelector('.context-menu[aria-label="CSS 보기"]').getBoundingClientRect();
		return { right: trigger.right, left: child.left, top: trigger.top, childTop: child.top };
	});
	assert.ok(Math.abs(position.right - position.left) <= 1 && Math.abs(position.top - position.childTop) <= 1, '우측에 연결');
	assert.deepEqual(await go(1), [1], '복합 선택자·중복 class, 비활성 조건과 잘못된 선택자는 제외');
	await open('cssInput');
	await show();
	assert.deepEqual(await go(2), [8], '파일명이 같아도 선택한 원본 위치 번호 유지');
	await open('cssUnique');
	await show();
	assert.deepEqual(await go(0), [5], '단일 규칙도 웹뷰에서 선택');
	await open('cssNone');
	await show();
	assert.equal(await page.$eval(submenu + ' button', b => b.disabled && b.textContent), '일치하는 CSS 없음');
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'openCss')), false, '빈 목록은 VS Code 팝업을 요청하지 않음');
	await page.keyboard.press('Escape');
	assert.equal(await page.$('.context-menu'), null);
	await open('cssInput');
	await page.keyboard.press('ArrowRight');
	await page.waitForFunction(() => document.activeElement?.textContent === 'common.css');
	await page.keyboard.press('ArrowDown');
	assert.equal(await page.evaluate(() => document.activeElement.textContent), 'screen.css');
	await page.keyboard.press('ArrowLeft');
	assert.equal(await page.$(submenu), null, '왼쪽 화살표로 하위 메뉴만 닫기');
	assert.equal(await page.evaluate(() => document.activeElement.textContent), 'CSS 보기');
	await page.keyboard.press('ArrowRight');
	await page.waitForSelector(submenu, { visible: true });
	await page.mouse.click(5, 5);
	assert.equal(await page.$('.context-menu'), null, '바깥 클릭으로 전체 닫기');
	await page.evaluate(() => {
		window.sent.length = 0;
		document.querySelector('.canvas-host').shadowRoot.querySelector('#cssInput').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, clientX: innerWidth - 5, clientY: innerHeight - 5 }));
	});
	await page.waitForSelector('.context-menu');
	await show();
	const edge = await page.evaluate(() => {
		const child = document.querySelector('.context-menu[aria-label="CSS 보기"]').getBoundingClientRect();
		const trigger = document.querySelector('.context-menu button[aria-haspopup="menu"]').getBoundingClientRect();
		return { left: child.left, right: child.right, top: child.top, bottom: child.bottom, triggerLeft: trigger.left, width: innerWidth, height: innerHeight };
	});
	assert.ok(edge.left >= 0 && edge.right <= edge.width && edge.top >= 0 && edge.bottom <= edge.height, '가장자리에서도 메뉴가 화면 안에 표시');
	assert.ok(edge.right <= edge.triggerLeft + 1, '오른쪽 공간이 없으면 왼쪽으로 연결');
	await page.keyboard.press('Escape');
	await open('cssCell');
	assert.ok(await page.evaluate(() => [...document.querySelectorAll('.context-menu button')].some(b => b.textContent === 'Header 추가')), '기존 그리드 메뉴 유지');
	await show();
	assert.deepEqual(await go(0), [6], '그리드 칸 CSS를 그리드 전체 CSS와 구분');
	console.log('CSS 보기: 연결 하위 메뉴·파일명·원본 위치·조건·단일·없음·키보드·닫기·그리드 passed');
}
