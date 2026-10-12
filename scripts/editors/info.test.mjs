import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';

export default async function ({ page }) {
		// Info 탭: head meta_* 속성 + 개정 이력. 칸에서 나오면 반영(setAttr·editHistory)
		await page.evaluate(() => {
			const text = '<html xmlns:w2="http://www.inswave.com/websquare"><head meta_programId="BM003M01" meta_programName="프로그램 관리" meta_memo="zzz"><w2:historyInfo><w2:history meta_no="1" meta_desc="asd" meta_date="20250101" meta_user="zz"></w2:history></w2:historyInfo></head><body/></html>';
			window.sent.length = 0;
			window.send({ type: 'document', version: 93, text, root: window.parseXml(text), script: { text: '' } });
			window.tab('Info').click();
		});
		await page.waitForSelector('.info-pane input[aria-label="프로그램명"]');
		assert.deepEqual(await page.$$eval('.info-pane .info-field :is(input, textarea)', els => els.map(e => e.value)), ['BM003M01', '프로그램 관리', '', '', '', 'zzz']);
		assert.deepEqual(await page.$$eval('.info-pane tbody :is(input, textarea)', els => els.map(e => [e.tagName, e.value, getComputedStyle(e).textAlign])),
			[['INPUT', '1', 'center'], ['TEXTAREA', 'asd', 'start'], ['INPUT', '2025-01-01', 'center'], ['INPUT', 'zz', 'start']], '개정번호·일자 가운데, 내용은 여러 줄');
		// 일자: 달력에서 고르기·키보드(→ Enter)·잘못된 날짜는 되돌림
		const lastDates = () => page.evaluate(() => window.sent.findLast(m => m.type === 'editHistory')?.rows.map(r => r.date));
		await page.click('.info-pane input[aria-label="1행 제/개정 일자"]');
		await page.waitForSelector('.date-picker');
		assert.equal(await page.$eval('.date-picker-title', e => e.textContent), '2025년 1월', '달력은 지금 값의 달'); await page.screenshot({path:path.join(tmpdir(), 'ws5-info-date.png')});
		await page.click('.date-picker-day[aria-label="20250115"]');
		assert.deepEqual(await lastDates(), ['2025-01-15'], '달력에서 고른 날 반영');
		assert.equal(await page.$('.date-picker'), null, '고르면 닫힘');
		await page.keyboard.down('Alt'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Alt');
		await page.waitForSelector('.date-picker');
		await page.keyboard.press('ArrowRight'); await page.keyboard.press('PageDown'); await page.keyboard.press('Enter');
		assert.deepEqual(await lastDates(), ['2025-02-16'], '키보드: 하루 뒤·다음 달·Enter');
		const sentCount = () => page.evaluate(() => window.sent.filter(m => m.type === 'editHistory').length);
		const historySends = await sentCount();
		await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.type('2025-13x45');
		assert.equal(await page.$eval('.info-pane input[aria-label="1행 제/개정 일자"]', e => e.value), '2025-13-45', '숫자만 치고 하이픈은 자동');
		await page.keyboard.press('Escape'); await page.keyboard.press('Tab');
		assert.deepEqual([await sentCount(), await page.$eval('.info-pane input[aria-label="1행 제/개정 일자"]', e => e.value)], [historySends, '2025-02-16'], '잘못된 날짜는 원래 값으로');
		await page.click('.info-pane input[aria-label="작성자"]'); await page.keyboard.type('홍길동'); await page.keyboard.press('Enter');
		assert.deepEqual(await page.evaluate(() => { const m = window.sent.findLast(m => m.type === 'setAttr'); return [m?.name, m?.value, m?.index]; }), ['meta_author', '홍길동', 1], 'Enter로 head 속성 반영');
		// 작성일: 달력, yyyy-MM-dd로 저장(숫자만 치거나 다른 구분자로 쳐도 맞춤)
		const lastAttr = () => page.evaluate(() => { const m = window.sent.findLast(m => m.type === 'setAttr'); return [m?.name, m?.value]; });
		await page.click('.info-pane input[aria-label="작성일"]');
		await page.waitForSelector('.date-picker');
		await page.$$eval('.date-picker-foot button', bs => bs[0].click());
		const now = new Date(), pad = n => String(n).padStart(2, '0');
		assert.deepEqual(await lastAttr(), ['meta_date', `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`], '작성일 오늘');
		// 달력이 열린 채 숫자만 쳐도 하이픈이 붙고, Enter는 친 날짜로(달력이 가리키던 날로 덮지 않음)
		await page.click('.info-pane input[aria-label="작성일"]');
		await page.waitForSelector('.date-picker');
		await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.type('20201212');
		assert.equal(await page.$eval('.info-pane input[aria-label="작성일"]', e => e.value), '2020-12-12', '숫자만 쳐도 yyyy-MM-dd');
		assert.equal(await page.$eval('.date-picker-title', e => e.textContent), '2020년 12월', '달력도 친 날짜로');
		await page.keyboard.press('Enter');
		assert.deepEqual(await lastAttr(), ['meta_date', '2020-12-12'], '친 날짜 반영');
		await page.click('.info-pane input[aria-label="작성일"]');
		await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.type('2024.03.05'); await page.keyboard.press('Tab');
		assert.deepEqual(await lastAttr(), ['meta_date', '2024-03-05'], '다른 구분자로 쳐도 yyyy-MM-dd');
		await page.$$eval('.info-pane button', bs => bs.find(b => b.getAttribute('aria-label') === '이력 추가').click());
		const added = await page.evaluate(() => window.sent.findLast(m => m.type === 'editHistory'));
		assert.equal(added?.index, 1);
		assert.deepEqual(added.rows.map(r => [r.no, r.desc]), [['1', 'asd'], ['2', '']], '추가 행은 다음 개정번호');
		assert.match(added.rows[1].date, /^\d{4}-\d{2}-\d{2}$/, '추가 행 일자는 오늘(yyyy-MM-dd)');
		await page.click('.info-pane textarea[aria-label="2행 제/개정 페이지 및 수정 내용"]'); await page.keyboard.type('수정'); await page.keyboard.press('Enter'); await page.keyboard.type('둘째 줄');
		assert.equal(await page.$eval('.info-pane textarea[aria-label="2행 제/개정 페이지 및 수정 내용"]', e => e.rows), 2, 'Enter는 줄바꿈, 줄 수만큼 높이');
		assert.ok(await page.evaluate(() => { const cell = l => document.querySelector(`.info-pane [aria-label="${l}"]`).getBoundingClientRect(), mid = r => r.top + r.height / 2;
			const row = document.querySelector('.info-pane [aria-label="2행 개정번호"]').closest('tr').getBoundingClientRect();
			return ['2행 개정번호', '2행 제/개정 일자', '2행 제/개정자'].every(l => Math.abs(mid(cell(l)) - mid(row)) < 2); }), '내용이 여러 줄이어도 다른 칸은 세로 가운데');
		await page.keyboard.press('Tab');
		assert.equal(await page.evaluate(() => window.sent.findLast(m => m.type === 'editHistory').rows[1].desc), '수정\n둘째 줄', '칸에서 나오면 반영');
		// 손잡이(Codicon gripper)로 2행을 1행 위로 끌면 바로 반영
		const historyHandle = await page.$eval('.info-pane button[aria-label="2행 이동"]', b => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
		const firstRowTop = await page.$eval('.info-pane tbody tr', tr => tr.getBoundingClientRect().top);
		await page.mouse.move(historyHandle.x, historyHandle.y); await page.mouse.down();
		await page.mouse.move(historyHandle.x, firstRowTop + 3, { steps: 8 }); await page.mouse.up();
		assert.deepEqual(await page.evaluate(() => window.sent.findLast(m => m.type === 'editHistory').rows.map(r => r.no)), ['2', '1'], '끌어 순서 바꾸기');
		assert.equal(await page.$eval('.info-pane textarea[aria-label="1행 제/개정 페이지 및 수정 내용"]', e => e.value), '수정\n둘째 줄', '옮긴 행 내용이 따라감');
		await page.click('.info-pane input[aria-label="2행 개정번호"]');
		await page.$$eval('.info-pane button', bs => bs.find(b => b.getAttribute('aria-label') === '이력 삭제').click());
		assert.deepEqual(await page.evaluate(() => window.sent.findLast(m => m.type === 'editHistory').rows.map(r => r.no)), ['2'], '고른 행 삭제');
		// ID·이름 속성 이름은 화면이 쓰는 쪽(meta_screen*·meta_program*), 둘 다 없으면 meta_screen*. 설명은 있는 이름, 없으면 meta_programDesc
		const infoDoc = head => page.evaluate(head => {
			const text = `<html xmlns:w2="http://www.inswave.com/websquare"><head ${head}></head><body/></html>`;
			window.send({ type: 'document', version: 93, text, root: window.parseXml(text), script: { text: '' } });
		}, head);
		const infoValues = () => page.$$eval('.info-pane .info-field :is(input, textarea)', els => els.map(e => e.value));
		await infoDoc('meta_screenId="SC001" meta_screenName="화면 관리"');
		await page.waitForFunction(() => document.querySelector('.info-pane input[aria-label="프로그램 ID"]')?.value === 'SC001');
		// 작성자·작성일은 위에서 친 값이 남아 있다(이 테스트는 setAttr 뒤 문서를 다시 보내지 않음) → ID·이름·설명만 본다
		assert.deepEqual(await infoValues().then(v => [v[0], v[1], v[4]]), ['SC001', '화면 관리', ''], 'meta_screen* 읽기');
		await page.click('.info-pane textarea[aria-label="프로그램 설명"]'); await page.keyboard.type('설명'); await page.keyboard.press('Tab');
		assert.deepEqual(await lastAttr(), ['meta_programDesc', '설명'], '설명은 meta_programDesc(meta_screenDesc는 새로 만들지 않음)');
		await infoDoc('');
		await page.waitForFunction(() => document.querySelector('.info-pane input[aria-label="프로그램 ID"]')?.value === '');
		await page.click('.info-pane input[aria-label="프로그램 ID"]'); await page.keyboard.type('NEW01'); await page.keyboard.press('Enter');
		assert.deepEqual(await lastAttr(), ['meta_screenId', 'NEW01'], '새 화면은 meta_screenId');
		await page.evaluate(() => window.tab('Design').click());
		console.log('Info: 화면 정보·개정 이력 passed');
}
