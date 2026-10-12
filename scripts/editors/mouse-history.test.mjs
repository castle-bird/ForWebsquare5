import assert from 'node:assert/strict';

export default async function ({ page }) {
	await page.evaluate(() => {
		window.send({ type: 'linkTabs', tabs: [
			{ id: 'controller', label: 'Controller' }, { id: 'service', label: 'Service' },
			{ id: 'mapper', label: 'Mapper' }, { id: 'mybatis', label: 'Mybatis' }, { id: 'custom', label: 'Custom' },
		], exts: ['.java', '.xml', '.css'] });
	});
	await page.waitForFunction(() => window.tab('Custom'));
	const sequence = ['Design', 'Info', 'Script', 'Source', 'ERD', 'Controller', 'Service', 'Mapper', 'Mybatis', 'Custom'];
	const shown = () => page.evaluate(() => document.querySelector('.canvas-frame .tab-bar [role="tab"][aria-selected="true"]').textContent);
	const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
	const release = button => page.evaluate(button => {
		window.sent.length = 0;
		window.dispatchEvent(new MouseEvent('mouseup', { button, cancelable: true }));
		return window.sent.filter(m => m.type === 'navigate');
	}, button);
	const navigate = async (button, area = '.canvas-frame .tab-body:not([hidden])') => {
		const point = await page.$eval(area, el => {
			const r = el.getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + Math.min(70, r.height / 2) };
		});
		await page.evaluate(() => { window.sent.length = 0; });
		await page.mouse.click(point.x, point.y, { button });
		await settle();
		return page.evaluate(() => window.sent.filter(m => m.type === 'navigate'));
	};
	for (const name of sequence) {
		await page.evaluate(name => window.tab(name).click(), name);
		await page.waitForFunction(name => document.querySelector('.canvas-frame .tab-bar [aria-selected="true"]')?.textContent === name, {}, name);
		await settle();
		for (const button of [3, 4]) {
			assert.deepEqual(await release(button), []);
			await settle();
			assert.equal(await shown(), name, name + ': 밖에서 누르고 돌아온 놓음은 추가 이동 없음');
		}
	}
	for (let i = sequence.length - 2; i >= 0; i--) {
		assert.deepEqual(await navigate('back'), [], '웹뷰 기록이 있으면 VS Code 이동 없음');
		assert.equal(await shown(), sequence[i], '뒤로 클릭 한 번 = 이전 탭 한 칸');
	}
	assert.deepEqual(await navigate('back'), [{ type: 'navigate', back: true }], '기록 끝에서 VS Code로 한 번 전달');
	assert.deepEqual(await release(3), [], '중복 놓음은 다시 전달하지 않음');
	for (let i = 1; i < sequence.length; i++) {
		assert.deepEqual(await navigate('forward', i % 2 ? '.right-panel' : undefined), [], '오른쪽 패널에서도 기존 탭 탐색');
		assert.equal(await shown(), sequence[i], '앞으로 클릭 한 번 = 다음 탭 한 칸');
	}
	assert.deepEqual(await navigate('forward'), [{ type: 'navigate', back: false }], '앞으로 기록 끝에서 VS Code로 한 번 전달');
	assert.deepEqual(await release(4), [], '앞으로 중복 놓음도 무시');
	// 돌아간 뒤 새 탭을 열면 이전 앞으로 기록은 사라진다.
	await navigate('back');
	assert.equal(await shown(), 'Mybatis');
	await page.evaluate(() => window.tab('Info').click());
	await settle();
	assert.deepEqual(await navigate('forward'), [{ type: 'navigate', back: false }], '새 탭을 고르면 이전 앞으로 기록 삭제');
	console.log('Mouse history: Design·Info·Script·Source·ERD·연결/사용자 탭, 실제 앞뒤 버튼·오른쪽 패널·기록 경계·중복 놓음 passed');
}
