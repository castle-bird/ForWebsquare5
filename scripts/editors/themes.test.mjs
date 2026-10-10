import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';

export default async function ({ clickTab, page, reset, modifiedKey }) {
	// 코드 편집기 테마: 확장이 고른 테마를 보내면 모든 코드 편집기에 적용, VS Code 밝음/어두움 전환에는 안 바뀜. 'vscode'면 다시 따라간다
	await clickTab('Script');
	const editorBg = () => page.evaluate(() => getComputedStyle(document.querySelector('.tab-body:not([hidden]) .cm-editor')).backgroundColor);
	const vsDarkBg = await editorBg();
	await page.evaluate(() => window.send({ type: 'codeTheme', theme: 'dracula' }));
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.tab-body:not([hidden]) .cm-editor')).backgroundColor === 'rgb(45, 47, 63)', {timeout: 3000})
		.catch(async () => assert.fail(`Dracula 배경 아님: ${await editorBg()}`));
	assert.ok(await page.$eval('.tab-body:not([hidden]) .code-editor', e => e.classList.contains('custom-theme')));
	await reset('selected text'); await modifiedKey('Control', 'a');
	await page.waitForSelector('.tab-body:not([hidden]) .cm-selectionBackground');
	const selection = await page.$eval('.tab-body:not([hidden]) .cm-selectionBackground', e => getComputedStyle(e).backgroundColor);
	assert.notEqual(selection, 'rgba(0, 0, 0, 0)', `선택 표시: ${selection}`);
	await reset('function f() {\n    return "text"; // note\n}'); await page.keyboard.down('Shift'); await page.keyboard.press('ArrowUp'); await page.keyboard.up('Shift');
	await page.screenshot({path:path.join(tmpdir(), 'ws5-theme-dracula.png'), clip: await page.$eval('.tab-body:not([hidden]) .code-editor', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: Math.min(r.width, 700), height: 120 }; })});
	await page.evaluate(() => { document.body.className = 'vscode-light'; });
	await new Promise(resolve => setTimeout(resolve, 100));
	assert.equal(await editorBg(), 'rgb(45, 47, 63)', '고른 테마는 VS Code 밝음 전환에 안 바뀜');
	await page.evaluate(() => { document.body.className = 'vscode-dark'; });
	await clickTab('Source');
	assert.equal(await editorBg(), 'rgb(45, 47, 63)', '다른 코드 탭도 같은 테마');
	// 검색창(Ctrl+F)도 고른 테마의 배경·글자색
	await page.click('.tab-body:not([hidden]) .cm-content'); await modifiedKey('Control', 'f');
	await page.waitForSelector('.tab-body:not([hidden]) .cm-search .cm-textfield');
	const search = await page.evaluate(() => {
		const q = s => getComputedStyle(document.querySelector('.tab-body:not([hidden]) ' + s));
		return { panels: q('.cm-panels').backgroundColor, field: q('.cm-search .cm-textfield').color, editor: q('.cm-editor').color };
	});
	assert.deepEqual({ panels: search.panels, field: search.field }, { panels: 'rgb(45, 47, 63)', field: search.editor }, `검색창 테마: ${JSON.stringify(search)}`);
	await page.keyboard.press('Escape');
	await page.evaluate(() => window.send({ type: 'codeTheme', theme: 'vscode' }));
	await page.waitForFunction(bg => getComputedStyle(document.querySelector('.tab-body:not([hidden]) .cm-editor')).backgroundColor === bg, {timeout: 3000}, vsDarkBg);
	assert.ok(!await page.$eval('.tab-body:not([hidden]) .code-editor', e => e.classList.contains('custom-theme')));
	console.log('Code theme: 적용·VS Code 전환 무시·되돌리기 passed');
	// 찾기 일치: 지금 일치는 따로 칠하지 않고(선택 색으로 보임) 여백도 없음, 일치 글자는 원래 문법 색
	await clickTab('Script');
	const findText = 'scwin.target = 1;\nscwin.target = 2;';
	await reset(findText);
	const tokenColor = await page.evaluate(() => getComputedStyle([...document.querySelectorAll('.tab-body:not([hidden]) .cm-line span')].find(s => s.textContent === 'target')).color);
	await modifiedKey('Control', 'f');
	await page.waitForSelector('.tab-body:not([hidden]) .cm-search .cm-textfield');
	// 검색창 입력·버튼·라벨은 VS Code 편집기 글꼴
	assert.deepEqual(await page.evaluate(() => {
		document.body.style.setProperty('--vscode-editor-font-family', '"Test Mono", monospace');
		const fonts = [...new Set([...document.querySelectorAll('.tab-body:not([hidden]) .cm-search :is(.cm-textfield, .cm-button, label)')].map(e => getComputedStyle(e).fontFamily))];
		document.body.style.removeProperty('--vscode-editor-font-family');
		return fonts;
	}), ['"Test Mono", monospace'], '검색창 글꼴');
	assert.deepEqual(await page.$eval('.tab-body:not([hidden]) .cm-search [name=close]', b => {
		const box = b.getBoundingClientRect(), icon = getComputedStyle(b, '::before');
		return [box.width, box.height, icon.fontFamily, icon.content];
	}), [24, 24, 'codicon', '""'], '검색창 닫기: codicon close 24px');
	await page.keyboard.type('target'); await page.keyboard.press('Enter');
	await page.waitForSelector('.tab-body:not([hidden]) .cm-searchMatch-selected', {timeout: 3000}).catch(() => assert.fail('찾기: 지금 일치 표시'));
	const found = await page.evaluate(() => {
		const all = [...document.querySelectorAll('.tab-body:not([hidden]) .cm-searchMatch')], sel = document.querySelector('.tab-body:not([hidden]) .cm-searchMatch-selected');
		const st = getComputedStyle(sel);
		// 일치 안 글자(가장 안쪽 문법 색 span)의 색
		return { count: all.length, bg: st.backgroundColor, padding: st.paddingLeft, colors: [...new Set(all.flatMap(e => [...e.querySelectorAll("span:not(:has(span))")].map(t => getComputedStyle(t).color)))] };
	});
	assert.deepEqual(found, { count: 2, bg: 'rgba(0, 0, 0, 0)', padding: '0px', colors: [tokenColor] }, `찾기 일치 표시(문법 색 ${tokenColor}): ${JSON.stringify(found)}`);
	await page.keyboard.press('Escape');
	console.log('Search: 지금 일치는 선택 색만·일치 글자는 문법 색 passed');
	// 사용자 테마: 고른 테마 위 덮어쓰기 층(배경·선택·문법 색), 가져온 테마(VS Code 기본 라이트 바탕 + 층)
	await clickTab('Script');
	await reset('return "x";');
	const keywordStyle = () => page.evaluate(() => {
		const span = [...document.querySelectorAll('.tab-body:not([hidden]) .cm-content span')].find(s => s.textContent === 'return');
		const style = getComputedStyle(span);
		return [style.color, style.fontStyle];
	});
	await page.evaluate(() => window.send({ type: 'codeTheme', theme: 'dracula', own: { colors: { background: '#102030', selection: '#ff000080' }, tokens: { keyword: { color: '#ff8800', fontStyle: 'italic' } } } }));
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.tab-body:not([hidden]) .cm-editor')).backgroundColor === 'rgb(16, 32, 48)', { timeout: 3000 })
		.catch(async () => assert.fail(`덮어쓴 배경 아님: ${await editorBg()}`));
	assert.deepEqual(await keywordStyle(), ['rgb(255, 136, 0)', 'italic'], '덮어쓴 키워드 색·기울임이 테마보다 우선');
	assert.equal(await page.$eval('.tab-body:not([hidden]) .code-editor', e => e.style.getPropertyValue('--code-selection')), '#ff000080', '선택 색은 CSS 변수로');
	await page.evaluate(() => window.send({ type: 'codeTheme', theme: 'vscode', dark: false, imported: { tokens: { keyword: { color: '#0000ff' } } } }));
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.tab-body:not([hidden]) .cm-editor')).backgroundColor === 'rgb(255, 255, 255)', { timeout: 3000 })
		.catch(async () => assert.fail(`가져온 라이트 테마 바탕 아님: ${await editorBg()}`));
	assert.equal((await keywordStyle())[0], 'rgb(0, 0, 255)');
	assert.ok(await page.$eval('.tab-body:not([hidden]) .code-editor', e => e.classList.contains('custom-theme')), '가져온 테마는 고른 테마처럼');
	await page.evaluate(() => { document.body.className = 'vscode-dark'; document.body.classList.add('x'); });
	await new Promise(resolve => setTimeout(resolve, 100));
	assert.equal(await editorBg(), 'rgb(255, 255, 255)', '가져온 테마는 VS Code 밝음·어두움 전환에 안 바뀜');
	// 현재 줄 색이 불투명해도(IntelliJ Dark 등) 단어 더블클릭 선택이 보이게: 선택 중엔 현재 줄 배경을 걷는다
	await page.evaluate(() => window.send({ type: 'codeTheme', theme: 'vscode', dark: true, imported: { colors: { lineHighlight: '#26282e', selection: '#214283' } } }));
	await page.waitForFunction(() => document.querySelector('.tab-body:not([hidden]) .code-editor')?.style.getPropertyValue('--code-line') === '#26282e', { timeout: 3000 });
	await reset('word other');
	const lineBg = () => page.$eval('.tab-body:not([hidden]) .cm-activeLine', e => getComputedStyle(e).backgroundColor);
	assert.equal(await lineBg(), 'rgb(38, 40, 46)', '선택 없으면 현재 줄 색');
	const word = await page.evaluate(() => { const v = window.editor(), r = v.coordsAtPos(2); return { x: r.left, y: (r.top + r.bottom) / 2 }; });
	await page.mouse.click(word.x, word.y, { count: 2 });
	await page.waitForFunction(() => { const v = window.editor(), r = v.state.selection.main; return v.state.sliceDoc(r.from, r.to) === 'word'; }, { timeout: 3000 });
	assert.equal(await lineBg(), 'rgba(0, 0, 0, 0)', '선택 중엔 현재 줄 배경 걷음(선택 색이 가려지지 않게)');
	await page.evaluate(() => { document.body.className = 'vscode-dark'; window.send({ type: 'codeTheme', theme: 'vscode' }); });
	await page.waitForFunction(bg => getComputedStyle(document.querySelector('.tab-body:not([hidden]) .cm-editor')).backgroundColor === bg, { timeout: 3000 }, vsDarkBg);
	console.log('Code theme: 덮어쓰기 층·가져온 테마 passed');
	// 탭 줄 톱니바퀴: 우측 패널 버튼 왼쪽, 누르면 아래로 메뉴. 항목은 확장에 이름만 보낸다
	const gear = await page.$('.canvas-frame .tab-settings');
	assert.ok(await page.evaluate(() => { const g = document.querySelector('.canvas-frame .tab-settings'), r = document.querySelector('.canvas-frame .tab-panel-right'); return g.nextElementSibling === r; }), '우측 패널 버튼 바로 왼쪽');
	await gear.click();
	await page.waitForSelector('.context-menu[role="menu"]');
	assert.deepEqual(await page.$$eval('.context-menu [role="menuitem"]', bs => bs.map(b => b.textContent)),
		['패널 글꼴 변경', '코드 편집기 테마 변경…', '테마 파일 가져오기…', '테마 색 덮어쓰기…', 'SQL 방언…', '도구 경로 설정…', '확장 설정 모두 보기…']);
	assert.ok(await page.evaluate(() => { const m = document.querySelector('.context-menu').getBoundingClientRect(), g = document.querySelector('.canvas-frame .tab-settings').getBoundingClientRect(); return (m.top >= g.bottom || m.bottom <= g.top) && Math.abs(m.right - g.right) < 1; }), '톱니바퀴 아래(공간 없으면 위)에, 버튼을 덮지 않고 오른쪽 끝 맞춤');
	await page.evaluate(() => { window.sent.length = 0; });
	await page.evaluate(() => [...document.querySelectorAll('.context-menu [role="menuitem"]')].find(b => b.textContent === 'SQL 방언…').click());
	assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'settingsMenu')), { type: 'settingsMenu', item: 'sqlDialect' });
	assert.equal(await page.$('.context-menu'), null, '고르면 닫힘');
	await gear.click(); await page.waitForSelector('.context-menu');
	await gear.click();
	assert.equal(await page.$('.context-menu'), null, '열린 채 다시 누르면 닫힘');
	await gear.click(); await page.waitForSelector('.context-menu');
	await page.keyboard.press('Escape');
	assert.equal(await page.$('.context-menu'), null, 'Esc로 닫힘');
	console.log('Settings: 탭 줄 톱니바퀴 메뉴 passed');
	// 마우스 뒤로·앞으로 버튼(3·4), IDE처럼: 편집기 안에서 본 탭을 먼저 따라가고, 끝이면 VS Code 이동 기록으로. 웹뷰 안 브라우저 뒤로 가기는 막음
	{
		const press = button => page.evaluate(button => {
			window.sent.length = 0;
			const at = { button, bubbles: true, cancelable: true, clientX: 200, clientY: 200 }, target = document.elementFromPoint(200, 200);
			const down = target.dispatchEvent(new MouseEvent('mousedown', at)), up = target.dispatchEvent(new MouseEvent('mouseup', at));
			return { down, up, sent: window.sent.filter(m => m.type === 'navigate') };
		}, button);
		const shown = () => page.evaluate(() => document.querySelector('.canvas-frame .tab-bar [role="tab"][aria-selected="true"]')?.textContent);
		const settle = () => new Promise(r => setTimeout(r, 100));
		await page.evaluate(() => window.tab('Source').click()); await settle();
		await page.evaluate(() => window.tab('Script').click()); await settle();
		// CSS 편집기에서 버튼을 누르면 VS Code가 먼저 돌아온다. 웹뷰에 놓음만 들어와도 다시 이동하면 안 된다.
		const release = button => page.evaluate(button => {
			window.sent.length = 0;
			document.elementFromPoint(200, 200).dispatchEvent(new MouseEvent('mouseup', { button, bubbles: true, cancelable: true }));
			return window.sent.filter(m => m.type === 'navigate');
		}, button);
		for (const button of [3, 4]) {
			assert.deepEqual(await release(button), [], '웹뷰 밖에서 누른 버튼의 놓음은 VS Code로 재전송하지 않음');
			await settle();
			assert.equal(await shown(), 'Script', '놓음만 받은 뒤에는 웹뷰 탭도 이동하지 않음');
		}

		assert.deepEqual(await press(3), { down: false, up: false, sent: [] }, '뒤로: 편집기 안 탭이라 VS Code로 안 넘김');
		await settle();
		assert.equal(await shown(), 'Source', '뒤로 → 직전 탭(Source)');
		assert.deepEqual((await press(4)).sent, [], '앞으로: 편집기 안');
		await settle();
		assert.equal(await shown(), 'Script', '앞으로 → Script');
		assert.deepEqual((await press(4)).sent, [{ type: 'navigate', back: false }], '앞으로 갈 탭이 없으면 VS Code 이동 기록으로');
		// 뒤로를 계속 누르면 편집기 안 기록이 끝난 뒤 VS Code로
		let sent = [];
		for (let i = 0; i < 200 && !sent.length; i++) { sent = (await press(3)).sent; await settle(); }
		assert.deepEqual(sent, [{ type: 'navigate', back: true }], '편집기 안 기록이 끝나면 VS Code 이동 기록으로');
		assert.deepEqual((await press(1)).sent, [], '가운데 버튼은 그대로');
		for (const button of [3, 4]) {
			await page.evaluate(button => {
				window.dispatchEvent(new MouseEvent('mousedown', { button, cancelable: true }));
				window.dispatchEvent(new Event('blur'));
			}, button);
			assert.deepEqual(await release(button), [], '웹뷰를 벗어난 클릭의 놓음은 이동하지 않음');
			if (button === 3) { assert.deepEqual((await press(button)).sent, [{ type: 'navigate', back: true }], '새 뒤로 클릭은 한 번만 이동'); }
			assert.deepEqual(await release(button), [], '같은 클릭의 중복 놓음은 이동하지 않음');
		}

		console.log('Mouse: 뒤로·앞으로 버튼 → 편집기 안 탭 기록, 끝이면 VS Code 이동 기록 passed');
	}
	// 잠깐 뜨는 알림: 확장이 보내면 오른쪽 아래에 떴다가 사라짐
	await page.evaluate(() => window.send({ type: 'toast', message: '바인딩 2곳도 함께 변경했습니다. `dlt_a` → `dlt_b`' }));
	await page.waitForFunction(() => document.querySelector('.toast[role="status"]')?.textContent === '바인딩 2곳도 함께 변경했습니다. dlt_a → dlt_b', { timeout: 3000 });
	assert.deepEqual(await page.$$eval('.toast code', cs => cs.map(c => c.textContent)), ['dlt_a', 'dlt_b'], '`값`은 코드 모양');
	// 마우스를 올려 둔 동안은 안 사라짐, 떼면 다시 3초 뒤 사라짐
	await page.hover('.toast');
	await new Promise(resolve => setTimeout(resolve, 3600));
	assert.ok(await page.$('.toast'), '마우스를 올려 둔 동안 유지');
	assert.equal(await page.$eval('.toast code', c => getComputedStyle(c).backgroundColor), 'rgb(255, 255, 255)', '값은 흰 칩(웹뷰 기본 노란 code 색 아님)');
	await page.screenshot({path:path.join(tmpdir(), 'ws5-toast-code.png')});
	await page.mouse.move(5, 5);
	await new Promise(resolve => setTimeout(resolve, 300));
	assert.equal(await page.$eval('.toast', e => getComputedStyle(e).backgroundColor), 'color(srgb 0.85 0.924706 0.974706)', '캔버스 hover와 같은 파란 파스텔');
	await page.screenshot({path:path.join(tmpdir(), 'ws5-toast.png')});
	await page.waitForFunction(() => !document.querySelector('.toast'), { timeout: 7000 });
	console.log('Toast: 알림 표시·자동 사라짐 passed');
	// 테마 색 덮어쓰기 팝업: 테마 기본 색 표시, 입력하는 대로 열린 편집기에 미리 보기, 닫기는 되돌림, 확인은 공통·이 테마 층 저장
	await clickTab('Script');
	await reset('return "x"; // c');
	// 글자 위치로 찾는다(커서 표시 등으로 한 단어가 여러 span으로 쪼개질 수 있다)
	const spanStyle = text => page.evaluate(text => {
		const v = window.editor(), { node } = v.domAtPos(v.state.doc.toString().indexOf(text) + 1);
		const st = getComputedStyle(node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
		return [st.color, st.fontStyle];
	}, text);
	await page.evaluate(() => window.send({ type: 'codeTheme', theme: 'dracula', id: 'dracula', label: 'Dracula' }));
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.tab-body:not([hidden]) .cm-editor')).backgroundColor === 'rgb(45, 47, 63)');
	const draculaKeyword = await spanStyle('return');
	const openThemeColors = async () => {
		await page.click('.canvas-frame .tab-settings');
		await page.evaluate(() => [...document.querySelectorAll('.context-menu [role="menuitem"]')].find(b => b.textContent === '테마 색 덮어쓰기…').click());
		await page.waitForSelector('.theme-colors-editor[open]');
	};
	const hex = name => `.theme-colors-editor .theme-hex[data-name="${name}"]`;
	const themeRow = name => `.theme-colors-editor .theme-row:has(.theme-hex[data-name="${name}"])`;
	await openThemeColors();
	assert.equal(await page.$eval('.theme-colors-editor .popup-title .mono', e => e.textContent), 'Dracula');
	assert.equal(await page.$eval(hex('keyword'), e => e.placeholder), '테마 기본');
	assert.equal(await page.$eval(`${themeRow('keyword')} .theme-swatch`, e => getComputedStyle(e).backgroundColor), draculaKeyword[0], '안 바꾼 칸에도 테마의 실제 색');
	assert.equal(await page.$eval(`${themeRow('background')} .theme-swatch`, e => getComputedStyle(e).backgroundColor), 'rgb(45, 47, 63)');
	await page.click(hex('keyword')); await page.keyboard.type('#ff8800'); await page.keyboard.press('Enter');
	await page.waitForFunction(() => { const s = [...document.querySelectorAll('.tab-body:not([hidden]) .cm-content span')].find(s => s.textContent === 'return'); return getComputedStyle(s).color === 'rgb(255, 136, 0)'; }, { timeout: 3000 });
	assert.ok(await page.$eval('.theme-colors-editor .theme-preview', p => [...p.querySelectorAll('.cm-content span')].some(s => s.textContent === 'return' && getComputedStyle(s).color === 'rgb(255, 136, 0)')), '팝업 미리 보기도');
	await page.click(`${themeRow('keyword')} .font-italic`);
	assert.equal((await spanStyle('return'))[1], 'italic', 'I 토글');
	assert.equal(await page.$eval('.theme-colors-editor .popup-meta', e => e.textContent), '· 바꾼 색 1');
	await page.evaluate(() => { window.sent.length = 0; });
	await page.evaluate(() => [...document.querySelectorAll('.theme-colors-editor .data-editor-actions button')].find(b => b.textContent === '닫기').click());
	await page.waitForFunction(() => !document.querySelector('.theme-colors-editor'));
	assert.deepEqual(await spanStyle('return'), draculaKeyword, '닫기는 원래대로');
	assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'saveThemeCustomizations')), false, '닫기는 저장 안 함');
	await openThemeColors();
	await page.click(hex('keyword')); await page.keyboard.type('#ff8800'); await page.keyboard.press('Enter');
	assert.ok(await page.$(`${themeRow('keyword')}.changed .theme-reset`), '바꾼 줄에 되돌리기');
	await page.click(`${themeRow('keyword')} .theme-reset`);
	assert.equal(await page.$eval(hex('keyword'), e => e.value), '', '되돌리면 테마 기본');
	await page.click(hex('keyword')); await page.keyboard.type('#ff8800'); await page.keyboard.press('Enter');
	await page.evaluate(() => [...document.querySelectorAll('.theme-colors-editor .segmented button')].find(b => b.textContent === '모든 테마').click());
	await page.waitForFunction(sel => document.querySelector(sel)?.value === '', { timeout: 3000 }, hex('keyword'))
		.catch(() => assert.fail('모든 테마 층은 따로'));
	await page.click(hex('comment')); await page.keyboard.type('#123456'); await page.keyboard.press('Tab');
	await page.click('.theme-colors-editor .btn-primary');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'saveThemeCustomizations'));
	assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'saveThemeCustomizations')),
		{ type: 'saveThemeCustomizations', common: { tokens: { comment: { color: '#123456' } } }, own: { tokens: { keyword: { color: '#ff8800' } } } });
	assert.equal((await spanStyle('return'))[0], 'rgb(255, 136, 0)', '확인하면 그대로 유지');
	assert.equal((await spanStyle('// c'))[0], 'rgb(18, 52, 86)');
	// 미리 보기 글꼴은 코드 편집기와 같다
	const scriptFont = await page.$eval('.tab-body:not([hidden]) .cm-scroller', e => getComputedStyle(e).fontFamily);
	await openThemeColors();
	const previewColor = text => page.$eval('.theme-colors-editor .theme-preview', (p, text) => {
		const span = [...p.querySelectorAll('.cm-line span')].find(s => s.textContent === text);
		return span && getComputedStyle(span).color;
	}, text);
	assert.equal(await page.$eval('.theme-colors-editor .theme-preview .cm-scroller', e => getComputedStyle(e).fontFamily), scriptFont, '미리 보기 글꼴 = 코드 편집기 글꼴');
	// 어노테이션 색이 @Override에 칠해진다(@lezer/java에는 어노테이션 태그가 없어 덧붙임)
	await page.click(hex('annotation')); await page.keyboard.type('#00ff00'); await page.keyboard.press('Enter');
	await page.waitForFunction(() => [...document.querySelectorAll('.theme-colors-editor .theme-preview .cm-line span')].some(s => s.textContent.includes('Override') && getComputedStyle(s).color === 'rgb(0, 255, 0)'), { timeout: 3000 })
		.catch(async () => assert.fail(`어노테이션 색 아님: ${await previewColor('Override')}`));
	// 글꼴 모양을 켰다 끄면 테마 기본으로(되돌리기 없음)
	await page.click(`${themeRow('string')} .font-bold`);
	assert.ok(await page.$(`${themeRow('string')}.changed .theme-reset`));
	await page.click(`${themeRow('string')} .font-bold`);
	assert.equal(await page.$(`${themeRow('string')}.changed`), null, '켰다 끄면 바꾼 줄 아님(되돌리기 없음)');
	await page.evaluate(() => [...document.querySelectorAll('.theme-colors-editor .data-editor-actions button')].find(b => b.textContent === '닫기').click());
	await page.evaluate(() => window.send({ type: 'codeTheme', theme: 'vscode' }));
	console.log('Theme colors: 덮어쓰기 팝업(테마 기본·미리 보기·닫기·되돌리기·범위·저장) passed');
}
