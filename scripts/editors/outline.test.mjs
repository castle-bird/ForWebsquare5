import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';

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
	// 방향키: 줄을 클릭한 뒤 ↑↓는 스크롤이 아니라 선택 이동, →는 펼치기·첫 자식, ←는 접기·부모, Home·End는 처음·끝
	{
		const text = '<html xmlns:t="urn:test"><head/><body><t:group id="k_a"><t:wframe id="k_a1"/></t:group><t:group id="k_b"/></body></html>';
		await page.evaluate(text => window.send({ type: 'document', version: 300000, text, root: window.parseXml(text), script: { text: '' } }), text);
		await page.evaluate(() => window.tab('Outline', '.pane').click());
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row .id')].some(s => s.textContent === 'k_b'));
		const row = id => page.evaluate(id => { const r = [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.id')?.textContent === id).getBoundingClientRect(); return { x: r.x + 40, y: r.y + r.height / 2 }; }, id);
		const picked = () => page.evaluate(() => { const r = document.querySelector('.pane .tree-row.selected'); return r && (r.querySelector('.id')?.textContent ?? r.querySelector('.tag').textContent); });
		const expanded = id => page.evaluate(id => [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.id')?.textContent === id)?.getAttribute('aria-expanded'), id);
		const press = async key => { await page.keyboard.press(key); await new Promise(r => setTimeout(r, 30)); };
		const at = await row('k_a');
		await page.mouse.click(at.x, at.y);
		assert.equal(await picked(), 'k_a');
		// 앞 시나리오에서 모두 펼치기를 눌러 k_a는 펼쳐진 채로 시작한다
		await press('ArrowDown');
		assert.equal(await picked(), 'k_a1', '↓: 펼친 k_a의 첫 자식');
		await press('ArrowUp');
		assert.equal(await picked(), 'k_a', '↑');
		await press('ArrowLeft');
		assert.deepEqual([await expanded('k_a'), await picked()], ['false', 'k_a'], '←: 펼친 줄은 접음');
		await press('ArrowDown');
		assert.equal(await picked(), 'k_b', '↓: 접힌 k_a의 다음 줄');
		await press('ArrowUp');
		assert.equal(await picked(), 'k_a');
		await press('ArrowRight');
		assert.deepEqual([await expanded('k_a'), await picked()], ['true', 'k_a'], '→: 접힌 줄은 펼침(선택 그대로)');
		await press('ArrowRight');
		assert.equal(await picked(), 'k_a1', '→: 펼친 줄은 첫 자식');
		await press('ArrowLeft');
		assert.equal(await picked(), 'k_a', '←: 자식 없는 줄은 부모');
		await press('End');
		assert.equal(await picked(), 'k_b', 'End');
		await press('Home');
		assert.equal(await picked(), 'body', 'Home: 맨 위 줄(끌기 속성이 없는 줄)에서도 이어서 이동');
		await press('ArrowDown');
		assert.equal(await picked(), 'k_a', '맨 위 줄에서 ↓');
		// Enter·Space는 펼치기·접기(키보드로는 옮기지 않는다)
		await page.evaluate(() => { window.sent.length = 0; });
		await press('Enter');
		assert.equal(await expanded('k_a'), 'false', 'Enter: 접기');
		await press(' ');
		assert.equal(await expanded('k_a'), 'true', 'Space: 펼치기');
		await press('ArrowDown');
		assert.equal(await picked(), 'k_a1', 'Space 뒤 ↓는 끌기가 아니라 선택 이동');
		await press('Enter');
		assert.equal(await picked(), 'k_a1', '자식 없는 줄의 Enter는 아무 일 없음');
		assert.ok(!await page.evaluate(() => window.sent.some(m => m.type === 'move')), '키보드로는 컴포넌트가 옮겨지지 않음');
		console.log('Outline: 방향키 선택 이동·펼치기·접기 passed');
		// Shift+클릭: 지금 고른 줄(기준)부터 누른 줄까지 보이는 줄을 모두 고른다(기준은 그대로 주 선택)
		const selectedIds = () => page.evaluate(() => [...document.querySelectorAll('.pane .tree-row.selected')].map(r => r.querySelector('.id')?.textContent ?? r.querySelector('.tag').textContent));
		const shiftClick = async id => { const p = await row(id); await page.keyboard.down('Shift'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Shift'); };
		const plain = await row('k_a');
		await page.mouse.click(plain.x, plain.y);
		await shiftClick('k_b');
		assert.deepEqual(await selectedIds(), ['k_a', 'k_a1', 'k_b'], 'Shift+클릭: 사이의 줄 모두');
		await shiftClick('k_a1');
		assert.deepEqual(await selectedIds(), ['k_a', 'k_a1'], '기준(k_a)은 그대로, 범위만 바뀜');
		await page.mouse.click(plain.x, plain.y);
		assert.deepEqual(await selectedIds(), ['k_a'], '그냥 클릭은 하나만');
		console.log('Outline: Shift+클릭 범위 선택 passed');
	}
	// 트리 검색: id·태그·class에 맞는 줄과 조상만 남고(일치 글자 강조), Esc로 지우면 원래대로, Enter로 첫 결과 선택, 검색 중에는 끌어 옮기지 않는다
	{
		const text = '<html xmlns:t="urn:test"><head/><body><t:group id="s_top" class="wrap"><t:wframe id="s_frame"/><t:group id="s_inner"><t:input id="s_save" class="btn primary"/><t:input id="s_cancel"/></t:group></t:group><t:group id="s_other"/></body></html>';
		await page.evaluate(text => window.send({ type: 'document', version: 400000, text, root: window.parseXml(text), script: { text: '' } }), text);
		await page.evaluate(() => window.tab('Outline', '.pane').click());
		await page.evaluate(() => [...document.querySelectorAll('.pane .codicon-expand-all')].find(b => b.offsetParent)?.click());
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row .id')].some(s => s.textContent === 's_cancel'));
		const input = '.pane .tab-body:not([hidden]) .tree-search input';
		const rows = () => page.evaluate(() => [...document.querySelectorAll('.pane .tab-body:not([hidden]) .tree-row')].map(r => r.querySelector('.id')?.textContent ?? r.querySelector('.tag').textContent));
		const marks = () => page.evaluate(() => [...document.querySelectorAll('.pane .tree-row mark.tree-hit')].map(m => m.textContent));
		const rowsAre = async (expected, message) => {
			await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('.pane .tab-body:not([hidden]) .tree-row')].map(r => r.querySelector('.id')?.textContent ?? r.querySelector('.tag').textContent)) === JSON.stringify(expected), { timeout: 3000 }, expected)
				.catch(async () => assert.fail(`${message}: ${await rows()}`));
		};
		await page.click(input);
		await page.keyboard.type('save');
		await rowsAre(['body', 's_top', 's_inner', 's_save'], '맞는 줄과 조상만');
		assert.deepEqual(await marks(), ['save'], '일치 글자 강조');
		await page.keyboard.press('Escape');
		await rowsAre(['body', 's_top', 's_frame', 's_inner', 's_save', 's_cancel', 's_other'], 'Esc로 지우면 전체');
		assert.equal(await page.$eval(input, i => i.value), '');
		await page.keyboard.type('PRIMARY');
		await rowsAre(['body', 's_top', 's_inner', 's_save'], 'class로도, 대소문자 무시');
		// 강조 모양은 어디서나 같다: id·class(연한 글자) 안에서도 같은 색·같은 진하기(선택 안 된 줄 기준)
		await page.keyboard.press('Escape');
		await page.keyboard.type('p');
		await page.waitForFunction(() => document.querySelectorAll('.pane .tree-row mark.tree-hit').length > 2);
		const look = await page.evaluate(() => [...document.querySelectorAll('.pane .tree-row:not(.selected) mark.tree-hit')].map(m => {
			let opacity = 1;
			for (let e = m; e && !e.classList.contains('tree-row'); e = e.parentElement) { opacity *= Number(getComputedStyle(e).opacity); }
			return { where: m.parentElement.className, color: getComputedStyle(m).color, background: getComputedStyle(m).backgroundColor, opacity };
		}));
		assert.ok(look.some(l => l.where === 'cls') && look.some(l => l.where === 'id'), `id·class 모두 강조: ${JSON.stringify(look)}`);
		assert.ok(look.every(l => l.opacity === 1 && l.color === look[0].color && l.background === look[0].background), `강조가 일정함: ${JSON.stringify(look)}`);
		await page.keyboard.press('Escape');
		await page.keyboard.type('btn nothing');
		await page.waitForSelector('.pane .tab-body:not([hidden]):has(.tree-search) .empty');
		assert.equal(await page.$eval('.pane .tab-body:not([hidden]):has(.tree-search) .empty .empty-text', e => e.textContent), '검색 결과 없음', '낱말이 모두 맞아야 함');
		// 빈 상태 안내: 검색 아이콘(Codicon) + 문구 + Esc 안내, 가운데 정렬
		assert.deepEqual(await page.$eval('.pane .tab-body:not([hidden]):has(.tree-search) .empty', e => ({ icon: e.querySelector('.codicon-search') && getComputedStyle(e.querySelector('.codicon')).fontFamily, hint: e.querySelector('.empty-hint')?.textContent, align: getComputedStyle(e).alignItems })),
			{ icon: 'codicon', hint: 'Esc로 검색을 지울 수 있습니다', align: 'center' }, '빈 상태 안내 모양');
		await page.screenshot({ path: path.join(tmpdir(), 'ws5-empty-search.png'), clip: await page.$eval('.pane .tab-body:not([hidden]):has(.tree-search) .empty', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: Math.max(0, r.y - 50), width: Math.min(r.width, 340), height: r.height + 60, scale: 2 }; }) });
		assert.deepEqual(await rows(), []);
		await page.keyboard.press('Escape');
		// Enter: 첫 결과를 고르고 트리로 포커스가 넘어가 방향키가 (걸러진) 줄을 옮긴다
		await page.keyboard.type('cancel');
		await rowsAre(['body', 's_top', 's_inner', 's_cancel'], 'cancel');
		await page.keyboard.press('Enter');
		await page.waitForFunction(() => document.querySelector('.pane .tree-row.selected .id')?.textContent === 's_cancel');
		assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'tree', '트리로 포커스');
		await page.keyboard.press('ArrowUp');
		await page.waitForFunction(() => document.querySelector('.pane .tree-row.selected .id')?.textContent === 's_inner');
		// 검색 중에는 끌어 옮기지 않는다
		const center = id => page.evaluate(id => { const r = [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.id')?.textContent === id).getBoundingClientRect(); return { x: r.x + 60, y: r.y + r.height / 2 }; }, id);
		const from = await center('s_cancel'), to = await center('s_top');
		await page.evaluate(() => { window.sent.length = 0; });
		await page.mouse.move(from.x, from.y); await page.mouse.down();
		await page.mouse.move(from.x, from.y + 8, { steps: 3 });
		await page.mouse.move(to.x, to.y, { steps: 8 });
		await page.mouse.up();
		await new Promise(resolve => setTimeout(resolve, 50));
		assert.ok(!await page.evaluate(() => window.sent.some(m => m.type === 'move')), '검색 중에는 끌어 옮기지 않음');
		// 검색 중 아무것도 안 눌렀을 때 입력칸 키는 트리 단축키가 아니다(F2로 id 칸이 열리지 않음)
		await page.click(input);
		await page.keyboard.press('F2');
		assert.equal(await page.$('.pane .tree-rename'), null, '검색칸의 F2는 트리 id 바꾸기가 아님');
		await page.keyboard.press('Escape');
		console.log('Outline: 검색(id·태그·class, 강조, Esc·Enter, 끌기 쉼) passed');
	}
	// Data 트리 검색: 이름(name)으로도 찾고, 찾은 줄을 고른 뒤 검색을 지우면 접힌 곳에 숨지 않고 그 줄까지 펼친다
	{
		const text = '<html xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms"><head><xf:model><w2:dataCollection><w2:dataMap id="dma_a"><w2:keyInfo><w2:key id="k_one" name="첫째"/></w2:keyInfo></w2:dataMap><w2:dataList id="dlt_b"><w2:columnInfo><w2:column id="c_two" name="둘째"/></w2:columnInfo></w2:dataList></w2:dataCollection></xf:model></head><body/></html>';
		await page.evaluate(text => window.send({ type: 'document', version: 400001, text, root: window.parseXml(text), script: { text: '' } }), text);
		await page.evaluate(() => window.tab('Data', '.pane').click());
		await page.evaluate(() => [...document.querySelectorAll('.pane .codicon-collapse-all')].find(b => b.offsetParent)?.click());
		const input = '.pane .tab-body:not([hidden]) .tree-search input';
		const rows = () => page.evaluate(() => [...document.querySelectorAll('.pane .tab-body:not([hidden]) .tree-row')].map(r => r.querySelector('.id')?.textContent ?? r.querySelector('.tag').textContent));
		await page.waitForSelector(input);
		await page.click(input);
		await page.keyboard.type('둘째');
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tab-body:not([hidden]) .tree-row .id')].some(s => s.textContent === 'c_two'), { timeout: 3000 })
			.catch(async () => assert.fail(`Data 이름 검색: ${await rows()}`));
		assert.deepEqual(await rows(), ['w2:dataCollection', 'dlt_b', 'w2:columnInfo', 'c_two'], '이름이 맞은 키·컬럼과 조상만');
		await page.evaluate(() => [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.id')?.textContent === 'c_two').click());
		await page.keyboard.press('Escape');
		await page.waitForFunction(() => document.querySelector('.pane .tab-body:not([hidden]) .tree-row.selected .id')?.textContent === 'c_two', { timeout: 3000 })
			.catch(async () => assert.fail(`검색을 지운 뒤 선택한 줄이 보여야 함: ${await rows()}`));
		console.log('Data: 트리 검색(이름)·지운 뒤 선택 줄 펼침 passed');
	}
	// 들여쓰기 안내선: 깊이만큼 부모 쉐브론 아래로 세로선(깊이 0은 없음), 트리 위에 마우스를 올리면 진해진다
	{
		const text = '<html xmlns:t="urn:test"><head/><body><t:group id="gd_1"><t:group id="gd_2"><t:group id="gd_3"><t:input id="gd_4"/></t:group></t:group></t:group></body></html>';
		await page.evaluate(text => window.send({ type: 'document', version: 400002, text, root: window.parseXml(text), script: { text: '' } }), text);
		await page.evaluate(() => window.tab('Outline', '.pane').click());
		await page.evaluate(() => [...document.querySelectorAll('.pane .codicon-expand-all')].find(b => b.offsetParent)?.click());
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row .id')].some(s => s.textContent === 'gd_4'));
		const guides = () => page.evaluate(() => [...document.querySelectorAll('.pane [role="tree"] .tree-row')].map(r => {
			const s = getComputedStyle(r, '::before');
			return { depth: Number(r.dataset.depth), width: s.width, left: s.left, lines: s.backgroundImage.startsWith('repeating-linear-gradient'), color: s.backgroundImage };
		}));
		assert.deepEqual(await page.$$eval('.pane [role="tree"] .tree-row:not([aria-expanded="false"]) .chevron:not(.hidden)', es => [...new Set(es.map(e => getComputedStyle(e).fontFamily + ' ' + e.className.includes('codicon-chevron-down')))]), ['codicon true'], '펼침 화살표는 VS Code Codicon(펼침: 아래)');
		await page.mouse.move(2, 2);
		const idle = await guides();
		assert.deepEqual(idle.map(g => [g.depth, g.width]), idle.map(g => [g.depth, `${g.depth * 10}px`]), '안내선 너비는 깊이 × 들여쓰기');
		assert.ok(idle.length >= 5 && idle.every(g => g.lines && g.left === '12px'), '모든 줄에 안내선 배경');
		const row = await page.evaluate(() => { const r = [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.id')?.textContent === 'gd_3').getBoundingClientRect(); return { x: r.x + 80, y: r.y + r.height / 2 }; });
		await page.mouse.move(row.x, row.y);
		const hover = await guides();
		assert.notEqual(hover[2].color, idle[2].color, '트리 위에 마우스를 올리면 안내선이 진해짐');
		await page.screenshot({ path: path.join(tmpdir(), 'ws5-tree-guides.png'), clip: await page.$eval('.pane [role="tree"]', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: Math.min(r.width, 160), height: Math.min(r.height, 130), scale: 3 }; }) });
		console.log('Outline: 들여쓰기 안내선 passed');
	}

}
