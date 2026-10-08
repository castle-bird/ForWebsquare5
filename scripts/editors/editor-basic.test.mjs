import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';

export default async function ({ page, reset, modifiedKey, content, checkIndentUnit }) {
	for (const tab of ['Script', 'Source']) {
		await page.evaluate(tab => window.tab(tab).click(), tab);
		await page.waitForSelector('.tab-body:not([hidden]) .cm-content');
		// 숨은 탭은 레이아웃에서 빠져야 한다 (포맷 단축키는 보이는 편집기만 처리)
		assert.ok(await page.evaluate(() => [...document.querySelectorAll('.tab-body[hidden]')].every(e => !e.getClientRects().length)));
		await reset('set(value);\nset(value);\nset(value);');
		const point = await page.evaluate(() => { const p = window.editor().coordsAtPos(1); return {x:p.left + 2, y:(p.top+p.bottom)/2}; });
		await page.mouse.click(point.x, point.y, {count:2});
		await page.waitForFunction(() => window.editor().state.sliceDoc(window.editor().state.selection.main.from, window.editor().state.selection.main.to) === 'set');
		await page.waitForSelector('.tab-body:not([hidden]) .cm-selectionBackground');
		const alpha = await page.$eval('.tab-body:not([hidden]) .cm-activeLine', e => getComputedStyle(e).backgroundColor);
		assert.equal(alpha, 'rgba(0, 0, 0, 0)', `선택 중엔 현재 줄 배경을 걷어야(선택을 가림): ${alpha}`);
		await page.screenshot({path:path.join(tmpdir(), `ws5-${tab}-selection.png`)});
		const end = await page.evaluate(() => { const p = window.editor().coordsAtPos(27); return {x:p.left, y:(p.top+p.bottom)/2}; });
		await page.mouse.click(point.x, point.y);
		await page.mouse.move(point.x, point.y); await page.mouse.down();
		await page.mouse.move(end.x, end.y, {steps:10}); await page.mouse.up();
		assert.ok(await page.evaluate(() => window.editor().state.selection.main.to - window.editor().state.selection.main.from > 20));
		await page.screenshot({path:path.join(tmpdir(), `ws5-${tab}-multiline.png`)});
		// 확장 응답 전에 이어 친 입력은 모아서 보내므로 빠르게 쳐도 버전 충돌이 없어야 한다.
		await reset(''); await page.keyboard.type('abcdefghijklmnop', {delay:0});
		await new Promise(resolve => setTimeout(resolve, 100));
		assert.equal(await page.$('.tab-body:not([hidden]) .code-banner button'), null, `${tab}: 빠른 입력 중 충돌`);
		// 포맷 단축키(formatKey): 확장이 돌려준 포맷 결과가 일반 편집으로 들어가고 Ctrl+Z로 되돌려진다
		await reset('messy ( )');
		await page.evaluate(() => window.send({type:'formatKey'}));
		await page.waitForFunction(() => window.editor().state.doc.toString() === 'formatted();');
		await modifiedKey('Control', 'z');
		assert.equal(await content(), 'messy ( )', `${tab}: 포맷 되돌리기`);
		// 다시 하기: Ctrl+Y와 Ctrl+Shift+Z 둘 다(VS Code처럼)
		await modifiedKey('Control', 'y');
		assert.equal(await content(), 'formatted();', `${tab}: Ctrl+Y 다시 하기`);
		await modifiedKey('Control', 'z');
		// 실제 브라우저처럼 Shift면 key 'Z'(puppeteer는 'z'로 보낸다)
		await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('Z'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
		assert.equal(await content(), 'formatted();', `${tab}: Ctrl+Shift+Z 다시 하기`);
		await modifiedKey('Control', 'z');
		// 포맷해도 커서는 같은 글자 자리에 남는다(바뀐 범위 전체를 한 번에 바꾸면 그 시작으로 튄다)
		const messy = 'f(){\nvar a=1;\nvar target=2;\nvar b=3;\n}', tidy = 'f() {\n    var a = 1;\n    var target = 2;\n    var b = 3;\n}';
		await reset(messy);
		await page.evaluate(at => window.editor().dispatch({ selection: { anchor: at } }), messy.indexOf('target') + 3);
		await page.evaluate(text => { window.formatResult = text; window.send({type:'formatKey'}); }, tidy);
		await page.waitForFunction(text => window.editor().state.doc.toString() === text, {}, tidy);
		await page.evaluate(() => { delete window.formatResult; });
		assert.equal(await page.evaluate(() => window.editor().state.selection.main.head), tidy.indexOf('target') + 3, `${tab}: 포맷 뒤 커서 자리`);
		// VS Code는 웹뷰 window까지 올라온 키를 받아 문서도 되돌린다 → 편집기 밖으로 새면 안 된다
		assert.equal(await page.evaluate(() => window.leakedUndo), 0, `${tab}: Ctrl+Z가 VS Code로 전달됨`);
		await reset('');
		await page.keyboard.press('Tab');
		assert.match(await content(), /^ +$/, `${tab}: Tab 들여쓰기`);
		await modifiedKey('Shift', 'Tab');
		assert.equal(await content(), '');
		await reset('one\ntwo');
		await modifiedKey('Control', 'a'); await page.keyboard.press('Tab');
		assert.match(await content(), /^ +one\n +two$/);
		await modifiedKey('Shift', 'Tab'); assert.equal(await content(), 'one\ntwo');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Escape'); await page.keyboard.press('Tab');
		assert.equal(await page.evaluate(() => window.editor().hasFocus), false, 'Esc → Tab 포커스 탈출');
		await reset('');
		await page.keyboard.type(tab === 'Script' ? 'conso' : '<w2:in', {delay:50});
		await page.waitForFunction(text => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === text), {}, tab === 'Script' ? 'console' : 'w2:input');
		const fonts = await page.evaluate(() => {
			const style = e => [getComputedStyle(e).fontFamily, getComputedStyle(e).fontSize];
			return [style(window.editor().scrollDOM), style(document.querySelector('.cm-completionLabel'))];
		});
		assert.deepEqual(fonts[0], fonts[1], '자동완성 글꼴은 편집기와 같아야 합니다.');
		// CodeMirror의 기본 75ms 오입력 방지 시간을 지난 뒤 확정한다.
		await new Promise(resolve => setTimeout(resolve, 100));
		await page.keyboard.press('Tab');
		assert.ok((await content()).includes(tab === 'Script' ? 'console' : 'w2:input'), await content());
		assert.equal(await page.evaluate(() => window.editor().hasFocus), true);
		if (tab === 'Script') {
			// 엔진 공통 JS(modules)의 대입문 멤버, CodeMirror 기본 목록에 없던 키워드(await)
			for (const [typed, expected] of [['cons','console'], ['console.','log'], ['$p.','getComponentById'], ['ipt_name.','setValue'], ['scwin.run = function() {};\nscwin.','run'],
				['app.','util'], ['lib.','VERSION'], ['aw','await'], ['app.util.','format']]) {
				await reset(''); await page.keyboard.type(typed, {delay:25});
				await page.waitForFunction(expected => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === expected), {}, expected);
			}
			// 공통 JS 함수: 파라미터는 detail, JSDoc은 설명 팝업
			await page.waitForFunction(() => document.querySelector('.cm-completionDetail')?.textContent === '(value, pattern)' && document.querySelector('.cm-completionInfo')?.textContent.includes('값 형식 변환'));
			// JSDoc 태그는 원문 그대로가 아니라 Parameters 묶음으로
			assert.deepEqual(await page.evaluate(() => { const i = document.querySelector('.cm-completionInfo'); return { section: i.querySelector('.ws-doc-section')?.textContent, badge: i.querySelector('.ws-doc-badge')?.textContent, raw: i.textContent.includes('@param') }; }),
				{ section: 'Parameters:', badge: 'value', raw: false });
			// await는 return과 같은 제어 키워드 색 (기본 글자색이면 구분이 안 된다)
			await reset('async function f() { await g(); return 1; }');
			const colors = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.tab-body:not([hidden]) .cm-line span')].map(e => [e.textContent, getComputedStyle(e).color])));
			assert.equal(colors.await, colors.return, JSON.stringify(colors));
		} else {
			await reset('<w2:input '); await page.keyboard.type('lab', {delay:50});
			await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'label'));
		}
		// 문법 오류 밑줄(입력을 멈추고 잠시 뒤 검사). Source는 XML 형식 오류와 인라인 script CDATA의 JS 오류
		const lintCases = tab === 'Script'
			? [['var a = ;', 8, /Unexpected token/], ['var a = 1;']]
			: [['<a><b></a>', undefined, /close tag/i], ['<a><script><![CDATA[var x = ;]]></script></a>', 28, /Unexpected token/], ['<a/>']];
		for (const [text, at, message] of lintCases) {
			await reset(text);
			if (message) {
				await page.waitForFunction(() => window.diagnostics().length && document.querySelector('.tab-body:not([hidden]) .cm-lintRange-error'), {timeout: 3000})
					.catch(() => assert.fail(`${tab}: ${text} 밑줄 없음`));
				const [d] = await page.evaluate(() => window.diagnostics());
				assert.match(d.message, message, `${tab}: ${text}`);
				if (at !== undefined) { assert.equal(d.from, at, `${tab}: ${text} 위치`); }
				assert.ok(await page.$('.tab-body:not([hidden]) .cm-lint-marker-error'), `${tab}: 줄 번호 옆 오류 표시`);
			} else {
				await new Promise(resolve => setTimeout(resolve, 900));
				assert.deepEqual(await page.evaluate(() => window.diagnostics()), [], `${tab}: ${text}는 오류 아님`);
			}
		}
		// 들여쓰기 가이드: 들여쓴 줄에 선(클래스로 등록한 --indent-markers)이 그려진다
		await reset(tab === 'Script' ? 'if (a) {\n    b();\n}' : '<a>\n    <b/>\n</a>');
		await page.waitForFunction(() => {
			const line = document.querySelectorAll('.tab-body:not([hidden]) .cm-line')[1];
			return line?.classList.contains('cm-indent-markers') && getComputedStyle(line).getPropertyValue('--indent-markers').includes('linear-gradient')
				&& getComputedStyle(line, '::before').backgroundImage.includes('gradient');
		}, {timeout: 3000}).catch(() => assert.fail(`${tab}: 들여쓰기 가이드 없음`));
		await checkIndentUnit(tab);
		console.log(`${tab}: lint, indent guides passed`);
		await page.evaluate(() => document.body.className = 'vscode-light');
		await reset('set'); await modifiedKey('Control', 'a');
		await page.waitForSelector('.tab-body:not([hidden]) .cm-selectionBackground');
		await page.evaluate(() => document.body.className = 'vscode-dark');
		console.log(`${tab}: selection, Tab/Shift+Tab, completion, theme switch passed`);
	}
}
