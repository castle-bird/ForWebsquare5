import assert from 'node:assert/strict';

export default async function ({ clickTab, reset, page, lastSent }) {
	// Git 변경 표시: 확장이 보낸 기준(스테이지 내용)과 비교. 줄 번호 옆 막대(줄마다)와 오른쪽 끝 띠(범위마다)
	await clickTab('Script');
	// hover 설명: Script는 WebSquare API·컴포넌트 메서드, Source는 속성 설명. 설명이 없는 자리에는 안 뜬다
	const hoverText = async (text, needle) => {
		await reset(text);
		const at = await page.evaluate((text, needle) => { const c = window.editor().coordsAtPos(text.indexOf(needle) + 1); return { x: c.left + 1, y: (c.top + c.bottom) / 2 }; }, text, needle);
		await page.mouse.move(0, 0);
		await page.mouse.move(at.x, at.y);
		const shown = await page.waitForFunction(() => document.querySelector('.cm-tooltip .ws-hover')?.textContent, { timeout: 2500 }).then(h => h.jsonValue()).catch(() => undefined);
		await page.mouse.move(0, 0);
		await page.waitForFunction(() => !document.querySelector('.cm-tooltip .ws-hover'), { timeout: 3000 }).catch(async () => assert.fail(`hover가 안 닫힘: ${shown} / ${JSON.stringify(await page.evaluate(() => { const r = document.querySelector('.cm-tooltip').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }))}`));
		return shown;
	};
	await clickTab('Script');
	assert.match(await hoverText('$p.getComponentById("a");', 'getComponentById'), /getComponentById\(id\).*컴포넌트 조회/s, 'Script hover: API 설명');
	assert.match(await hoverText('ipt_name.setValue(1);', 'setValue'), /값 설정/, 'Script hover: 컴포넌트 종류의 메서드');
	assert.equal(await hoverText('console.log(1);', 'log'), undefined, 'Script hover: 설명 없는 멤버는 안 뜸');
	assert.match(await hoverText('scwin.f2 = function() { scwin.f1(); };\n/**\n * 조회 실행\n * @param id 아이디\n */\nscwin.f1 = function(id) {};', 'f1()'), /조회 실행.*Parameters:.*id/s, 'Script hover: 같은 Script 함수의 JSDoc');
	assert.match(await hoverText('var a = 1; go();\n/** 이동 */\nfunction go() {}', 'go()'), /이동/, 'Script hover: function 선언의 JSDoc');
	// JSDoc 안 HTML: <br/>은 줄바꿈, 다른 태그는 지움(예제 코드는 그대로). 중괄호 없는 `@return String 설명`은 타입으로
	await reset('var b = 1; now();\n/**\n * 서버 <b>날짜</b> 반환\n * @param {String:N} fmt 날짜 포맷<br/> y Year<br/>\n * @return String 현재날짜\n * @example\n * now("<br/>");\n */\nfunction now(fmt) {}');
	const docAt = await page.evaluate(() => { const v = window.editor(), c = v.coordsAtPos(v.state.doc.toString().indexOf('now()') + 1); return { x: c.left + 1, y: (c.top + c.bottom) / 2 }; });
	await page.mouse.move(0, 0); await page.mouse.move(docAt.x, docAt.y);
	await page.waitForSelector('.cm-tooltip .ws-hover .ws-doc-param-item', {timeout: 3000}).catch(() => assert.fail('JSDoc HTML hover'));
	assert.deepEqual(await page.evaluate(() => { const h = document.querySelector('.cm-tooltip .ws-hover'); return {
		desc: h.querySelector('.ws-doc-desc').textContent, rows: [...h.querySelectorAll('.ws-doc-param-item')].map(r => r.textContent), sample: h.querySelector('.ws-doc-sample').textContent }; }),
		{ desc: '서버 날짜 반환', rows: ['fmt String:N — 날짜 포맷\ny Year', 'String — 현재날짜'], sample: 'now("<br/>");' }, 'JSDoc HTML·return 타입');
	await page.mouse.move(0, 0);
	await page.waitForFunction(() => !document.querySelector('.cm-tooltip .ws-hover'), { timeout: 3000 });
	// Script 정의로 이동: 같은 Script면 그 이름 선택, 공통 JS면 확장에 그 파일·범위로 열기 요청, 없으면(API 등) 알림. 커서 추가는 Alt+클릭
	const scriptAt = async (text, needle) => page.evaluate((text, needle) => { const v = window.editor(), c = v.coordsAtPos(text.indexOf(needle) + 1); return { x: c.left + 1, y: (c.top + c.bottom) / 2 }; }, text, needle);
	const ctrlClickAt = async at => { await page.keyboard.down('Control'); await page.mouse.click(at.x, at.y); await page.keyboard.up('Control'); };
	const scriptSel = () => page.evaluate(() => { const v = window.editor(), m = v.state.selection.main; return { text: v.state.sliceDoc(m.from, m.to), from: m.from, ranges: v.state.selection.ranges.length }; });
	const defText = 'scwin.f2 = function() { scwin.f1(); go(); };\nscwin.f1 = function(id) {};\nfunction go() {}';
	await reset(defText);
	await ctrlClickAt(await scriptAt(defText, 'f1();'));
	assert.deepEqual(await scriptSel(), { text: 'f1', from: defText.indexOf('f1 = function'), ranges: 1 }, 'Script: Ctrl+클릭 → 같은 Script 정의 이름 선택');
	await ctrlClickAt(await scriptAt(defText, 'go();'));
	assert.deepEqual(await scriptSel(), { text: 'go', from: defText.lastIndexOf('go'), ranges: 1 }, 'Script: function 선언으로');
	// 마우스 뒤로·앞으로: 정의로 이동 한 번 = 한 칸(같은 탭 안에서 누른 자리로, 이전 탭으로 건너뛰지 않음)
	const mouseNav = button => page.evaluate(button => {
		const at = { button, bubbles: true, cancelable: true, clientX: 200, clientY: 200 }, target = document.elementFromPoint(200, 200);
		target.dispatchEvent(new MouseEvent('mousedown', at)); target.dispatchEvent(new MouseEvent('mouseup', at));
	}, button);
	const navAt = async () => { await new Promise(r => setTimeout(r, 100)); return page.evaluate(() => ({ tab: document.querySelector('.canvas-frame .tab-bar [role="tab"][aria-selected="true"]')?.textContent, from: window.editor().state.selection.main.from })); };
	const near = (pos, needle) => pos >= defText.indexOf(needle) && pos <= defText.indexOf(needle) + 2;
	await mouseNav(3);
	let nav = await navAt();
	assert.ok(nav.tab === 'Script' && near(nav.from, 'go();'), `뒤로 → go() 누른 자리: ${JSON.stringify(nav)}`);
	await mouseNav(3);
	nav = await navAt();
	assert.ok(nav.tab === 'Script' && near(nav.from, 'f1();'), `뒤로 → f1() 누른 자리: ${JSON.stringify(nav)}`);
	await mouseNav(4);
	nav = await navAt();
	assert.ok(nav.tab === 'Script' && near(nav.from, 'go();'), `앞으로 → go() 누른 자리: ${JSON.stringify(nav)}`);
	await mouseNav(4);
	assert.deepEqual(await scriptSel(), { text: 'go', from: defText.lastIndexOf('go'), ranges: 1 }, '앞으로 → go 정의');
	const moduleText = 'app.util.format(1);';
	await reset(moduleText); await page.evaluate(() => { window.sent.length = 0; });
	await page.evaluate(pos => { const v = window.editor(); v.dispatch({ selection: { anchor: pos } }); v.focus(); }, moduleText.indexOf('format') + 2);
	await page.keyboard.press('F12');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'openModule'), {timeout: 3000}).catch(() => assert.fail('Script: F12 → 공통 JS 열기 요청'));
	assert.deepEqual(await lastSent('openModule'), { type: 'openModule', path: '/js/common.js', line: 7, ch: 9, endLine: 7, endCh: 15 }, '공통 JS 파일·이름 범위');
	const apiText = '$p.getComponentById("a");';
	await reset(apiText); await page.evaluate(() => { window.sent.length = 0; });
	await ctrlClickAt(await scriptAt(apiText, 'getComponentById'));
	await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('정의를 찾지 못했습니다'), {timeout: 3000}).catch(() => assert.fail('Script: 정의 없으면 알림'));
	assert.ok(!(await page.evaluate(() => window.sent.some(m => m.type === 'openModule' || m.type === 'definition'))), 'API는 요청 없음');
	await reset(defText);
	const altAt = await scriptAt(defText, 'go() {}');
	await page.keyboard.down('Alt'); await page.mouse.click(altAt.x, altAt.y); await page.keyboard.up('Alt');
	assert.equal((await scriptSel()).ranges, 2, 'Script: Alt+클릭은 커서 추가');
	console.log('Script: 정의로 이동(같은 Script·공통 JS·없음 알림·Alt+클릭) passed');
	// Script 파라미터 힌트: API(파라미터 표가 없으면 signature 글자), 같은 Script 함수(실제 파라미터 + JSDoc 타입·설명), 쉼표로 다음 파라미터, 모르는 함수는 안 뜸
	const scriptSig = () => page.evaluate(() => { const t = document.querySelector('.cm-tooltip.ws-signature'); return t && { label: t.querySelector('.ws-sig-label').textContent, active: t.querySelector('.ws-sig-active')?.textContent, text: t.textContent }; });
	await reset(''); await page.keyboard.type('$p.getComponentById(');
	await page.waitForFunction(() => document.querySelector('.cm-tooltip.ws-signature'), {timeout: 3000}).catch(() => assert.fail('Script: API 파라미터 힌트'));
	assert.deepEqual(await scriptSig(), { label: 'getComponentById(id)', active: 'id', text: 'getComponentById(id)컴포넌트 조회' }, 'Script: API 파라미터 힌트');
	await page.keyboard.press('Escape');
	const sigText = '/**\n * 조회 실행\n * @param {String} id 아이디\n * @param opt 옵션\n */\nscwin.f1 = function(id, opt = {}) {};\n';
	await reset(sigText); await page.keyboard.type('scwin.f1(1, ');
	await page.waitForFunction(() => document.querySelector('.ws-sig-active')?.textContent === 'opt = {}', {timeout: 3000}).catch(async () => assert.fail(`Script: 같은 Script 함수 두 번째 파라미터: ${JSON.stringify(await scriptSig())}`));
	assert.deepEqual(await scriptSig(), { label: 'f1(id: String, opt = {})', active: 'opt = {}', text: 'f1(id: String, opt = {})옵션조회 실행' }, 'Script: JSDoc 타입·설명');
	await page.keyboard.press('Escape');
	await reset(''); await page.keyboard.type('unknownFn(');
	await new Promise(r => setTimeout(r, 300));
	assert.equal(await page.$('.cm-tooltip.ws-signature'), null, 'Script: 모르는 함수는 힌트 없음');
	console.log('Script: 파라미터 힌트(API·같은 Script 함수·JSDoc·쉼표·모르는 함수) passed');
	await clickTab('Source');
	assert.match(await hoverText('<w2:input label="x"/>', 'label'), /label.*화면에 보이는 글자/s, 'Source hover: 속성 설명');
	assert.equal(await hoverText('<w2:input disabled="true"/>', 'disabled'), undefined, 'Source hover: 설명 없는 속성은 안 뜸');
	console.log('Hover: Script API·컴포넌트 메서드, Source 속성 설명 passed');
	await clickTab('Script');
}
