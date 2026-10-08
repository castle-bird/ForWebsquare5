import assert from 'node:assert/strict';

export default async function ({ page }) {
	await page.evaluate(() => window.tab('Data', '.pane').click());
		// gridView 바인딩: dataList를 gridView에 떨구면 옵션 팝업 → 확인 시 bindGrid 요청
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test" xmlns:xf="http://www.w3.org/2002/xforms"><body><w2:gridView id="grd"/></body><head><xf:model><w2:dataCollection baseNode="map"><w2:dataList id="dl1"><w2:columnInfo><w2:column id="c1"/><w2:column id="c2"/></w2:columnInfo></w2:dataList></w2:dataCollection></xf:model></head></html>';
			window.sent.length = 0;
			window.send({ type: 'document', version: 80, text, root: window.parseXml(text), script: { text: '' } });
		});
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row')].some(r => r.textContent.includes('dl1'))
			|| (document.querySelector('.pane .tree-row[aria-expanded="false"] .chevron')?.click(), false));
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('[data-tag="w2:gridView"]'));
		await page.evaluate(() => {
			const dt = new DataTransfer();
			const row = [...document.querySelectorAll('.pane .tree-row')].find(r => r.textContent.includes('dl1'));
			row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, composed: true, dataTransfer: dt }));
			const grid = document.querySelector('.canvas-host').shadowRoot.querySelector('[data-tag="w2:gridView"]');
			grid.dispatchEvent(new DragEvent('dragover', { bubbles: true, composed: true, cancelable: true, dataTransfer: dt }));
			grid.dispatchEvent(new DragEvent('drop', { bubbles: true, composed: true, cancelable: true, dataTransfer: dt }));
		});
		await page.waitForSelector('.grid-bind');
		assert.equal(await page.$eval('#grid-bind-mode', el => el.value), 'new');
		await page.evaluate(() => [...document.querySelectorAll('.grid-bind-parts label')].find(l => l.textContent === 'footer').click());
		await page.$eval('.grid-bind .btn-primary', b => b.click());
		const sent = await page.evaluate(() => window.sent);
		assert.equal(sent.find(m => m.type === 'bindGrid')?.mode, 'new', JSON.stringify(sent));
		assert.deepEqual(sent.find(m => m.type === 'bindGrid').extras, { footer: true });
		await page.waitForFunction(() => !document.querySelector('.grid-bind'));
		console.log('Design: dataList → gridView 바인딩 팝업 passed');
		// 그리드 우클릭 → subTotal 추가, footer·subTotal 행이 캔버스에 그려짐
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:gridView id="grd"><w2:gBody id="b"><w2:row id="r"><w2:column id="a"/></w2:row></w2:gBody><w2:subTotal id="s"><w2:row id="sr"><w2:column id="sc" value="소계"/></w2:row></w2:subTotal><w2:footer id="f"><w2:row id="fr"><w2:column id="fc" value="합계"/></w2:row></w2:footer></w2:gridView></body></html>';
			window.sent.length = 0;
			const root = window.parseXml(text);
			root.children[0].children[0].def = 2;
			window.send({ type: 'document', version: 90, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('.w2grid .gridFooterTableDefault'));
		assert.match(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid').textContent), /소계.*합계/);
		await page.evaluate(() => {
			const cell = document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid tbody td');
			cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true, clientX: 50, clientY: 50 }));
		});
		await page.waitForSelector('.context-menu');
		assert.equal(await page.$$eval('.context-menu button', bs => bs.find(b => b.textContent === 'footer 추가').disabled), true, 'footer 있으면 footer 추가 비활성');
		assert.deepEqual(await page.$$eval('.context-menu button', bs => bs.map(b => b.textContent)), ['왼쪽에 Column 추가', '오른쪽에 Column 추가', 'Row 추가', 'Header 추가', 'subTotal 추가', 'footer 추가', '열 왼쪽으로 이동', '열 오른쪽으로 이동', '열 삭제Delete', '칸 속성 표…']);
		await page.$eval('.context-menu button:nth-child(2)', b => b.click());
		const addPart = await page.evaluate(() => window.sent.find(m => m.type === 'addGridPart'));
		assert.equal(addPart?.part, 'column');
		assert.equal(addPart?.at, 5, '우클릭한 본문 컬럼 기준');
		// 열 너비 끌기: 기준 칸(gBody 한 줄) 오른쪽 가장자리를 30px 끌면 그 컬럼 width
		await page.evaluate(() => {
			const td = document.querySelector('.canvas-host').shadowRoot.querySelector('[data-wse-resize]');
			const r = td.getBoundingClientRect();
			const at = (type, x) => td.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, button: 0, pointerId: 1, clientX: x, clientY: r.top + 5 }));
			at('pointerdown', r.right - 2); at('pointermove', r.right + 28); at('pointerup', r.right + 28);
		});
		const widthMsg = await page.evaluate(() => window.sent.find(m => m.type === 'setAttr' && m.name === 'width'));
		assert.ok(widthMsg && widthMsg.index === 5 && widthMsg.value === '100', `기본 70 + 30 = 100: ${JSON.stringify(widthMsg)}`);
		console.log('Design: 그리드 우클릭 subTotal·footer 추가·표시 passed');
		// 칸 속성 표: 우클릭 메뉴로 열고, Head(subTotal·footer)·Body 칸 속성을 고쳐 한 번에 보냄(비우면 지움)
		await page.evaluate(() => {
			window.sent.length = 0;
			document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid tbody td').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true, clientX: 50, clientY: 50 }));
		});
		await page.waitForSelector('.context-menu');
		await page.$$eval('.context-menu button', bs => bs.find(b => b.textContent === '칸 속성 표…').click());
		await page.waitForSelector('.grid-cells-editor');
		assert.deepEqual(await page.$$eval('.grid-cells-editor .segmented button', bs => bs.map(b => b.textContent)), ['SubTotal', 'Footer'], 'Head는 있는 부분만');
		assert.deepEqual(await page.$$eval('.grid-cells-editor section:last-child th', ths => ths.map(t => t.textContent)), ['행,열', 'id'], 'Body는 적힌 속성만');
		await page.$$eval('.grid-cells-editor .segmented button', bs => bs.find(b => b.textContent === 'Footer').click());
		const retype = async (label, text) => { await page.click(`.grid-cells-editor input[aria-label="${label}"]`); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.keyboard.type(text); };
		await retype('Footer 0,0 value', ''); await retype('Body 0,0 id', 'a2');
		await page.$eval('.grid-cells-editor .btn-primary', b => b.click());
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'editGridCells')?.cells.map(c => c.attrs)), [{ id: 'a2' }, { value: null }]);
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.find(m => m.type === 'editGridCells').popup, ok: true }));
		await page.waitForFunction(() => !document.querySelector('.grid-cells-editor'));
		console.log('Design: 그리드 칸 속성 표 passed');
		// 칸 속성 표 Excel처럼: 끌어 범위 → 복사(탭·줄)·붙여넣기(왼쪽 위부터, 한 값은 범위 전체)·Delete, 클릭은 입력칸 하나
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:gridView id="grd"><w2:gBody id="b"><w2:row id="r"><w2:column id="a" width="70"/><w2:column id="c" width="80"/></w2:row></w2:gBody></w2:gridView></body></html>';
			window.sent.length = 0;
			const root = window.parseXml(text);
			root.children[0].children[0].def = 2;
			window.send({ type: 'document', version: 92, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('.w2grid tbody td'));
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid tbody td').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true, clientX: 50, clientY: 50 })));
		await page.waitForSelector('.context-menu');
		await page.$$eval('.context-menu button', bs => bs.find(b => b.textContent === '칸 속성 표…').click());
		await page.waitForSelector('.grid-cells-editor input[aria-label="Body 0,1 width"]');
		const cellCenter = label => page.$eval(`.grid-cells-editor input[aria-label="${label}"]`, el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
		const [cellFrom, cellTo] = [await cellCenter('Body 0,0 id'), await cellCenter('Body 0,1 width')];
		await page.mouse.click(cellFrom.x, cellFrom.y);
		assert.deepEqual(await page.evaluate(() => [document.activeElement?.getAttribute('aria-label'), document.querySelectorAll('.grid-cells-editor td.picked').length]), ['Body 0,0 id', 0], '클릭은 입력칸 하나');
		await page.mouse.move(cellFrom.x, cellFrom.y); await page.mouse.down();
		await page.mouse.move(cellTo.x, cellTo.y, { steps: 6 }); await page.mouse.up();
		assert.deepEqual(await page.evaluate(() => [document.activeElement?.classList.contains('data-editor-table-wrap'), document.querySelectorAll('.grid-cells-editor td.picked').length]), [true, 4], '끌어 범위');
		const cellClip = (type, text) => page.evaluate((type, text) => {
			const dt = new DataTransfer();
			if (text !== undefined) { dt.setData('text/plain', text); }
			const e = new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: dt });
			// VS Code의 Ctrl+C·V는 글자 선택이 없으면 body로 보낸다(고른 컴포넌트 XML이 복사되던 버그)
			document.body.dispatchEvent(e);
			return [e.defaultPrevented, dt.getData('text/plain')];
		}, type, text);
		assert.deepEqual(await cellClip('copy'), [true, 'a\t70\nc\t80'], '범위 복사');
		assert.equal(await page.$eval('.grid-cells-editor .data-editor-body th', th => getComputedStyle(th).textAlign), 'center', '머리글 가운데');
		const values = () => page.$$eval('.grid-cells-editor section:last-child tbody input', els => els.map(e => e.value));
		await cellClip('paste', 'x\t1\ny\t2\r\n');
		assert.deepEqual(await values(), ['x', '1', 'y', '2'], '범위 붙여넣기(Excel 끝 줄바꿈 무시)');
		await cellClip('paste', 'p\tq');
		assert.deepEqual(await values(), ['p', 'q', 'p', 'q'], '한 행을 두 행 범위에 → 되풀이(Excel처럼)');
		await cellClip('paste', 'z');
		assert.deepEqual(await values(), ['z', 'z', 'z', 'z'], '한 값은 범위 전체');
		await page.keyboard.press('Delete');
		assert.deepEqual(await values(), ['', '', '', ''], 'Delete로 비움');
		// 팝업 안 되돌리기: VS Code로 키가 안 넘어가야(넘어가면 화면 XML 문서가 되돌려짐)
		await page.evaluate(() => { window.undoLeaked = 0; window.addEventListener('keydown', window.undoSpy = e => { if (e.ctrlKey && /^[zy]$/i.test(e.key)) { window.undoLeaked++; } }); });
		const press = async (key, shift) => { await page.keyboard.down('Control'); if (shift) { await page.keyboard.down('Shift'); } await page.keyboard.press(key); if (shift) { await page.keyboard.up('Shift'); } await page.keyboard.up('Control'); };
		await press('z');
		assert.deepEqual(await values(), ['z', 'z', 'z', 'z'], 'Ctrl+Z: Delete 되돌림');
		await press('z');
		assert.deepEqual(await values(), ['p', 'q', 'p', 'q'], 'Ctrl+Z 두 번');
		await press('y');
		assert.deepEqual(await values(), ['z', 'z', 'z', 'z'], 'Ctrl+Y 다시 하기');
		await page.mouse.click(cellFrom.x, cellFrom.y); await page.keyboard.type('ab');
		assert.equal((await values())[0], 'zab');
		await press('z');
		assert.equal((await values())[0], 'z', '이어 친 글자는 한 단계로 되돌림');
		await press('z', true);
		assert.equal((await values())[0], 'zab', 'Ctrl+Shift+Z 다시 하기');
		await press('z'); await press('z'); await press('z');
		assert.deepEqual(await page.evaluate(() => { window.removeEventListener('keydown', window.undoSpy); return window.undoLeaked; }), 0, '되돌리기 키가 VS Code로 안 넘어감');
		await page.mouse.click(cellFrom.x, cellFrom.y);
		assert.deepEqual(await cellClip('paste', 'q'), [false, 'q'], '입력칸 하나에 한 값은 입력칸이 받음');
		await page.keyboard.down('Shift'); await page.mouse.click(cellTo.x, cellTo.y); await page.keyboard.up('Shift');
		assert.equal(await page.evaluate(() => document.querySelectorAll('.grid-cells-editor td.picked').length), 4, 'Shift+클릭 범위');
		// 표를 좁혀 가린 칸이 생기게 한 뒤 오른쪽 아래 바깥으로 끌면 상하좌우로 굴리며 가려진 칸까지 고름
		const wrapBox = await page.$eval('.grid-cells-editor section:last-child .data-editor-table-wrap', w => {
			w.style.maxWidth = '150px'; w.style.maxHeight = '62px'; w.scrollLeft = w.scrollTop = 0;
			const r = w.getBoundingClientRect(); return { right: r.right, bottom: r.bottom };
		});
		const first = await cellCenter('Body 0,0 id');
		await page.mouse.move(first.x, first.y); await page.mouse.down();
		await page.mouse.move(wrapBox.right + 30, wrapBox.bottom + 30, { steps: 6 });
		await page.waitForFunction(() => { const w = document.querySelector('.grid-cells-editor section:last-child .data-editor-table-wrap'); return w.scrollLeft > 0 && w.scrollTop > 0 && document.querySelectorAll('.grid-cells-editor td.picked').length === 4; }, { timeout: 3000 })
			.catch(() => assert.fail('끌기 자동 스크롤·가려진 칸 고르기 안 됨'));
		await page.mouse.up();
		await page.$eval('.grid-cells-editor section:last-child .data-editor-table-wrap', w => { w.style.maxWidth = w.style.maxHeight = ''; });
		await page.$eval('.grid-cells-editor .btn-secondary', b => b.click());
		await page.waitForFunction(() => !document.querySelector('.grid-cells-editor'));
		console.log('Design: 그리드 칸 속성 표 범위 복사·붙여넣기 passed');
}
