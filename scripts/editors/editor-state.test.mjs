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
		// 열자마자 찾을 말 입력칸에 포커스(복사해 온 글자를 바로 붙여 넣어 찾게)
		await page.waitForFunction(() => document.activeElement?.matches('.tab-body:not([hidden]) .cm-search [main-field]'), { timeout: 2000 })
			.catch(async () => assert.fail(`검색창을 열면 입력칸에 포커스: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))}`));
		// 다른 창에서 복사해 돌아오면(VS Code가 포커스를 body에 둠) 다시 입력칸으로: 바로 붙여 넣기
		await page.evaluate(() => { window.dispatchEvent(new Event('blur')); document.activeElement.blur(); window.dispatchEvent(new Event('focus')); });
		assert.equal(await page.evaluate(() => document.activeElement?.matches('.tab-body:not([hidden]) .cm-search [main-field]')), true, '돌아오면 검색창 입력칸에 포커스');
		await page.keyboard.type('abc');
		assert.equal(await page.$eval('.tab-body:not([hidden]) .cm-search [main-field]', e => e.value.endsWith('abc')), true, '돌아온 뒤 입력은 검색창으로');
		// 입력칸 옆에 몇 번째/찾은 개수(VS Code처럼). Enter로 다음 → 1/N, 2/N, 없으면 "결과 없음"
		{
			const countLabel = () => page.$eval('.tab-body:not([hidden]) .cm-search .cm-search-count', e => e.textContent);
			const word = 'v29'; // v29, v290~v299
			const total = await page.evaluate(w => window.editor().state.doc.toString().toLowerCase().split(w.toLowerCase()).length - 1, word);
			await page.evaluate(() => { const v = window.editor(); v.dispatch({ selection: { anchor: 0 } }); });
			await page.$eval('.tab-body:not([hidden]) .cm-search [main-field]', e => { e.value = ''; });
			await page.focus('.tab-body:not([hidden]) .cm-search [main-field]');
			await page.keyboard.type(word);
			await page.waitForFunction(t => document.querySelector('.tab-body:not([hidden]) .cm-search .cm-search-count')?.textContent.endsWith(`/${t}`), { timeout: 2000 }, total)
				.catch(async () => assert.fail(`찾은 개수 ${total}: ${await countLabel()}`));
			await page.keyboard.press('Enter');
			await page.waitForFunction(t => document.querySelector('.tab-body:not([hidden]) .cm-search .cm-search-count')?.textContent === `1/${t}`, { timeout: 2000 }, total)
				.catch(async () => assert.fail(`Enter로 첫 번째: ${await countLabel()}`));
			if (total > 1) {
				await page.keyboard.press('Enter');
				await page.waitForFunction(t => document.querySelector('.tab-body:not([hidden]) .cm-search .cm-search-count')?.textContent === `2/${t}`, { timeout: 2000 }, total)
					.catch(async () => assert.fail(`다시 Enter로 두 번째: ${await countLabel()}`));
			}
			// 편집기를 클릭해 커서가 찾은 곳을 벗어나도 순번 그대로(VS Code처럼 "?" 아님). 다시 입력칸에서 Enter면 커서 다음 일치로
			{
				const before = await countLabel();
				await page.evaluate(() => { const v = window.editor(); v.dispatch({ selection: { anchor: v.state.doc.line(5).from } }); });
				await new Promise(r => setTimeout(r, 100));
				assert.equal(await countLabel(), before, '편집기 클릭 뒤에도 순번 그대로');
				await page.focus('.tab-body:not([hidden]) .cm-search [main-field]');
				await page.keyboard.press('Enter');
				await page.waitForFunction(t => document.querySelector('.tab-body:not([hidden]) .cm-search .cm-search-count')?.textContent === `1/${t}`, { timeout: 2000 }, total)
					.catch(async () => assert.fail(`5번 줄에서 Enter면 그 다음 일치(첫 번째, v29): ${await countLabel()}`));
			}
			await page.keyboard.type('zzqqxx');
			await page.waitForFunction(() => document.querySelector('.tab-body:not([hidden]) .cm-search .cm-search-count')?.textContent === '결과 없음', { timeout: 2000 })
				.catch(async () => assert.fail(`없으면 결과 없음: ${await countLabel()}`));
		}
		await page.waitForFunction(() => { const p = document.querySelector('.tab-body:not([hidden]) .cm-panels-top')?.getBoundingClientRect(), m = document.querySelector('.tab-body:not([hidden]) .cm-minimap').getBoundingClientRect(); return p && m.top >= p.bottom - 1; }, { timeout: 2000 })
			.catch(() => assert.fail('검색창을 열면 미니맵이 그 아래로'));
		await page.keyboard.press('Escape');
		// 문법 색을 재도 문서는 그대로(편집 영역에 손대지 않음)
		assert.equal(await page.evaluate(() => window.editor().state.doc.lines), 300, '미니맵이 문서를 안 바꿈');
		console.log('Script: 코드 미니맵(막대형) 켜고 끄기·그리기·클릭 이동 passed');
	}
	// 문서가 미니맵보다 길 때(미니맵도 스크롤) 맨 끝까지 내려도 슬라이더가 미니맵 안.
	// 미니맵 높이가 홀수 px이면 반올림으로 슬라이더가 1px 삐져나가 바깥 스크롤바가 하나 더 생겼다
	{
		await page.evaluate(() => { const v = window.editor(); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: Array.from({ length: 1500 }, (_, i) => `var v${i} = ${i};`).join('\n') } }); });
		assert.equal(await page.evaluate(() => window.editor().state.doc.lines), 1500);
		// 화면 배율 125%: 높이가 소수 px가 되고 clientHeight는 반올림이라 실제보다 클 수 있다
		const viewport = page.viewport();
		for (const [scale, less] of [[1, 0], [1, 1], [1.25, 0], [1.25, 1], [1.25, 0.4], [1.25, 1.4]]) {
			if (page.viewport().deviceScaleFactor !== scale) {
				await page.setViewport({ ...viewport, deviceScaleFactor: scale });
			}
			await page.evaluate(less => { const h = document.querySelector('.tab-body:not([hidden]) .code-host'), height = Math.floor(h.getBoundingClientRect().height) - less; h.style.flex = 'none'; h.style.height = `${height}px`; }, less);
			await page.evaluate(() => { const sc = window.editor().scrollDOM; sc.scrollTop = sc.scrollHeight; });
			await new Promise(r => setTimeout(r, 400));
			const [m, s, outer] = await page.evaluate(() => {
				const mm = document.querySelector('.tab-body:not([hidden]) .cm-minimap');
				const scrolled = [...document.querySelectorAll('.tab-body:not([hidden]) *')].filter(e => !e.classList.contains('cm-scroller') && e.scrollHeight > e.clientHeight && !['visible', 'hidden'].includes(getComputedStyle(e).overflowY));
				return [mm.getBoundingClientRect().height, mm.querySelector('.cm-minimap-slider').getBoundingClientRect().bottom - mm.getBoundingClientRect().top, scrolled.map(e => e.className)];
			});
			await page.evaluate(() => { const h = document.querySelector('.tab-body:not([hidden]) .code-host'); h.style.flex = ''; h.style.height = ''; });
			assert.ok(s <= m + 0.01, `맨 끝에서 슬라이더가 미니맵 안(배율 ${scale}, 높이 ${m}): 슬라이더 끝 ${s}`);
			assert.deepEqual(outer, [], '맨 끝에서 바깥 스크롤 없음');
		}
		await page.setViewport(viewport);
		// 조금씩 내려가며 스크롤: 미니맵이 움찔거리지 않게 슬라이더 높이는 그대로, 슬라이더·그림 시작 줄은 뒤로 가지 않음
		// (걸친 줄 수가 40↔41로 바뀔 때마다 슬라이더 높이와 그림 시작 줄이 앞뒤로 튀었다)
		{
			const samples = await page.evaluate(async () => {
				const v = window.editor(), sc = v.scrollDOM, slider = document.querySelector('.tab-body:not([hidden]) .cm-minimap-slider'), out = [];
				// 맨 위·맨 끝 300px만 3px씩(전체를 훑으면 너무 오래 걸린다. 튀는 현상은 어디서나 생겼다)
				const max = sc.scrollHeight - sc.clientHeight, tops = [];
				for (let t = 0; t <= 300; t += 3) { tops.push(t); }
				for (let t = max - 300; t <= max; t += 3) { tops.push(t); }
				for (const top of tops) {
					sc.scrollTop = top;
					await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
					// 화면 맨 위 줄(소수)에서 슬라이더 자리를 빼면 미니맵 그림이 놓인 자리
					const b = v.lineBlockAtHeight(sc.scrollTop), first = v.state.doc.lineAt(b.from).number - 1 + Math.min(1, Math.max(0, (sc.scrollTop - b.top) / b.height));
					const sliderTop = parseFloat(slider.style.top);
					out.push({ top, height: slider.style.height, sliderTop, start: first - sliderTop / 2 });
				}
				return out;
			});
			assert.deepEqual([...new Set(samples.map(s => s.height))].length, 1, `슬라이더 높이 그대로: ${[...new Set(samples.map(s => s.height))]}`);
			const back = samples.find((s, i) => i && (s.sliderTop < samples[i - 1].sliderTop - 1e-6 || s.start < samples[i - 1].start - 1e-6));
			assert.equal(back, undefined, `아래로 스크롤하면 슬라이더·그림이 뒤로 안 감: ${JSON.stringify(back)}`);
		}
		console.log('Script: 긴 문서 맨 끝에서 미니맵 슬라이더가 미니맵 안 passed');
	}
	// 접은 줄은 미니맵에서도 빠진다(VS Code처럼): 접힌 곳을 지나며 스크롤해도 미니맵 그림이 접힌 줄 수만큼 툭 건너뛰지 않는다.
	// 줄마다 길이가 달라(n % 50 + 1 글자) 미니맵 줄마다 막대 길이를 읽어, 앞 프레임 그림을 몇 줄 밀면 맞는지 본다
	{
		await page.evaluate(() => {
			const lenOf = n => n % 50 + 1, v = window.editor(), lines = ['function big() {'];
			for (let n = 2; n <= 138; n++) { lines.push('x'.repeat(lenOf(n))); }
			lines.push('}');
			for (let n = 140; n <= 1500; n++) { lines.push('x'.repeat(lenOf(n))); }
			v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: lines.join('\n') }, selection: { anchor: 3 } });
			v.scrollDOM.scrollTop = 0;
			v.focus();
		});
		await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('BracketLeft'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
		await page.waitForSelector('.tab-body:not([hidden]) .cm-foldPlaceholder', { timeout: 3000 }).catch(() => assert.fail('블록 접힘'));
		// 문서를 바꾼 직후는 입력 중으로 보고 미니맵 다시 그리기를 잠깐(150ms) 미룬다 → 다 그린 뒤부터 잰다
		await new Promise(r => setTimeout(r, 400));
		const jumps = await page.evaluate(async () => {
			const v = window.editor(), sc = v.scrollDOM, canvas = document.querySelector('.tab-body:not([hidden]) .cm-minimap canvas');
			const ratio = canvas.width / canvas.clientWidth, rows = Math.floor(canvas.clientHeight / 2);
			/** 미니맵 줄(2px)마다 막대 끝(가장 오른쪽 칠한 점)의 x */
			const bars = () => {
				const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, out = [];
				for (let r = 0; r < rows; r++) {
					const y = Math.round((r * 2 + 1) * ratio);
					let right = -1;
					for (let x = canvas.width - 4 * ratio - 1; x >= 0; x--) { if (data[(y * canvas.width + x) * 4 + 3] > 0) { right = x; break; } }
					out.push(right);
				}
				return out;
			};
			const out = [];
			let before;
			for (let top = 0; top <= Math.min(4000, sc.scrollHeight - sc.clientHeight); top += 20) {
				sc.scrollTop = top;
				await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
				const now = bars();
				// 앞 그림을 0~4줄 밀어서 대부분(90%) 맞으면 이어진 움직임
				if (before && ![0, 1, 2, 3, 4].some(d => { let same = 0; for (let i = 0; i + d < rows; i++) { same += before[i + d] === now[i] ? 1 : 0; } return same >= (rows - d) * 0.9; })) {
					out.push({ top, line: v.state.doc.lineAt(v.lineBlockAtHeight(sc.scrollTop).from).number });
				}
				before = now;
			}
			return out;
		});
		assert.deepEqual(jumps.slice(0, 3), [], `접힌 곳을 지나도 미니맵 그림이 이어서 움직임: ${JSON.stringify(jumps.slice(0, 5))} 외 ${jumps.length}곳`);
		console.log('Script: 접은 줄은 미니맵에서도 빠짐 passed');
	}
}
