import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';

export default async function ({ page }) {
		// ERD > 사용 테이블: 처음엔 저장 위치 고르기 → 그림 안에서 테이블·컬럼·메모·그룹 만들기, 선 잇기(화살표·글자), 되돌리기·복붙, Delete가 디자인 컴포넌트를 안 지움
		{
			assert.equal(await page.$eval('.canvas-frame .tab-bar', bar => { const tabs = [...bar.querySelectorAll('button[role="tab"]')]; return tabs.at(-1).textContent; }), 'ERD', 'ERD는 탭 줄 맨 오른쪽');
			await page.evaluate(() => { window.sent.length = 0; window.tab('ERD').click(); });
			await page.waitForFunction(() => window.sent.some(m => m.type === 'loadUsedTables'));
			await page.evaluate(() => window.send({ type: 'usedTables' }));
			await page.waitForSelector('.used-tables-setup');
			await page.$$eval('.used-tables-setup button', bs => bs.find(b => b.textContent === '기본 위치 사용').click());
			assert.deepEqual(await page.evaluate(() => window.sent.findLast(m => m.type === 'chooseTablesFolder')), { type: 'chooseTablesFolder', pick: false });
			// 위아래로 겹쳐 마주 보는 박스(가로가 조금 어긋나도)는 꺾이지 않은 곧은 선, 많이 어긋나면 꺾인 선
			{
				const box = (id, x, y) => ({ id, name: id, desc: '', crud: [], columns: [], keysOnly: false, x, y });
				const show = tables => page.evaluate(tables => window.send({ type: 'usedTables', folder: 'C:/x', file: 'C:/x/ui/a.json', data: { tables, links: [{ from: 'A', to: 'B', arrow: 'end', label: '' }], memos: [], groups: [], shapes: [] } }), tables);
				await show([box('A', 0, 0), box('B', 40, 300)]);
				await page.waitForFunction(() => /^M ([\d.-]+),[\d.-]+ ?L ?\1,[\d.-]+$/.test(document.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? ''), { timeout: 3000 })
					.catch(async () => assert.fail(`겹쳐 마주 보면 곧은 선: ${await page.$eval('.react-flow__edge-path', p => p.getAttribute('d'))}`));
				// 마우스 모양: 바닥은 화살표, 테이블·선 위는 손가락
				assert.deepEqual(await page.evaluate(() => ['.react-flow__pane', '.react-flow__node-table', '.react-flow__node-table .name', '.react-flow__edge'].map(s => getComputedStyle(document.querySelector(s)).cursor)),
					['default', 'pointer', 'pointer', 'pointer'], '바닥 화살표, 요소 위 손가락');
				// 왼쪽 아래 배율 표시: 확대하면 커지고, 누르면 100%
				const zoomText = () => page.$eval('.react-flow__controls .zoom-level', b => b.textContent);
				await page.click('.react-flow__controls-zoomin');
				await page.waitForFunction(() => parseInt(document.querySelector('.react-flow__controls .zoom-level').textContent) > 100, { timeout: 3000 }).catch(async () => assert.fail(`확대하면 배율 커짐: ${await zoomText()}`));
				await page.click('.react-flow__controls .zoom-level');
				await page.waitForFunction(() => document.querySelector('.react-flow__controls .zoom-level').textContent === '100%', { timeout: 3000 }).catch(async () => assert.fail(`누르면 100%: ${await zoomText()}`));
				await show([box('A', 0, 0), box('B', 600, 300)]);
				await page.waitForFunction(() => document.querySelector('.react-flow__edge-path')?.getAttribute('d').includes('Q'), { timeout: 3000 });
			}
			await page.evaluate(() => window.send({ type: 'usedTables', folder: 'C:/x', file: 'C:/x/ui/a.json', data: { tables: [], links: [], memos: [], groups: [], shapes: [] } }));
			await page.waitForSelector('.used-tables-flow .flow-empty');
			// 저장은 잠깐 모았다가 보내므로 조금 기다린 뒤 마지막 저장 내용
			const saved = async () => { await new Promise(r => setTimeout(r, 500)); return page.evaluate(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data); };
			const until = (test, message) => page.waitForFunction(test, { timeout: 3000 }).catch(async () => assert.fail(`${message}: ${JSON.stringify(await saved())}`));
			const focused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName);
			const tool = label => page.click(`.flow-toolbar button[aria-label="${label}"]`);
			const nodeOf = name => page.evaluateHandle(name => [...document.querySelectorAll('.react-flow__node-table')].find(n => n.querySelector('.name')?.textContent === name), name);
			const centerOf = async (selector, name) => page.evaluate((selector, name) => {
				const node = name ? [...document.querySelectorAll('.react-flow__node-table')].find(n => n.querySelector('.name')?.textContent === name) : document;
				const r = (name ? node.querySelector(selector) : document.querySelector(selector)).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
			}, selector, name);
			/** 그림 바닥(아무것도 없는 곳) 한 점: 아래쪽부터 찾는다(fx·fy: 그림 안 비율에서 시작) */
			const emptySpot = (fx = 0.5, fy = 0.8) => page.evaluate((fx, fy) => {
				const r = document.querySelector('.used-tables-flow').getBoundingClientRect();
				for (let i = 0; i < 400; i++) {
					const x = r.x + r.width * ((fx + (i % 20) * 0.037) % 0.9 + 0.05), y = r.y + r.height * ((fy + Math.floor(i / 20) * 0.043) % 0.9 + 0.05);
					const el = document.elementFromPoint(x, y);
					if (el?.classList.contains('react-flow__pane') && !document.elementsFromPoint(x, y).some(e => e.closest('.react-flow__node, .react-flow__edge, .react-flow__panel'))) { return { x, y }; }
				}
			}, fx, fy);
			const zoom = () => page.$eval('.react-flow__viewport', v => new DOMMatrix(getComputedStyle(v).transform).a);
			// 도구 줄 "테이블" → 그림 클릭: 그 자리에 놓고 이름 칸이 바로 입력, Enter면 반영하고 입력칸에서 빠져나옴
			await tool('테이블');
			assert.equal(await page.$eval('.flow-toolbar button[aria-label="테이블"]', b => b.getAttribute('aria-pressed')), 'true', '도구 고름');
			{ const p = await emptySpot(0.4, 0.4); await page.mouse.click(p.x, p.y); }
			await page.waitForFunction(() => document.activeElement?.matches('.react-flow__node-table input.field-input'));
			await page.keyboard.type('TB_PROGRAM');
			await page.keyboard.press('Enter');
			assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'INPUT', 'Enter면 입력칸에서 빠져나옴');
			await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.tables[0]?.name === 'TB_PROGRAM', '테이블 이름 저장');
			// 확대한 뒤 테이블을 더 추가해도 확대 비율 그대로(빈 곳 더블클릭 = 그 자리에 테이블)
			await page.click('.react-flow__controls-zoomin');
			await page.click('.react-flow__controls-zoomin');
			await new Promise(r => setTimeout(r, 400));
			const zoomed = await zoom();
			const flowBox = await page.$eval('.used-tables-flow', f => { const r = f.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
			await page.mouse.click(flowBox.x + flowBox.w * 0.75, flowBox.y + flowBox.h * 0.3, { count: 2 });
			await page.waitForFunction(() => document.activeElement?.matches('.react-flow__node-table input.field-input'));
			await page.keyboard.type('TB_AUTH');
			await page.keyboard.press('Enter');
			await new Promise(r => setTimeout(r, 300));
			assert.equal(await zoom(), zoomed, '테이블을 추가해도 확대 비율 유지');
			await page.click('.react-flow__controls-fitview');
			await new Promise(r => setTimeout(r, 300));
			await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.tables.map(t => t.name).join() === 'TB_PROGRAM,TB_AUTH', '두 번째 테이블');
			assert.equal(await page.evaluate(() => window.sent.filter(m => m.type === 'saveUsedTables').length) <= 3, true, '연달아 고치면 모아서 저장');
			// 박스를 고르면 CRUD 토글·컬럼 추가. 컬럼: 이름 → Tab → 설명 → Tab → 타입 → Enter, 박스에 설명도 보임
			await page.click(`.react-flow__node-table .name`);
			const crud = async (table, labels) => { for (const label of labels) { await page.click(`.used-table-node button[aria-label="${table} ${label}"]`); } };
			await crud('TB_PROGRAM', ['조회', '수정']);
			const addColumn = async (table, name, desc, type, pk) => {
				const n = await nodeOf(table);
				await (await n.$('.name')).click();
				await (await n.waitForSelector('.add-column')).click();
				await page.waitForFunction(() => document.activeElement?.matches('input.field-input.col-name'));
				await page.keyboard.type(name); await page.keyboard.press('Tab');
				assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('col-desc')), true, 'Tab: 설명 칸으로');
				await page.keyboard.type(desc); await page.keyboard.press('Tab');
				await page.keyboard.type(type); await page.keyboard.press('Enter');
				if (pk) { await page.evaluate((table, name) => [...document.querySelectorAll('.react-flow__node-table')].find(n => n.querySelector('.name').textContent === table)
					.querySelector(`button[aria-label="${name} 컬럼 PK"]`).click(), table, name); }
			};
			await addColumn('TB_PROGRAM', 'PROGRAM_NM', '프로그램명', 'VARCHAR(100)', false);
			await addColumn('TB_PROGRAM', 'PROGRAM_CD', '프로그램 코드', 'VARCHAR(20)', true);
			await addColumn('TB_AUTH', 'PROGRAM_CD', '프로그램 코드', '', true);
			// 타입 칸: 입력 + PostgreSQL 타입 목록(그림 밖 body에 떠서 확대돼도 칸 바로 아래), 목록에서 고르면 반영
			{
				const type = await centerOf('.col-type', 'TB_AUTH');
				await page.mouse.click(type.x, type.y, { count: 2 });
				await page.waitForSelector('body > .combo-list li');
				const [inputBox, listBox] = await page.evaluate(() => [document.activeElement, document.querySelector('body > .combo-list')].map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), bottom: Math.round(r.bottom), top: Math.round(r.top) }; }));
				assert.ok(Math.abs(listBox.x - inputBox.x) <= 2 && listBox.top >= inputBox.bottom && listBox.top - inputBox.bottom <= 6, `목록이 타입 칸 바로 아래: ${JSON.stringify([inputBox, listBox])}`);
				// ↓↓ Enter로 고르면 입력칸에 머물고(목록만 닫힘), 이어서 Tab·Shift+Tab으로 다른 칸(직접 입력과 같게 반영)
				await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
				assert.deepEqual(await page.evaluate(() => [document.activeElement?.classList.contains('col-type'), document.activeElement?.value]), [true, 'VARCHAR(50)'], '고른 값 + 타입 칸에 머묾');
				assert.equal(await page.$('.combo-list'), null, '고르면 목록 닫힘');
				await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
				await page.waitForFunction(() => document.activeElement?.matches('input.col-desc'), { timeout: 3000 });
				await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.tables[1]?.columns[0]?.type === 'VARCHAR(50)', '↓ Enter로 고른 타입 반영');
				// 클릭으로 골라도 머물고 Enter로 반영
				await page.keyboard.press('Tab');
				await page.waitForSelector('body > .combo-list li');
				await page.$$eval('body > .combo-list li', ls => ls.find(l => l.textContent === 'TEXT').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
				assert.equal(await page.evaluate(() => document.activeElement?.value), 'TEXT', '클릭으로 고른 값');
				await page.keyboard.press('Enter');
				await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.tables[1]?.columns[0]?.type === 'TEXT', '목록에서 타입 고르기');
			}
			// 한 번 클릭 편집(VS Code 탐색기처럼): 안 고른 박스는 첫 클릭에 고르기만, 고른 박스의 글자를 다시 클릭하면 입력칸. 누른 채 끌면 옮기기만
			{
				await page.keyboard.press('Escape');
				{ const p = await emptySpot(); await page.mouse.click(p.x, p.y); }
				let name = await centerOf('.name', 'TB_AUTH');
				await page.mouse.click(name.x, name.y);
				await new Promise(r => setTimeout(r, 300));
				assert.equal(await page.$('.used-table-node input.field-input'), null, '첫 클릭은 고르기만');
				await page.mouse.click(name.x, name.y);
				await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'TB_AUTH 테이블 이름', { timeout: 3000 });
				await page.keyboard.press('Escape');
				const x0 = (await saved()).tables[1].x;
				name = await centerOf('.name', 'TB_AUTH');
				await page.mouse.move(name.x, name.y); await page.mouse.down();
				await page.mouse.move(name.x + 80, name.y, { steps: 8 }); await page.mouse.up();
				await until(x0 => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.tables[1].x !== x0, '끌면 옮김');
				await new Promise(r => setTimeout(r, 300));
				assert.equal(await page.$('.used-table-node input.field-input'), null, '끈 뒤엔 입력칸 안 열림');
			}
			await until(() => [...document.querySelectorAll('.used-table-node')].map(n => [...n.querySelectorAll('li')].map(li => [...li.querySelectorAll('.col-name, .col-desc')].map(c => c.textContent).join('/')).join()).join('|')
				=== 'PROGRAM_CD/프로그램 코드,PROGRAM_NM/프로그램명|PROGRAM_CD/프로그램 코드', '박스 컬럼 줄(PK 먼저, 설명 같이)');
			assert.deepEqual((await saved()).tables[0].columns.map(c => [c.name, c.desc, c.type, c.pk]), [['PROGRAM_NM', '프로그램명', 'VARCHAR(100)', false], ['PROGRAM_CD', '프로그램 코드', 'VARCHAR(20)', true]]);
			assert.deepEqual((await saved()).tables[0].crud, ['R', 'U'], 'CRUD 저장');
			// CRUD 색: 넷 다 다르게(등록·수정 구분)
			await page.click(`.react-flow__node-table .name`);
			await crud('TB_PROGRAM', ['등록', '삭제']);
			const crudColors = await page.$$eval('.react-flow__node-table:first-of-type .crud button', bs => bs.map(b => getComputedStyle(b).backgroundColor));
			assert.equal(new Set(crudColors).size, 4, `등록·조회·수정·삭제 색이 모두 다름: ${crudColors}`);
			// PK만 보기
			await page.evaluate(() => document.querySelector('.used-table-node .columns-toggle').click());
			await page.waitForFunction(() => document.querySelector('.used-table-node .columns-toggle')?.textContent === '컬럼 1개 더 보기');
			await page.evaluate(() => document.querySelector('.used-table-node .columns-toggle').click());
			// 박스 오른쪽 점 → 다른 박스 왼쪽 점: 선(기본 화살표 끝 쪽), 마주 보는 면에 붙음
			{ const p = await emptySpot(); await page.mouse.click(p.x, p.y); }
			const [p1, p2] = [await centerOf('.react-flow__handle-right', 'TB_PROGRAM'), await centerOf('.react-flow__handle-left', 'TB_AUTH')];
			await page.mouse.move(p1.x, p1.y); await page.mouse.down();
			await page.mouse.move(p2.x, p2.y, { steps: 10 }); await page.mouse.up();
			await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.links.length === 1, '선 잇기');
			assert.deepEqual((await saved()).links.map(l => l.arrow), ['end'], '새 선은 끝에 화살표');
			await page.waitForSelector('.react-flow__edge-path[marker-end]');
			// 선 우클릭 → 양쪽 화살표, 더블클릭 → 글자
			const edgeAt = () => page.evaluate(() => { const path = document.querySelector('.react-flow__edge-path'), m = path.getScreenCTM(), p = path.getPointAtLength(path.getTotalLength() / 3); return { x: p.x * m.a + m.e, y: p.y * m.d + m.f }; });
			let e1 = await edgeAt();
			await page.mouse.click(e1.x, e1.y, { button: 'right' });
			await page.waitForSelector('.context-menu');
			await page.$$eval('.context-menu button', bs => bs.find(b => b.textContent.includes('양쪽')).click());
			await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.links[0].arrow === 'both', '양쪽 화살표');
			await page.waitForSelector('.react-flow__edge-path[marker-start][marker-end]');
			e1 = await edgeAt();
			await page.mouse.click(e1.x, e1.y, { count: 2 });
			await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '선 글자');
			await page.keyboard.type('1:N'); await page.keyboard.press('Enter');
			await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.links[0].label === '1:N', '선 글자');
			assert.equal(await page.$eval('.link-label', l => l.textContent), '1:N');
			// 우클릭 → 메모 추가: Enter는 줄바꿈, Esc로 반영
			const memoAt = await emptySpot(0.3, 0.7);
			await page.mouse.click(memoAt.x, memoAt.y, { button: 'right' });
			await page.waitForSelector('.context-menu');
			await page.$$eval('.context-menu button', bs => bs.find(b => b.textContent === '메모 추가').click());
			await page.waitForFunction(() => document.activeElement?.matches('.used-memo textarea'));
			await page.keyboard.type('조회 화면에서만'); await page.keyboard.press('Enter'); await page.keyboard.type('수정은 팝업');
			await page.keyboard.press('Escape');
			await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.memos[0]?.text === '조회 화면에서만\n수정은 팝업', '메모 내용');
			// 테이블을 고른 상태에서도 그룹 도구는 생성하지 않고, 다음 화면 클릭 위치에 놓는다.
			{
				const table = await page.$eval('.react-flow__node-table', el => { const r = el.getBoundingClientRect(); return { x: r.x + 3, y: r.y + 3 }; });
				await page.mouse.click(table.x, table.y);
				await page.waitForSelector('.react-flow__node-table.selected');
				const groups = (await saved()).groups.length;
				await tool('그룹');
				assert.equal(await page.$eval('.flow-toolbar button[aria-label="그룹"]', b => b.getAttribute('aria-pressed')), 'true', '선택이 있어도 그룹 도구는 놓기 모드');
				assert.equal(await page.$$eval('.react-flow__node-group-frame', ns => ns.length), groups, '도구 클릭만으로 그룹을 만들지 않음');
				assert.equal((await saved()).groups.length, groups, '도구 클릭만으로 저장하지 않음');
				const p = await emptySpot(0.2, 0.8);
				await page.mouse.click(p.x, p.y);
				await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '그룹 이름');
				await page.keyboard.press('Enter');
				await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.groups.length === 1, '화면 클릭 후 그룹 생성');
				const c = await centerOf('.react-flow__node-group-frame');
				assert.ok(Math.abs(c.x - p.x) < 24 && Math.abs(c.y - p.y) < 24, '그룹 가운데는 선택한 테이블이 아니라 클릭한 자리');
				assert.equal(await page.$('.used-tables-flow.placing'), null, '그룹을 놓으면 도구 풀림');
				await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
				await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.groups.length === 0, '검증한 그룹 되돌림');
			}
			// 모두 선택 → 우클릭 그룹으로 묶기 → 이름 입력
			{ const p = await emptySpot(); await page.mouse.click(p.x, p.y); }
			await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
			const programName = await centerOf('.name', 'TB_PROGRAM');
			await page.mouse.click(programName.x, programName.y, { button: 'right' });
			await page.waitForSelector('.context-menu');
			await page.$$eval('.context-menu button', bs => bs.find(b => b.textContent.startsWith('그룹으로 묶기')).click());
			await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '그룹 이름');
			await page.keyboard.type('권한 조회'); await page.keyboard.press('Enter');
			await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.groups[0]?.title === '권한 조회', '그룹 이름');
			// 공백만 넣어도 자리 표시 글자가 보여 다시 더블클릭으로 고칠 수 있다
			for (const text of [' ', '권한 조회']) {
				const t = await centerOf('.group-title .field');
				await page.mouse.click(t.x, t.y, { count: 2 });
				await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '그룹 이름');
				await page.keyboard.type(text); await page.keyboard.press('Enter');
				await page.waitForFunction(text => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.groups[0]?.title === text, { timeout: 3000 }, text);
			}
			const before = await saved();
			const g = before.groups[0];
			assert.ok(before.tables.every(t => t.x > g.x && t.y > g.y && t.x < g.x + g.w && t.y < g.y + g.h), '그룹이 고른 것을 감쌈');
			// 그룹 왼쪽 위 손잡이(제목 밖 여백)를 끌면 안에 든 것도 같이
			const title = await page.$eval('.group-handle', el => { const r = el.getBoundingClientRect(); return { x: r.right - 6, y: r.bottom - 4 }; });
			await page.mouse.move(title.x, title.y); await page.mouse.down();
			await page.mouse.move(title.x + 60, title.y + 40, { steps: 8 }); await page.mouse.up();
			const after = await saved();
			const dx = after.groups[0].x - g.x, dy = after.groups[0].y - g.y;
			assert.ok(dx !== 0 || dy !== 0, '그룹이 움직임');
			assert.deepEqual(after.tables.map(t => [t.x - dx, t.y - dy]), before.tables.map(t => [t.x, t.y]), '안의 테이블도 같은 만큼');
			assert.deepEqual(after.memos.map(m => [m.x - dx, m.y - dy]), before.memos.map(m => [m.x, m.y]), '안의 메모도 같은 만큼');
			// 되돌리기·다시(Ctrl+Z·Y, VS Code로 안 넘김)
			{ const p = await emptySpot(); await page.mouse.click(p.x, p.y); }
			const leaked = await page.evaluate(() => window.leakedUndo);
			await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
			assert.equal((await saved()).groups[0].x, g.x, 'Ctrl+Z로 그룹 자리 되돌림');
			await page.keyboard.down('Control'); await page.keyboard.press('y'); await page.keyboard.up('Control');
			assert.equal((await saved()).groups[0].x, after.groups[0].x, 'Ctrl+Y로 다시');
			assert.equal(await page.evaluate(() => window.leakedUndo), leaked, 'Ctrl+Z·Y가 VS Code로 안 넘어감');
			// 복사·붙여넣기: 같은 테이블을 하나 더(새 id, 이름·컬럼 그대로)
			const auth = await centerOf('.name', 'TB_AUTH');
			await page.mouse.click(auth.x, auth.y);
			await page.keyboard.down('Control'); await page.keyboard.press('c'); await page.keyboard.press('v'); await page.keyboard.up('Control');
			await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.tables.length === 3, '붙여넣기');
			const pasted = (await saved()).tables;
			assert.equal(pasted[2].name, 'TB_AUTH');
			assert.notEqual(pasted[2].id, pasted[1].id);
			assert.deepEqual(pasted[2].columns.map(c => c.name), ['PROGRAM_CD']);
			// 붙여넣기 자리 = 마우스 자리(Excalidraw처럼 묶음 가운데). 잘라내기 → 다른 곳에서 Ctrl+V도
			const boxCenter = id => page.evaluate(id => { const r = document.querySelector(`.react-flow__node[data-id="${id}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
			const nearMouse = (c, m) => Math.abs(c.x - m.x) < 24 && Math.abs(c.y - m.y) < 24;
			{ const c = await boxCenter(pasted[2].id); assert.ok(nearMouse(c, auth), `Ctrl+V는 마우스 자리에: ${JSON.stringify([c, auth])}`); }
			{
				const spot = await emptySpot();
				await page.keyboard.down('Control'); await page.keyboard.press('x'); await page.keyboard.up('Control');
				await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.tables.length === 2, '잘라내기');
				await page.mouse.move(spot.x, spot.y);
				await page.keyboard.down('Control'); await page.keyboard.press('v'); await page.keyboard.up('Control');
				await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.tables.length === 3, '잘라낸 것 붙여넣기');
				const moved = (await saved()).tables[2];
				await page.waitForSelector(`.react-flow__node[data-id="${moved.id}"]`);
				const c = await boxCenter(moved.id);
				assert.ok(nearMouse(c, spot), `잘라낸 것도 마우스 자리에: ${JSON.stringify([c, spot])}`);
			}
			// 고른 것 Delete: 그림에서만 지우고 Design 컴포넌트 삭제 요청은 안 보냄(포커스가 body여도)
			await page.keyboard.press('Delete');
			await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.tables.length === 2, 'Delete로 지우기');
			await page.evaluate(() => document.activeElement?.blur());
			await page.keyboard.press('Delete');
			assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'delete')), false, 'Delete가 디자인 컴포넌트를 안 지움');
			await page.click('.react-flow__controls-fitview');
			await new Promise(r => setTimeout(r, 400));
			await page.screenshot({ path: path.join(tmpdir(), 'ws5-beta-tables.png') });
			// 전체 화면: 그림이 웹뷰 전체를 덮고 Esc로 돌아옴
			await page.click('.used-tables-flow .flow-full');
			assert.ok(await page.evaluate(() => { const r = document.querySelector('.used-tables-flow').getBoundingClientRect(); return r.left === 0 && r.top === 0 && r.width === innerWidth && r.height === innerHeight; }), '전체 화면');
			await page.keyboard.press('Escape');
			await page.waitForFunction(() => !document.querySelector('.used-tables-flow.full'));
			// 다른 탭에 갔다 와도 확대 비율·되돌리기 기록 그대로(ERD를 숨겨 둔 채 유지), 숨은 동안 Delete는 Design 것
			await page.click('.react-flow__controls-zoomin');
			await new Promise(r => setTimeout(r, 400));
			const kept = await zoom(), tablesBefore = (await saved()).tables.length;
			await page.evaluate(() => window.tab('Design').click());
			await page.waitForFunction(() => document.querySelector('.right-panel').getBoundingClientRect().width > 100, { timeout: 3000 });
			await page.evaluate(() => { window.sent.length = 0; document.activeElement?.blur(); });
			await page.keyboard.press('Delete');
			assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'saveUsedTables')), false, '숨은 ERD는 Delete를 안 받음');
			await page.evaluate(() => window.tab('ERD').click());
			await new Promise(r => setTimeout(r, 300));
			assert.equal(await zoom(), kept, '돌아와도 확대 비율 유지');
			await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
			assert.equal((await saved()).tables.length, tablesBefore + 1, '돌아와도 되돌리기 기록 유지(지운 테이블 되살림)');
			// 도형: 빈 곳 우클릭으로 추가(고른 채), 모양 바꾸기·글자, 연결점으로 테이블과 잇기, Delete면 선도 같이. 도구 줄에도 버튼
			{
				assert.ok(await page.$('.flow-toolbar button[aria-label="삼각형"]'), '도구 줄 삼각형');
				const linksBefore = (await saved()).links.length;
				await page.click('.react-flow__controls-fitview');
				await new Promise(r => setTimeout(r, 400));
				const spot = await emptySpot(0.1, 0.2);
				await page.mouse.click(spot.x, spot.y, { button: 'right' });
				await page.evaluate(() => [...document.querySelectorAll('.context-menu [role="menuitem"]')].find(b => b.textContent === '삼각형 추가').click());
				await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.shapes?.length === 1, '도형 추가');
				assert.equal((await saved()).shapes[0].kind, 'triangle');
				// 연결점은 도형 둘레 위(삼각형 오른쪽 점은 빗변 가운데). 고른 도형은 테이블 위로
				await page.waitForSelector('.react-flow__node-shape.selected');
				assert.ok(await page.evaluate(() => {
					const node = document.querySelector('.react-flow__node-shape').getBoundingClientRect(), h = document.querySelector('.react-flow__node-shape .react-flow__handle-right').getBoundingClientRect();
					return Math.abs(h.x + h.width / 2 - (node.x + node.width * .75)) < 2 && Math.abs(h.y + h.height / 2 - (node.y + node.height / 2)) < 2;
				}), '삼각형 빗변 가운데에 연결점');
				assert.ok(await page.$eval('.react-flow__node-shape', n => Number(getComputedStyle(n).zIndex) > Number(getComputedStyle(document.querySelector('.react-flow__node-table')).zIndex)), '고른 도형은 위로');
				// 우클릭 → 모양 바꾸기(다이아몬드·사다리꼴)
				const mid = await page.$eval('.react-flow__node-shape', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
				for (const [label, kind] of [['다이아몬드', 'diamond'], ['사다리꼴', 'trapezoid']]) {
					await page.mouse.click(mid.x, mid.y, { button: 'right' });
					await page.evaluate(l => [...document.querySelectorAll('.context-menu [role^="menuitem"]')].find(b => b.textContent === l).click(), label);
					await page.waitForFunction(k => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.shapes[0]?.kind === k, { timeout: 3000 }, kind).catch(() => assert.fail(`모양 → ${kind}`));
				}
				assert.equal(await page.$$eval('.flow-toolbar .shape-icon', e => e.length), 5, '도구 줄 도형 5개');
				// 더블클릭: 가운데 글자(여러 줄, Ctrl+Enter로 반영)
				await page.mouse.click(mid.x, mid.y, { count: 2 });
				await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '도형 글자');
				await page.keyboard.type('시작');
				await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
				await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.shapes[0]?.text === '시작', '도형 글자');
				const from = await page.evaluate(() => { const r = document.querySelector('.react-flow__node-shape .react-flow__handle-left').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
				const to = await centerOf('.react-flow__handle-top', 'TB_AUTH');
				await page.mouse.move(from.x, from.y); await page.mouse.down();
				await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up();
				await page.waitForFunction(n => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.links.length === n + 1, { timeout: 3000 }, linksBefore).catch(() => assert.fail('도형 → 테이블 선'));
				const shapeId = (await saved()).shapes[0].id;
				assert.ok((await saved()).links.some(l => l.from === shapeId), '도형에서 나간 선');
				await page.evaluate(id => document.querySelector(`.react-flow__node[data-id="${id}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true })), shapeId);
				await page.evaluate(() => document.activeElement?.blur());
				await page.keyboard.press('Delete');
				await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.shapes.length === 0, '도형 지우기');
				assert.equal((await saved()).links.length, linksBefore, '도형을 지우면 그 선도');
			}
			// 숫자 키로 도구 → 클릭한 자리 가운데에, 놓으면 도구 풀림. Esc는 도구만 풀기
			{
				{ const p = await emptySpot(); await page.mouse.click(p.x, p.y); }
				const memos = (await saved()).memos.length;
				await page.keyboard.press('2');
				assert.equal(await page.$eval('.flow-toolbar button[aria-label="메모"]', b => b.getAttribute('aria-pressed')), 'true', '2 = 메모');
				assert.ok(await page.$('.used-tables-flow.placing'), '놓을 자리 고르는 중');
				await page.keyboard.press('Escape');
				assert.equal(await page.$('.used-tables-flow.placing'), null, 'Esc로 도구 풀기');
				await page.keyboard.press('2');
				const p = await emptySpot(0.15, 0.85);
				await page.mouse.click(p.x, p.y);
				await page.waitForFunction(n => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.memos.length === n + 1, { timeout: 3000 }, memos).catch(() => assert.fail('클릭한 자리에 메모'));
				await page.keyboard.press('Escape');
				const memo = (await saved()).memos.at(-1);
				await page.waitForSelector(`.react-flow__node[data-id="${memo.id}"]`);
				const c = await page.$eval(`.react-flow__node[data-id="${memo.id}"]`, e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
				assert.ok(Math.abs(c.x - p.x) < 24 && Math.abs(c.y - p.y) < 24, `메모 가운데 = 클릭한 자리: ${JSON.stringify([c, p])}`);
				assert.equal(await page.$('.used-tables-flow.placing'), null, '놓으면 도구 풀림');
				// 방향키: 고른 것 한 칸(16), Shift는 네 칸
				await page.evaluate(id => document.querySelector(`.react-flow__node[data-id="${id}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true })), memo.id);
				await page.evaluate(() => document.activeElement?.blur());
				await page.keyboard.press('ArrowRight');
				await page.keyboard.down('Shift'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Shift');
				await page.waitForFunction((id, x, y) => { const m = window.sent.findLast(m => m.type === 'saveUsedTables')?.data.memos.find(m => m.id === id); return m?.x === x + 16 && m?.y === y + 64; }, { timeout: 3000 }, memo.id, memo.x, memo.y)
					.catch(async () => assert.fail(`방향키 이동: ${JSON.stringify([memo, (await saved()).memos.at(-1)])}`));
				// 끌면 다른 박스와 줄 맞춤(왼쪽 끝을 TB_PROGRAM 왼쪽에서 조금 비켜 놓아도 딱 맞음) + 끄는 동안 안내선
				const target = (await saved()).tables.find(t => t.name === 'TB_PROGRAM');
				const box = await page.$eval(`.react-flow__node[data-id="${memo.id}"]`, e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y }; });
				const goal = await page.$eval(`.react-flow__node[data-id="${target.id}"]`, e => e.getBoundingClientRect().x);
				const zoomNow = await zoom();
				await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.down();
				await page.mouse.move(box.x + 30 + (goal - box.x) / 2, box.y + 60, { steps: 5 });
				await page.mouse.move(goal + 3 + 30, box.y + 90, { steps: 5 });
				assert.ok(await page.$('.align-guide'), '끄는 동안 안내선');
				await page.mouse.up();
				await page.waitForFunction((id, x) => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.memos.find(m => m.id === id)?.x === x, { timeout: 3000 }, memo.id, target.x)
					.catch(async () => assert.fail(`줄 맞춤: ${JSON.stringify([target.x, (await saved()).memos.at(-1).x, zoomNow])}`));
				assert.equal(await page.$('.align-guide'), null, '놓으면 안내선 없음');
				// 이미지로 저장: 고른 표시 없이 PNG를 확장에 보냄
				await page.evaluate(() => { window.sent.length = 0; });
				await page.click('.used-tables-flow button[aria-label="이미지로 저장"]');
				await page.waitForFunction(() => window.sent.some(m => m.type === 'saveTablesImage' || m.type === 'warn'), { timeout: 10000 }).catch(() => assert.fail('이미지 요청'));
				const image = await page.evaluate(() => { const m = window.sent.find(m => m.type === 'saveTablesImage' || m.type === 'warn'); return m.type === 'warn' ? m.message : m.dataUrl; });
				assert.ok(image.startsWith('data:image/png;base64,') && image.length > 5000, `PNG: ${image.slice(0, 200)}`);
				await fs.writeFile(path.join(tmpdir(), 'ws5-erd-export.png'), Buffer.from(image.split(',')[1], 'base64'));
			}
			// 색: 테이블 우클릭 → 주황(머리 띠), 기본 색으로 되돌리기. 여러 개 고르면 한 번에
			{
				const pickColor = async (label, at) => {
					await page.mouse.click(at.x, at.y, { button: 'right' });
					// 메뉴는 우클릭 뒤 다음 그리기에 뜬다: 뜰 때까지 기다린다
					await page.waitForFunction(l => [...document.querySelectorAll('.context-menu [role^="menuitem"]')].some(b => b.textContent === l), { timeout: 3000 }, label)
						.catch(async () => assert.fail(`우클릭 메뉴에 ${label} 없음, 누른 곳 ${JSON.stringify(at)}: ${await page.evaluate(p => document.elementsFromPoint(p.x, p.y).slice(0, 4).map(e => e.tagName + '.' + e.className).join(' | '), at)} menu=${await page.evaluate(() => document.querySelector('.context-menu')?.textContent)}`));
					await page.evaluate(l => [...document.querySelectorAll('.context-menu [role^="menuitem"]')].find(b => b.textContent === l).click(), label);
				};
				// 테이블 머리 중 다른 것(왼쪽 위 도구 줄 등)에 안 가린 점: 그림 배치에 따라 도구 줄 밑에 깔릴 수 있다
				const head = await page.evaluate(() => {
					const node = [...document.querySelectorAll('.react-flow__node-table')].find(n => n.querySelector('.name')?.textContent === 'TB_PROGRAM'), r = node.querySelector('.head').getBoundingClientRect();
					for (let fx = 0.9; fx > 0; fx -= 0.1) { for (let fy = 0.8; fy > 0.1; fy -= 0.2) { const x = r.x + r.width * fx, y = r.y + r.height * fy; if (node.contains(document.elementFromPoint(x, y))) { return { x, y }; } } }
					return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
				});
				await pickColor('주황', head);
				await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.tables.find(t => t.name === 'TB_PROGRAM')?.color === 'orange', '테이블 색');
				await page.waitForSelector('.used-table-node.colored.note-orange', { timeout: 3000 }).catch(() => assert.fail('테이블 머리 띠'));
				await pickColor('기본 색', head);
				await until(() => window.sent.findLast(m => m.type === 'saveUsedTables')?.data.tables.find(t => t.name === 'TB_PROGRAM')?.color === '', '테이블 기본 색');
				await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
				await new Promise(r => setTimeout(r, 200));
				// 여러 개 고른 채 하나를 우클릭하면 고른 것 모두에
				await pickColor('청록', head);
				await until(() => { const d = window.sent.findLast(m => m.type === 'saveUsedTables')?.data; return d && [...d.tables, ...d.memos, ...d.groups].every(x => x.color === 'cyan'); }, '고른 것 모두 청록');
			}
			// ERD에 들어가면 우측 패널이 접히고, 나오면 다시 펼침
			assert.ok(await page.$eval('.right-panel', p => p.getBoundingClientRect().width < 2), 'ERD에서 우측 패널 접힘');
			await page.evaluate(() => window.tab('Design').click());
			await page.waitForFunction(() => document.querySelector('.right-panel').getBoundingClientRect().width > 100, { timeout: 3000 }).catch(() => assert.fail('ERD에서 나오면 우측 패널 다시 펼침'));
			console.log('ERD: 사용 테이블 저장 위치·그림 안 테이블·컬럼(설명)·Enter·확대 유지·선(화살표·글자)·메모·그룹·되돌리기·복붙·Delete·전체 화면 passed');
		}
}
