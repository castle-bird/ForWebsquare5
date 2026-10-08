import assert from 'node:assert/strict';

export default async function ({ page, clickTab }) {
	await page.evaluate(() => [...document.querySelectorAll('.pane .codicon-expand-all')].find(b => b.offsetParent)?.click());
	// Script에서 Ctrl+X: 잘린 줄의 DOM이 다시 그려져 cut 이벤트 대상이 문서에서 떨어져도, 고른 컴포넌트를 잘라 내지 않는다(XML이 클립보드로 가던 버그)
	{
		await page.evaluate(() => window.tab('Outline', '.pane').click());
		await page.waitForSelector('.pane .tree-row[role="button"] .codicon-edit');
		await page.evaluate(() => document.querySelector('.pane .tree-row[role="button"] .codicon-edit').closest('.tree-row').click());
		await clickTab('Script');
		await page.waitForFunction(() => window.editor()?.state.doc.line(1).length > 0);
		const line = await page.evaluate(() => { const v = window.editor(); v.dispatch({ selection: { anchor: 0, head: v.state.doc.line(1).to } }); v.focus(); window.sent.length = 0; return v.state.doc.line(1).text; });
		const cut = await page.evaluate(() => {
			const data = new DataTransfer();
			const target = window.getSelection().anchorNode.parentElement;
			target.dispatchEvent(new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: data }));
			return { text: data.getData('text/plain'), nodes: data.getData('application/x-websquare5-nodes'), sent: window.sent.map(m => m.type) };
		});
		assert.equal(cut.text, line, `잘라 낸 코드가 클립보드에: ${cut.text}`);
		assert.equal(cut.nodes, '', '컴포넌트 XML은 클립보드에 넣지 않는다');
		assert.ok(!cut.sent.includes('delete'), `컴포넌트를 지우지 않는다: ${cut.sent}`);
		console.log('Script: Ctrl+X는 코드만 잘라 냄(컴포넌트 잘라 내기 아님) passed');
	}

	// 코드 편집기 합자는 VS Code editor.fontLigatures를 따른다(기본 끔)
	{
		const features = () => page.evaluate(() => getComputedStyle(document.querySelector('.tab-body:not([hidden]) .cm-editor')).fontFeatureSettings);
		assert.equal(await features(), '"calt" 0, "liga" 0', '기본은 합자 끔');
		await page.evaluate(() => window.send({ type: 'codeOptions', wordWrap: false, sqlDialect: 'standard', fontFeatures: '"liga" on, "calt" on' }));
		await page.waitForFunction(() => getComputedStyle(document.querySelector('.tab-body:not([hidden]) .cm-editor')).fontFeatureSettings === '"calt", "liga"', {timeout: 3000});
		await page.evaluate(() => window.send({ type: 'codeOptions', wordWrap: false, sqlDialect: 'standard', fontFeatures: '"liga" off, "calt" off' }));
		console.log('Script: 합자는 editor.fontLigatures를 따름 passed');
	}

	// Event 코드 버튼: Script가 CRLF여도(Windows) 핸들러 이름을 정확히 고른다(편집기는 줄바꿈을 \n으로 바꿔 위치가 줄 수만큼 밀렸다)
	{
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:input id="ipt_crlf" ev:onclick="scwin.ipt_crlf_onclick"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 0;
			window.send({ type: 'document', version: 990, text, root, script: { text: 'var a = 1;\r\nvar b = 2;\r\nvar c = 3;\r\n\r\nscwin.ipt_crlf_onclick = function(e) {\r\n};\r\n' } });
		});
		// 앞 테스트가 남긴 충돌 상태면 다시 불러온다
		await clickTab('Script');
		await page.evaluate(() => document.querySelector('.tab-body:not([hidden]) .code-banner button')?.click());
		await page.waitForFunction(() => window.editor()?.state.doc.toString().includes('ipt_crlf'));
		await page.evaluate(() => { const v = window.editor(); v.dispatch({ selection: { anchor: 0 } }); });
		await clickTab('Design');
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#ipt_crlf'));
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('#ipt_crlf').click());
		await page.evaluate(() => window.tab('Event', '.pane').click());
		await page.waitForSelector('.kv .script-btn');
		await page.click('.kv .script-btn');
		await page.waitForFunction(() => window.tab('Script').getAttribute('aria-selected') === 'true');
		await page.waitForFunction(() => { const s = window.editor()?.state; return s && !s.selection.main.empty; }, {timeout: 3000}).catch(() => {});
		const picked = await page.evaluate(() => { const s = window.editor().state, r = s.selection.main; return s.sliceDoc(r.from, r.to); });
		assert.equal(picked, 'scwin.ipt_crlf_onclick', 'CRLF Script에서도 핸들러 이름 선택');
		console.log('Event: 코드 버튼 → CRLF Script에서도 핸들러 자리 passed');
	}
	// VS Code가 웹뷰를 숨겼다 보이거나 다른 창에서 돌아온 뒤 첫 Space: 커서가 바뀌었거나 포커스가 body여도 원래 자리에 입력, 스크롤이 튀지 않음
	{
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body/></html>';
			window.send({ type: 'document', version: 995, text, root: window.parseXml(text), script: { text: Array.from({ length: 300 }, (_, i) => `var v${i} = ${i};`).join('\n') } });
		});
		await page.evaluate(() => window.tab('Script').click());
		await page.evaluate(() => document.querySelector('.tab-body:not([hidden]) .code-banner button')?.click());
		await page.waitForFunction(() => window.editor()?.state.doc.lines === 300);
		const atLine = () => page.evaluate(() => { const v = window.editor(), head = v.state.selection.main.head; return { line: v.state.doc.lineAt(head).number, col: head - v.state.doc.lineAt(head).from, top: Math.round(v.scrollDOM.scrollTop) }; });
		const place = () => page.evaluate(() => { const v = window.editor(), p = v.state.doc.line(150).from + 3; v.dispatch({ selection: { anchor: p }, scrollIntoView: true }); v.focus(); });
		await place(); await new Promise(r => setTimeout(r, 200));
		const before = await atLine();
		// 1) 떠났다 오는 사이 커서가 문서 끝으로 바뀐 채(클릭 없이) Space
		await page.evaluate(() => { window.dispatchEvent(new Event('blur')); const v = window.editor(); v.dispatch({ selection: { anchor: v.state.doc.length } }); window.dispatchEvent(new Event('focus')); });
		await page.keyboard.press('Space');
		assert.deepEqual(await atLine(), { ...before, col: before.col + 1 }, '돌아온 뒤 첫 Space는 떠날 때 커서 자리에, 스크롤 그대로');
		// 2) 돌아왔는데 포커스가 body: 편집기로 돌려놓고 같은 자리에
		await page.keyboard.press('Backspace');
		await page.evaluate(() => { window.dispatchEvent(new Event('blur')); document.activeElement.blur(); window.dispatchEvent(new Event('focus')); });
		assert.equal(await page.evaluate(() => window.editor().hasFocus), true, '돌아오면 편집기 포커스');
		await page.keyboard.press('Space');
		assert.deepEqual(await atLine(), { ...before, col: before.col + 1 }, 'body였어도 원래 자리에 입력');
		// 2-1) 돌아와서 휠로 스크롤했으면 화살표 키에 떠날 때 스크롤로 되돌리지 않음
		await page.evaluate(() => window.dispatchEvent(new Event('blur')));
		await page.evaluate(() => window.dispatchEvent(new Event('focus')));
		const wheelAt = await page.$eval('.tab-body:not([hidden]) .cm-scroller', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
		await page.mouse.move(wheelAt.x, wheelAt.y);
		await page.mouse.wheel({ deltaY: 600 });
		await page.waitForFunction(top => window.editor().scrollDOM.scrollTop > top + 100, { timeout: 2000 }, before.top).catch(() => assert.fail('휠 스크롤 안 됨'));
		const wheeled = await page.evaluate(() => window.editor().scrollDOM.scrollTop);
		await page.keyboard.press('Shift');
		assert.equal(await page.evaluate(() => window.editor().scrollDOM.scrollTop), wheeled, '휠로 옮긴 스크롤 그대로');
		// 3) 돌아와서 다른 곳을 클릭했으면 그 자리가 맞다(되돌리지 않음)
		await page.evaluate(() => window.dispatchEvent(new Event('blur')));
		await page.evaluate(() => { window.editor().scrollDOM.scrollTop = 0; });
		// 맨 위로 스크롤한 뒤 그 줄이 그려질 때까지
		const lineEnd = text => page.waitForFunction(text => [...document.querySelectorAll('.tab-body:not([hidden]) .cm-line')].some(l => l.textContent === text), { timeout: 3000 }, text)
			.then(() => page.evaluate(text => { const r = [...document.querySelectorAll('.tab-body:not([hidden]) .cm-line')].find(l => l.textContent === text).getBoundingClientRect(); return { x: r.right - 2, y: r.y + r.height / 2 }; }, text));
		const p5 = await lineEnd('var v4 = 4;');
		await page.mouse.click(p5.x, p5.y);
		await page.keyboard.press('Space');
		assert.equal((await atLine()).line, 5, '클릭한 자리에 입력');
		// 4) 한 번 클릭했는데 포커스가 안 들어감(웹뷰 문서가 포커스를 못 받아 클릭의 포커스·CodeMirror focus()가 무시됨 → body에 남음).
		// 고치기 전: Space가 입력 없이 편집기를 한 화면 내림. 이제 클릭이 끝나면 편집기로 포커스, Space는 클릭한 자리에
		await page.evaluate(() => {
			window.editor().scrollDOM.scrollTop = 0;
			document.activeElement.blur();
			window.realFocus = HTMLElement.prototype.focus; HTMLElement.prototype.focus = function () {};
			window.noFocus = e => e.preventDefault(); window.addEventListener('mousedown', window.noFocus, true);
		});
		const p8 = await lineEnd('var v7 = 7;');
		await page.mouse.move(p8.x, p8.y); await page.mouse.down();
		await page.evaluate(() => { HTMLElement.prototype.focus = window.realFocus; window.removeEventListener('mousedown', window.noFocus, true);
			// CodeMirror가 클릭을 처리했다면 옮겼을 커서 자리
			const v = window.editor(); v.dispatch({ selection: { anchor: v.state.doc.line(8).to } }); });
		assert.equal(await page.evaluate(() => document.activeElement === document.body), true, '흉내: 클릭했는데 포커스가 body');
		await page.mouse.up();
		await page.waitForFunction(() => window.editor().hasFocus, { timeout: 2000 }).catch(() => assert.fail('한 번 클릭으로 편집기 포커스'));
		await page.keyboard.press('Space');
		assert.equal((await atLine()).top, 0, 'Space에 스크롤이 안 튐');
		assert.equal(await page.evaluate(() => window.editor().state.doc.line(8).text), 'var v7 = 7; ', '한 번 클릭한 자리에 공백 입력');
		// 포커스가 끝내 body에 있어도 Space로 스크롤하지 않음
		await page.evaluate(() => document.activeElement.blur());
		await page.keyboard.press('Space');
		assert.equal((await atLine()).top, 0, 'body에서 Space: 스크롤 없음');
		console.log('Script: 웹뷰로 돌아온 뒤 첫 Space 커서·스크롤 유지 passed');
	}
	// 코드 미니맵(막대형): 기본 켬, 설정(톱니바퀴)에서 켜고 끔(모든 화면 공통으로 저장), 클릭하면 그 줄로, 오류 줄 표시
	{
		const minimapShown = () => page.evaluate(() => !!document.querySelector('.tab-body:not([hidden]) .cm-minimap'));
		assert.equal(await minimapShown(), true, '미니맵 기본 켬');
		const toggleMinimap = async () => {
			await page.click('.canvas-frame .tab-settings');
			await page.waitForSelector('.context-menu [role="menuitemcheckbox"]');
			const checked = await page.$eval('.context-menu [role="menuitemcheckbox"]', b => [b.textContent, b.getAttribute('aria-checked')]);
			await page.click('.context-menu [role="menuitemcheckbox"]');
			return checked;
		};
		assert.deepEqual(await toggleMinimap(), ['코드 미니맵', 'true']);
		assert.equal(await minimapShown(), false, '끄면 미니맵 없음');
		assert.deepEqual(await page.evaluate(() => window.sent.findLast(m => m.type === 'setMinimap')), { type: 'setMinimap', on: false }, '설정 저장 요청');
		await page.evaluate(() => window.send({ type: 'minimap', on: true }));
		await page.waitForFunction(() => !!document.querySelector('.tab-body:not([hidden]) .cm-minimap'), { timeout: 2000 }).catch(() => assert.fail('다른 화면에서 켜면 따라 켜짐'));
		// 막대가 그려지고(빈 그림 아님), 내용이 미니맵 밑으로 안 들어감
		await page.waitForFunction(() => { const c = document.querySelector('.tab-body:not([hidden]) .cm-minimap canvas'); if (!c?.width) { return false; } const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 200)).data; for (let i = 3; i < d.length; i += 4) { if (d[i] > 0) { return true; } } return false; }, { timeout: 3000 })
			.catch(() => assert.fail('미니맵에 막대가 그려짐'));
		assert.ok(await page.evaluate(() => { const m = document.querySelector('.tab-body:not([hidden]) .cm-minimap').getBoundingClientRect(), c = document.querySelector('.tab-body:not([hidden]) .cm-content').getBoundingClientRect(), sc = document.querySelector('.tab-body:not([hidden]) .cm-scroller').getBoundingClientRect(); return m.right <= sc.right && m.width === 72; }), '미니맵은 스크롤바 왼쪽 72px');
		// 높이가 소수 px(화면 배율 125% 등)여도 그림이 미니맵 밖으로 안 삐져나감(1px 미만이라도 바깥 스크롤이 생긴다)
		{
			await page.evaluate(() => { const h = document.querySelector('.tab-body:not([hidden]) .code-host'); h.style.flex = 'none'; h.style.height = `${h.getBoundingClientRect().height - 0.4}px`; });
			await new Promise(r => setTimeout(r, 400));
			const [m, c] = await page.evaluate(() => [document.querySelector('.tab-body:not([hidden]) .cm-minimap'), document.querySelector('.tab-body:not([hidden]) .cm-minimap canvas')].map(e => e.getBoundingClientRect().bottom));
			await page.evaluate(() => { const h = document.querySelector('.tab-body:not([hidden]) .code-host'); h.style.flex = ''; h.style.height = ''; });
			assert.ok(c <= m + 0.01, `미니맵 그림이 미니맵 안: canvas ${c} > minimap ${m}`);
		}
		// 미니맵 아래쪽 클릭: 그 줄 근처로 스크롤
		await page.evaluate(() => { window.editor().scrollDOM.scrollTop = 0; });
		await new Promise(r => setTimeout(r, 200));
		const mm = await page.$eval('.tab-body:not([hidden]) .cm-minimap', e => { const r = e.getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height - 20 }; });
		await page.mouse.click(mm.x, mm.y);
		await page.waitForFunction(() => window.editor().scrollDOM.scrollTop > 1000, { timeout: 2000 }).catch(() => assert.fail('미니맵 클릭으로 이동'));
		// 검색창(Ctrl+F)을 열면 미니맵은 그 아래부터(검색창 오른쪽을 가리지 않음)
		await page.evaluate(() => window.editor().focus());
		await page.keyboard.down('Control'); await page.keyboard.press('f'); await page.keyboard.up('Control');
		await page.waitForSelector('.tab-body:not([hidden]) .cm-search');
		await page.waitForFunction(() => { const p = document.querySelector('.tab-body:not([hidden]) .cm-panels-top')?.getBoundingClientRect(), m = document.querySelector('.tab-body:not([hidden]) .cm-minimap').getBoundingClientRect(); return p && m.top >= p.bottom - 1; }, { timeout: 2000 })
			.catch(() => assert.fail('검색창을 열면 미니맵이 그 아래로'));
		await page.keyboard.press('Escape');
		// 문법 색을 재도 문서는 그대로(편집 영역에 손대지 않음)
		assert.equal(await page.evaluate(() => window.editor().state.doc.lines), 300, '미니맵이 문서를 안 바꿈');
		console.log('Script: 코드 미니맵(막대형) 켜고 끄기·그리기·클릭 이동 passed');
	}
}
