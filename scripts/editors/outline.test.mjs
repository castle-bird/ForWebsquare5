import assert from 'node:assert/strict';

export default async function ({ page }) {
	await page.evaluate(() => {
		window.send({ type: 'definitions', defs: [...window.testDefs, { id: 'group', ns: 'urn:test', realType: 'group', parents: [], bases: [], properties: [], events: [] }] });
	});
	// Outline 끌어 옮기기: 실제 마우스 끌기·끄는 동안 표시(선·부모 강조, 트리를 가리는 팝업 없음)·옮긴 뒤 선택·펼침. 놓을 자리 규칙은 단위 테스트(src/test/outlineDrop.test.ts)
	{
		// 정의 없는 WebSquare·XForms 태그는 Outline에 안 보여서(엔진이 무시) 시험용 네임스페이스로
		const text = '<html xmlns:t="urn:test"><head/><body>'
			+ '<t:group id="g_main" class="sub_contents"><t:wframe id="wfm_header"/><t:group id="g_sh"/><t:group id="g_ly"/></t:group><t:group id="g_tail"/></body></html>';
		await page.evaluate(text => window.send({ type: 'document', version: 200000, text, root: window.parseXml(text), script: { text: '' } }), text);
		await page.evaluate(() => window.tab('Outline', '.pane').click());
		await page.evaluate(() => [...document.querySelectorAll('.pane .codicon-expand-all')].find(b => b.offsetParent)?.click());
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row .id')].some(s => s.textContent === 'g_ly'), { timeout: 3000 })
			.catch(async () => assert.fail(`Outline에 시험 화면이 안 보임: ${await page.evaluate(() => [...document.querySelectorAll('.pane .tree-row')].map(r => r.textContent + (r.offsetParent ? '' : '(hidden)')).join(' / ') + ' | right=' + document.querySelector('.right-panel')?.getBoundingClientRect().width + ' | tabs=' + [...document.querySelectorAll('.pane [role=tab][aria-selected=true]')].map(t => t.textContent))}`));
		const ids = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.pane .tree-row[data-index]')].map(r => [r.querySelector('.id')?.textContent ?? r.querySelector('.tag').textContent, Number(r.dataset.index)])));
		const rowBox = id => page.evaluate(id => { const r = [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.id')?.textContent === id).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, id);
		/** id 줄을 잡아 to 줄의 ratio 높이로, 가로 dx만큼 끌어 놓는다. 놓기 전 표시(선·강조된 부모·팝업 유무)를 돌려준다 */
		const dragRow = async (id, to, ratio, dx = 0) => {
			const from = await rowBox(id), t = await rowBox(to);
			await page.evaluate(() => { window.sent.length = 0; });
			const sx = from.x + 60, sy = from.y + from.h / 2;
			await page.mouse.move(sx, sy); await page.mouse.down();
			await page.mouse.move(sx, sy + 8, { steps: 3 });
			await page.mouse.move(sx + dx, t.y + t.h * ratio, { steps: 8 });
			await new Promise(r => setTimeout(r, 50));
			const shown = await page.evaluate(() => ({ popup: !!document.querySelector('.tree-drag-chip'), line: !!document.querySelector('.pane .tree-drop-line'), parent: (r => r && (r.querySelector('.id') ?? r.querySelector('.tag')).textContent)(document.querySelector('.pane .tree-row.drop-parent, .pane .tree-row.drop-inside')) }));
			await page.mouse.up();
			await new Promise(r => setTimeout(r, 50));
			const sent = await page.evaluate(() => window.sent.find(m => m.type === 'move'));
			return { shown, sent: sent && { dragged: sent.dragged, target: sent.target, position: sent.position } };
		};
		// 마지막 자식(g_ly)을 형제 g_sh 아래 틈으로, 왼쪽으로 한 단계 → g_main 뒤(g_main의 형제)
		let r = await dragRow('g_ly', 'g_sh', 0.9, -20);
		assert.deepEqual(r.sent, { dragged: ids.g_ly, target: ids.g_main, position: 'after' }, '왼쪽으로 끌면 바깥 그릇 뒤로');
		assert.deepEqual(r.shown, { popup: false, line: true, parent: 'body' }, '선 + 부모(body) 강조, 팝업 없음');
		// 그릇(g_sh) 가운데 → 그 안 맨 뒤, 줄 강조(선 없음). 나머지 자리 규칙은 단위 테스트(src/test/outlineDrop.test.ts)
		r = await dragRow('wfm_header', 'g_sh', 0.5);
		assert.deepEqual(r.sent, { dragged: ids.wfm_header, target: ids.g_sh, position: 'inside' }, '그릇 가운데는 안으로');
		assert.deepEqual([r.shown.line, r.shown.parent], [false, 'g_sh'], '안으로: 그 줄 강조');
		// 옮긴 뒤(확장이 바뀐 문서를 보냄): 선택은 옮긴 노드 그대로, 펼침·접힘도 같은 노드 그대로(번호가 밀려 엉뚱한 줄이 펼쳐지지 않음)
		{
			const before = '<html xmlns:t="urn:test"><head/><body><t:group id="g_main"><t:wframe id="wfm_header"/><t:group id="g_sh"><t:input id="in_sh"/></t:group></t:group><t:group id="g_tail"><t:group id="g_in"><t:input id="in_tail"/></t:group></t:group></body></html>';
			const after = '<html xmlns:t="urn:test"><head/><body><t:group id="g_main"><t:group id="g_tail"><t:group id="g_in"><t:input id="in_tail"/></t:group></t:group><t:wframe id="wfm_header"/><t:group id="g_sh"><t:input id="in_sh"/></t:group></t:group></body></html>';
			await page.evaluate(text => window.send({ type: 'document', version: 200001, text, root: window.parseXml(text), script: { text: '' } }), before);
			await page.evaluate(() => [...document.querySelectorAll('.pane .codicon-collapse-all')].find(b => b.offsetParent)?.click());
			const row = (id, act) => page.evaluate((id, act) => { const r = [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.id')?.textContent === id); (act === 'fold' ? r.querySelector('.chevron') : r).click(); }, id, act);
			const visible = () => page.evaluate(() => [...document.querySelectorAll('.pane .tree-row .id')].map(s => s.textContent));
			// body·g_main만 펼치고 g_tail을 고른다(g_tail 안쪽 g_in은 접힌 채)
			await page.evaluate(() => document.querySelector('.pane .tree-row[data-depth="0"] .chevron').click());
			await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row .id')].some(s => s.textContent === 'g_main'));
			await row('g_main', 'fold');
			await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row .id')].some(s => s.textContent === 'g_sh'));
			await row('g_tail', 'select');
			assert.deepEqual(await visible(), ['g_main', 'wfm_header', 'g_sh', 'g_tail'], '옮기기 전: g_sh·g_tail 접힘');
			await dragRow('g_tail', 'g_main', 0.9);
			await page.evaluate(text => window.send({ type: 'document', version: 200002, text, root: window.parseXml(text), script: { text: '' } }), after);
			await new Promise(r => setTimeout(r, 200));
			assert.deepEqual(await visible(), ['g_main', 'g_tail', 'wfm_header', 'g_sh'], '옮긴 뒤에도 다른 줄이 펼쳐지지 않음');
			assert.equal(await page.$eval('.pane .tree-row.selected .id', s => s.textContent), 'g_tail', '선택은 옮긴 노드 그대로');
		}
		console.log('Outline: 실제 끌기·표시(선·부모 강조), 옮긴 뒤 선택·펼침 유지 passed');
	}
	// 긴 id·class가 만드는 가로 스크롤에서도 짧은 줄까지 배경이 끝을 채운다.
	await page.evaluate(() => {
		const long = 'long_' + 'component'.repeat(12);
		const text = '<html xmlns:t="urn:test" xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms"><head><xf:model><w2:dataCollection><w2:dataMap id="' + long + '"/><w2:dataMap id="dataShort"/></w2:dataCollection></xf:model></head><body><t:group id="' + long + '" class="' + 'layout-class '.repeat(20) + '"><t:input id="outlineShort"/></t:group></body></html>';
		window.send({ type: 'document', version: 200003, text, root: window.parseXml(text), script: { text: '' } });
	});
	for (const tab of ['Outline', 'Data']) {
		await page.evaluate(tab => window.tab(tab, '.pane').click(), tab);
		await page.evaluate(() => [...document.querySelectorAll('.pane .codicon-expand-all')].find(b => b.offsetParent)?.click());
		const id = tab === 'Outline' ? 'outlineShort' : 'dataShort';
		await page.waitForFunction(id => [...document.querySelectorAll('.pane .tree-row .id')].some(el => el.textContent === id), {}, id);
		await page.evaluate(id => [...document.querySelectorAll('.pane .tree-row')].find(row => row.querySelector('.id')?.textContent === id).click(), id);
		await page.waitForFunction(id => document.querySelector('.pane .tree-row.selected .id')?.textContent === id, {}, id);
		for (const ratio of [0, .5, 1]) {
			await page.evaluate(id => [...document.querySelectorAll('.pane .tree-row')].find(row => row.querySelector('.id')?.textContent === id).click(), id);
			await page.evaluate(ratio => { const pane = document.querySelector('.pane [role="tree"]').closest('.tab-body'); pane.scrollLeft = (pane.scrollWidth - pane.clientWidth) * ratio; }, ratio);
			const state = await page.evaluate(id => {
				const tree = document.querySelector('.pane [role="tree"]'), pane = tree.closest('.tab-body'), clip = pane.getBoundingClientRect();
				const row = [...tree.querySelectorAll('.tree-row')].find(row => row.querySelector('.id')?.textContent === id);
				return { max: pane.scrollWidth - pane.clientWidth, end: clip.left + pane.clientLeft + pane.clientWidth - 5, right: row.getBoundingClientRect().right, x: clip.left + pane.clientLeft + pane.clientWidth - 10, y: row.getBoundingClientRect().top + 12 };
			}, id);
			assert.ok(state.max > 100, tab + ': 가로 스크롤 재현');
			assert.ok(state.right >= state.end - 1, tab + ': 선택 배경이 보이는 오른쪽 끝까지 채움, scroll=' + ratio);
			await page.mouse.move(state.x, state.y);
			assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.tree-row')?.querySelector('.id')?.textContent, state), id, tab + ': 오른쪽 빈 공간도 같은 행');
			// 선택을 옮긴 후에도 오른쪽 빈 공간까지 hover가 유지된다.
			await page.evaluate(ratio => {
				const tree = document.querySelector('.pane [role="tree"]'), pane = tree.closest('.tab-body');
				[...tree.querySelectorAll('.tree-row')].find(row => row.querySelector('.id')?.textContent.startsWith('long_')).click();
				pane.scrollLeft = (pane.scrollWidth - pane.clientWidth) * ratio;
			}, ratio);
			assert.ok(await page.evaluate(id => {
				const rows = [...document.querySelectorAll('.pane .tree-row')], row = rows.find(row => row.querySelector('.id')?.textContent === id);
				return row.matches(':hover') && !row.classList.contains('selected') && rows.every(other => Math.abs(other.getBoundingClientRect().width - row.getBoundingClientRect().width) < 1);
			}, id), tab + ': hover·선택 행은 같은 전체 폭');
		}
	}
	console.log('Outline·Data: 긴 id·class, 좌·중간·우 가로 스크롤에서 hover·선택 배경 전체 폭 passed');

}
