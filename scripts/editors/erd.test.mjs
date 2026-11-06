import assert from 'node:assert/strict';

// ERD > 사용 테이블: 데이터가 맞게 저장되고 다른 기능을 건드리지 않는지만 본다(모양·색·글꼴 같은 세부는 보지 않는다)
export default async function ({ page }) {
	await page.evaluate(() => { window.sent.length = 0; window.tab('ERD').click(); });
	await page.waitForFunction(() => window.sent.some(m => m.type === 'loadUsedTables'));
	await page.evaluate(() => window.send({ type: 'usedTables' }));
	await page.waitForSelector('.used-tables-setup');
	await page.$$eval('.used-tables-setup button', bs => bs.find(b => b.textContent === '기본 위치 사용').click());
	assert.deepEqual(await page.evaluate(() => window.sent.findLast(m => m.type === 'chooseTablesFolder')), { type: 'chooseTablesFolder', pick: false });
	await page.evaluate(() => {
		window.lastSave = () => window.sent.findLast(m => m.type === 'saveUsedTables')?.data;
		window.send({ type: 'usedTables', folder: 'C:/x', file: 'C:/x/ui/a.json', data: { tables: [], links: [], memos: [], groups: [], shapes: [] } });
	});
	await page.waitForSelector('.used-tables-flow .flow-empty');

	const last = () => page.evaluate(() => window.lastSave());
	// 저장은 400ms 모았다가 보낸다: 그만큼 기다린 뒤 마지막 저장 내용
	const saved = async () => { await new Promise(r => setTimeout(r, 450)); return last(); };
	const until = (test, message, arg) => page.waitForFunction(test, { timeout: 3000 }, arg).catch(async () => assert.fail(`${message}: ${JSON.stringify(await last())}`));
	const ctrl = async key => { await page.keyboard.down('Control'); await page.keyboard.press(key); await page.keyboard.up('Control'); };
	const centerOf = (selector, name) => page.evaluate((selector, name) => {
		const node = name ? [...document.querySelectorAll('.react-flow__node-table')].find(n => n.querySelector('.name')?.textContent === name) : document;
		const r = node.querySelector(selector).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	}, selector, name);
	/** 그림 바닥(아무것도 없는 곳) 한 점(fx·fy: 그림 안 비율에서 찾기 시작) */
	const emptySpot = (fx = 0.5, fy = 0.8) => page.evaluate((fx, fy) => {
		const r = document.querySelector('.used-tables-flow').getBoundingClientRect();
		for (let i = 0; i < 400; i++) {
			const x = r.x + r.width * ((fx + (i % 20) * 0.037) % 0.9 + 0.05), y = r.y + r.height * ((fy + Math.floor(i / 20) * 0.043) % 0.9 + 0.05);
			if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane') && !document.elementsFromPoint(x, y).some(e => e.closest('.react-flow__node, .react-flow__edge, .react-flow__panel'))) { return { x, y }; }
		}
	}, fx, fy);
	const clickEmpty = async () => { const p = await emptySpot(); await page.mouse.click(p.x, p.y); };
	const drag = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up(); };
	const menu = label => page.$$eval('.context-menu button', (bs, label) => bs.find(b => b.textContent.startsWith(label)).click(), label);

	// 테이블: 도구 줄 → 그림 클릭, 빈 곳 더블클릭. 연달아 고치면 모아서 저장
	await page.click('.flow-toolbar button[aria-label="테이블"]');
	{ const p = await emptySpot(0.4, 0.4); await page.mouse.click(p.x, p.y); }
	await page.waitForFunction(() => document.activeElement?.matches('.react-flow__node-table input.field-input'));
	await page.keyboard.type('TB_PROGRAM'); await page.keyboard.press('Enter');
	{ const p = await emptySpot(0.75, 0.3); await page.mouse.click(p.x, p.y, { count: 2 }); }
	await page.waitForFunction(() => document.activeElement?.matches('.react-flow__node-table input.field-input'));
	await page.keyboard.type('TB_AUTH'); await page.keyboard.press('Enter');
	await until(() => window.lastSave()?.tables.map(t => t.name).join() === 'TB_PROGRAM,TB_AUTH', '테이블 두 개');
	assert.ok(await page.evaluate(() => window.sent.filter(m => m.type === 'saveUsedTables').length) <= 3, '연달아 고치면 모아서 저장');

	// CRUD·컬럼(이름 → Tab → 설명 → Tab → 타입 → Enter, PK)
	await page.click('.react-flow__node-table .name');
	for (const label of ['조회', '수정']) { await page.click(`.used-table-node button[aria-label="TB_PROGRAM ${label}"]`); }
	const addColumn = async (table, name, desc, type, pk) => {
		const node = await page.evaluateHandle(table => [...document.querySelectorAll('.react-flow__node-table')].find(n => n.querySelector('.name')?.textContent === table), table);
		await (await node.$('.name')).click();
		await (await node.waitForSelector('.add-column')).click();
		await page.waitForFunction(() => document.activeElement?.matches('input.field-input.col-name'));
		await page.keyboard.type(name); await page.keyboard.press('Tab');
		await page.keyboard.type(desc); await page.keyboard.press('Tab');
		await page.keyboard.type(type); await page.keyboard.press('Enter');
		if (pk) { await node.evaluate((n, name) => n.querySelector(`button[aria-label="${name} 컬럼 PK"]`).click(), name); }
	};
	await addColumn('TB_PROGRAM', 'PROGRAM_NM', '프로그램명', 'VARCHAR(100)', false);
	await addColumn('TB_PROGRAM', 'PROGRAM_CD', '프로그램 코드', 'VARCHAR(20)', true);
	await addColumn('TB_AUTH', 'PROGRAM_CD', '프로그램 코드', 'TEXT', true);
	{
		const d = await saved();
		assert.deepEqual(d.tables.map(t => t.columns.map(c => [c.name, c.desc, c.type, c.pk])), [
			[['PROGRAM_NM', '프로그램명', 'VARCHAR(100)', false], ['PROGRAM_CD', '프로그램 코드', 'VARCHAR(20)', true]],
			[['PROGRAM_CD', '프로그램 코드', 'TEXT', true]],
		]);
		assert.deepEqual(d.tables[0].crud, ['R', 'U'], 'CRUD 저장');
	}

	// 선: 오른쪽 점 → 다른 박스 왼쪽 점(끝 화살표), 더블클릭으로 글자
	await page.keyboard.press('Escape');
	await clickEmpty();
	await drag(await centerOf('.react-flow__handle-right', 'TB_PROGRAM'), await centerOf('.react-flow__handle-left', 'TB_AUTH'));
	await until(() => window.lastSave()?.links.length === 1, '선 잇기');
	assert.deepEqual((await last()).links.map(l => l.arrow), ['end']);
	await page.waitForSelector('.react-flow__edge-path');
	{
		const e = await page.evaluate(() => { const path = document.querySelector('.react-flow__edge-path'), m = path.getScreenCTM(), p = path.getPointAtLength(path.getTotalLength() / 3); return { x: p.x * m.a + m.e, y: p.y * m.d + m.f }; });
		await page.mouse.click(e.x, e.y, { count: 2 });
	}
	await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '선 글자');
	await page.keyboard.type('1:N'); await page.keyboard.press('Enter');
	await until(() => window.lastSave()?.links[0].label === '1:N', '선 글자');

	// 메모: 우클릭 → 메모 추가(Enter는 줄바꿈, Esc로 반영)
	{ const p = await emptySpot(0.3, 0.7); await page.mouse.click(p.x, p.y, { button: 'right' }); }
	await page.waitForSelector('.context-menu');
	await menu('메모 추가');
	await page.waitForFunction(() => document.activeElement?.matches('.used-memo textarea'));
	await page.keyboard.type('조회 화면에서만'); await page.keyboard.press('Enter'); await page.keyboard.type('수정은 팝업');
	await page.keyboard.press('Escape');
	await until(() => window.lastSave()?.memos[0]?.text === '조회 화면에서만\n수정은 팝업', '메모 내용');

	// 그룹: 모두 선택 → 우클릭 그룹으로 묶기. 손잡이를 끌면 안에 든 것도 같은 만큼
	await clickEmpty();
	await ctrl('a');
	{ const p = await centerOf('.name', 'TB_PROGRAM'); await page.mouse.click(p.x, p.y, { button: 'right' }); }
	await page.waitForSelector('.context-menu');
	await menu('그룹으로 묶기');
	await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '그룹 이름');
	await page.keyboard.type('권한 조회'); await page.keyboard.press('Enter');
	await until(() => window.lastSave()?.groups[0]?.title === '권한 조회', '그룹 이름');
	const before = await saved(), g = before.groups[0];
	assert.ok(before.tables.every(t => t.x > g.x && t.y > g.y && t.x < g.x + g.w && t.y < g.y + g.h), '그룹이 고른 것을 감쌈');
	{
		const h = await page.$eval('.group-handle', el => { const r = el.getBoundingClientRect(); return { x: r.right - 6, y: r.bottom - 4 }; });
		await drag(h, { x: h.x + 60, y: h.y + 40 });
	}
	const after = await saved();
	const dx = after.groups[0].x - g.x, dy = after.groups[0].y - g.y;
	assert.ok(dx !== 0 || dy !== 0, '그룹이 움직임');
	assert.deepEqual(after.tables.map(t => [t.x - dx, t.y - dy]), before.tables.map(t => [t.x, t.y]), '안의 테이블도 같은 만큼');
	assert.deepEqual(after.memos.map(m => [m.x - dx, m.y - dy]), before.memos.map(m => [m.x, m.y]), '안의 메모도 같은 만큼');

	// 되돌리기·다시(Ctrl+Z·Y): VS Code로 넘기지 않는다
	await clickEmpty();
	const leaked = await page.evaluate(() => window.leakedUndo);
	await ctrl('z');
	await until(x => window.lastSave()?.groups[0].x === x, 'Ctrl+Z로 그룹 자리 되돌림', g.x);
	await ctrl('y');
	await until(x => window.lastSave()?.groups[0].x === x, 'Ctrl+Y로 다시', after.groups[0].x);
	assert.equal(await page.evaluate(() => window.leakedUndo), leaked, 'Ctrl+Z·Y가 VS Code로 안 넘어감');

	// 바깥(AI·사람)에서 JSON을 고치면 그림에 반영: 다시 저장하지 않고, 아직 안 보낸 그림 수정이 덮지 않고, Ctrl+Z로 반영 전 그림으로
	{
		const ext = { id: 'ext', name: 'EXT_TBL', desc: '', crud: ['R'], columns: [], keysOnly: false, color: '', x: after.tables[0].x, y: after.tables[0].y - 400 };
		const saves = () => page.evaluate(() => window.sent.filter(m => m.type === 'saveUsedTables').length);
		const hasExt = () => page.evaluate(() => [...document.querySelectorAll('.react-flow__node-table .name')].some(n => n.textContent === 'EXT_TBL'));
		await ctrl('z');
		const count = await saves();
		await page.evaluate(d => window.send({ type: 'usedTables', folder: 'C:/x', file: 'C:/x/ui/a.json', data: d, external: true }), { ...after, tables: [...after.tables, ext] });
		await page.waitForFunction(() => [...document.querySelectorAll('.react-flow__node-table .name')].some(n => n.textContent === 'EXT_TBL'), { timeout: 3000 }).catch(() => assert.fail('바깥에서 고친 테이블이 그림에'));
		await new Promise(r => setTimeout(r, 450));
		assert.equal(await saves(), count, '바깥 수정은 다시 저장하지 않고, 보내기 전 그림 수정(Ctrl+Z)도 그걸 덮지 않음');
		// 깨진 JSON: 그림은 그대로, 알림만
		await page.evaluate(() => window.send({ type: 'usedTables', folder: 'C:/x', file: 'C:/x/ui/a.json', error: '바뀐 JSON을 읽지 못해' }));
		await page.waitForSelector('.used-tables .error');
		assert.equal(await hasExt(), true, '깨진 JSON이면 그림 그대로');
		await clickEmpty();
		await ctrl('z');
		const back = await saved();
		assert.equal(back.tables.some(t => t.name === 'EXT_TBL'), false, 'Ctrl+Z로 반영 전 그림');
		assert.equal(back.groups[0].x, g.x, '반영 전 그림은 그때 고친 것(Ctrl+Z) 그대로');
		// 이어지는 확인은 바깥 수정 전 그림(after)에서
		await page.evaluate(d => window.send({ type: 'usedTables', folder: 'C:/x', file: 'C:/x/ui/a.json', data: d, external: true }), after);
		await page.waitForFunction(() => !document.querySelector('.used-tables .error'), { timeout: 3000 }).catch(() => assert.fail('다시 읽으면 알림 사라짐'));
	}

	// 복사·붙여넣기: 새 id, 이름·컬럼 그대로
	{ const p = await centerOf('.name', 'TB_AUTH'); await page.mouse.click(p.x, p.y); }
	await page.keyboard.down('Control'); await page.keyboard.press('c'); await page.keyboard.press('v'); await page.keyboard.up('Control');
	await until(() => window.lastSave()?.tables.length === 3, '붙여넣기');
	{
		const pasted = (await last()).tables;
		assert.equal(pasted[2].name, 'TB_AUTH');
		assert.notEqual(pasted[2].id, pasted[1].id);
		assert.deepEqual(pasted[2].columns.map(c => c.name), ['PROGRAM_CD']);
	}

	// Delete: 그림에서만 지우고 Design 컴포넌트 삭제 요청은 안 보냄(포커스가 body여도)
	await page.keyboard.press('Delete');
	await until(() => window.lastSave()?.tables.length === 2, 'Delete로 지우기');
	await page.evaluate(() => document.activeElement?.blur());
	await page.keyboard.press('Delete');
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'delete')), false, 'Delete가 디자인 컴포넌트를 안 지움');

	// 다른 탭에 갔다 와도 되돌리기 기록 그대로(ERD를 숨겨 둔 채 유지), 숨은 동안 Delete는 ERD가 받지 않음
	const tables = (await saved()).tables.length;
	await page.evaluate(() => window.tab('Design').click());
	await page.waitForFunction(() => document.querySelector('.right-panel').getBoundingClientRect().width > 100, { timeout: 3000 });
	await page.evaluate(() => { window.sent.length = 0; document.activeElement?.blur(); });
	await page.keyboard.press('Delete');
	await new Promise(r => setTimeout(r, 450));
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'saveUsedTables')), false, '숨은 ERD는 Delete를 안 받음');
	await page.evaluate(() => window.tab('ERD').click());
	await page.waitForSelector('.used-tables-flow');
	await ctrl('z');
	await until(n => window.lastSave()?.tables.length === n, '돌아와도 되돌리기 기록 유지(지운 테이블 되살림)', tables + 1);
	console.log('ERD: 저장 위치·테이블·컬럼·CRUD·선·메모·그룹·되돌리기·바깥 JSON·복붙·Delete·탭 전환 passed');
}
