import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';

export default async function ({ page, pickProperty }) {
	// 고른 컴포넌트가 없으면 Property·Event 탭은 빈 상태 안내(빈 칸으로 두지 않음)
	await page.waitForSelector('.pane .tab-body:not([hidden]) .empty');
	assert.deepEqual(await page.$eval('.pane .tab-body:not([hidden]) .empty', e => ({ text: e.querySelector('.empty-text').textContent, icon: !!e.querySelector('.codicon-inspect'), hint: e.querySelector('.empty-hint').textContent })),
		{ text: '선택한 컴포넌트 없음', icon: true, hint: 'Design·Outline에서 고르면 여기에 보입니다' });
	// 스크롤바: VS Code처럼 10px(테마 scrollbarSlider 색)
	assert.equal(await page.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;width:100px;height:100px;overflow:scroll'; document.body.append(d); const w = d.offsetWidth - d.clientWidth; d.remove(); return w; }), 10, '스크롤바 폭 10px');
	// 연결 화면(wframe) 안쪽 더블클릭 → 그 화면 열기 요청, 문구 편집 입력칸은 안 열림
	const inner = await page.evaluate(() => {
		const root = document.querySelector('.canvas-host').shadowRoot;
		const r = root.querySelector('[data-wse-frame] input').getBoundingClientRect();
		return { x: r.x + 5, y: r.y + r.height / 2, frame: Number(root.querySelector('[data-wse-frame]').getAttribute('data-wse')) };
	});
	await page.mouse.click(inner.x, inner.y, {count:2});
	await page.waitForFunction(() => window.sent.some(m => m.type === 'openFrame'));
	assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'openFrame')), { type: 'openFrame', index: inner.frame });
	assert.equal(await page.evaluate(() => !!document.querySelector('.canvas-host').shadowRoot.querySelector('.edit')), false);
	console.log('Frame: 더블클릭 → 연결 화면 열기 passed');
	// 패널 구분선: 두께 1px(라이브러리 inline flex에 안 묻힘), 선 옆 3px을 잡아도 끌린다
	assert.deepEqual(await page.$$eval('.resizer', es => es.map(e => Math.min(e.offsetWidth, e.offsetHeight))), [1, 1]);
	const split = await page.$eval('.resizer[aria-orientation="vertical"]', e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top + 200 }; });
	const canvasWidth = () => page.$eval('.canvas-frame', e => e.offsetWidth);
	const canvasBefore = await canvasWidth();
	await page.mouse.move(split.x + 3, split.y); await page.mouse.down();
	await page.mouse.move(split.x - 97, split.y, {steps:5}); await page.mouse.up();
	assert.ok(Math.abs(await canvasWidth() - (canvasBefore - 100)) <= 3, `패널 너비: ${canvasBefore} → ${await canvasWidth()}`);
	console.log('Split: 두께·잡는 범위 passed');
	// Property 값: 정의에 정해진 값 목록이 있어도 입력칸 + 목록. 고르면 바로 반영, 목록 밖 값도 입력
	await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('input[data-wse]'));
	await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('input[data-wse]').click());
	await page.evaluate(() => { window.sent.length = 0; });
	await pickProperty(page, 'disabled', 'true');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'disabled' && m.value === 'true'));
	await page.evaluate(() => [...document.querySelectorAll('.kv tr')].find(tr => tr.querySelector('.key')?.textContent === 'disabled').querySelector('.value').click());
	await page.waitForSelector('.kv input[role="combobox"]');
	await page.$eval('.kv input[role="combobox"]', i => i.select());
	await page.keyboard.type('custom'); await page.keyboard.press('Enter');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'disabled' && m.value === 'custom'));
	console.log('Property: 정해진 값 입력칸 + 목록 passed');
	// Key 도움말: 누른 칸 왼쪽에 붙고(floating-ui) 화면 안, Esc로 닫힘
	await page.evaluate(() => [...document.querySelectorAll('.kv td.key')].find(td => td.textContent === 'label').click());
	await page.waitForFunction(() => { const h = document.querySelector('.help'); return h && getComputedStyle(h).visibility === 'visible'; });
	const helpBox = await page.evaluate(() => {
		const h = document.querySelector('.help').getBoundingClientRect(), k = [...document.querySelectorAll('.kv td.key')].find(td => td.textContent === 'label').getBoundingClientRect();
		return { right: h.right, left: h.left, top: h.top, bottom: h.bottom, keyLeft: k.left, keyTop: k.top, text: document.querySelector('.help').textContent };
	});
	assert.equal(helpBox.text, 'label화면에 보이는 글자');
	assert.ok(Math.abs(helpBox.right - (helpBox.keyLeft - 6)) <= 1 && Math.abs(helpBox.top - helpBox.keyTop) <= 1, `도움말이 Key 칸 왼쪽: ${JSON.stringify(helpBox)}`);
	assert.ok(helpBox.left >= 0 && helpBox.bottom <= await page.evaluate(() => innerHeight), '도움말이 화면 안');
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => !document.querySelector('.help'));
	console.log('Property: Key 도움말 자리 passed');
	// 도움말 설명 속 예제 코드: 코드 상자(가로 스크롤·고정폭)로 나뉘고, 코드가 있으면 넓어지며, `|`만 있는 줄은 안 보인다
	await page.evaluate(() => {
		const description = '설명 글\n |(옵션 설명)\n | "a" : 첫째\n |\n |(예제)\n | scwin.fn = function(){\n |    return 1; // 아주 긴 줄을 만들어 가로 스크롤이 생기게 한다 아주 긴 줄을 만들어 가로 스크롤이 생기게 한다 아주 긴 줄을 만들어 가로 스크롤이 생기게 한다\n |\n | }';
		window.send({ type: 'definitions', defs: [{ ...window.testDefs[0], properties: [...window.testDefs[0].properties, { name: 'sample', category: '', order: 0, description }] }, ...window.testDefs.slice(1)] });
	});
	await page.waitForFunction(() => [...document.querySelectorAll('.kv td.key')].some(td => td.textContent === 'sample'));
	await page.evaluate(() => [...document.querySelectorAll('.kv td.key')].find(td => td.textContent === 'sample').click());
	await page.waitForSelector('.help .help-code');
	const code = await page.evaluate(() => {
		const h = document.querySelector('.help'), pre = h.querySelector('.help-code');
		return { text: pre.textContent, white: getComputedStyle(pre).whiteSpace, overflowX: getComputedStyle(pre).overflowX, scrolls: pre.scrollWidth > pre.clientWidth, width: h.getBoundingClientRect().width, inside: h.getBoundingClientRect().right <= innerWidth,
			headings: [...h.querySelectorAll('.help-heading')].map(e => e.textContent), all: h.textContent };
	});
	assert.equal(code.text.split('\n')[0], 'scwin.fn = function(){', '`|` 접두 없이 코드만');
	assert.deepEqual([code.white, code.overflowX, code.scrolls], ['pre', 'auto', true], '줄바꿈 없이 가로 스크롤');
	assert.deepEqual(code.headings, ['(옵션 설명)', '(예제)']);
	assert.ok(code.width > 440 && code.width <= 600 && code.inside, `코드가 있으면 넓고 화면 안: ${code.width}`);
	assert.ok(!code.all.includes('|'), '`|` 기호는 남지 않음');
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => !document.querySelector('.help'));
	console.log('Property: 도움말 코드 상자 passed');
	// Style 칸: Shift+Enter는 줄바꿈(반영 안 함), Enter로 반영하고 입력칸에서 나옴
	const styleBox = selector => page.$eval(selector, e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return [r.top, r.left, r.width, s.marginTop, s.paddingTop, s.paddingLeft, s.lineHeight, s.fontSize, s.fontFamily, s.borderTopWidth, s.borderRadius, s.whiteSpace, s.wordBreak]; });
	const viewing = await styleBox('.style-area .style-value');
	await page.click('.style-area .style-value');
	await page.waitForSelector('.style-area textarea');
	assert.deepEqual(await styleBox('.style-area textarea'), viewing, '편집을 시작해도 상자 자리·여백·글꼴이 그대로(글자가 튀지 않음)');
	assert.equal(viewing[10], '6px', 'Style 상자 모서리는 검색칸과 같은 6px');
	await page.keyboard.type('width:1px;');
	await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
	await page.keyboard.type('height:2px;');
	assert.equal(await page.$eval('.style-area textarea', el => el.value), 'width:1px;\nheight:2px;');
	assert.ok(!await page.evaluate(() => window.sent.some(m => m.name === 'style')), 'Shift+Enter로는 반영 안 함');
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'style' && m.value === 'width:1px;\nheight:2px;'));
	assert.equal(await page.$('.style-area textarea'), null, 'Enter로 닫힘');
	assert.ok(!await page.evaluate(() => document.activeElement?.closest('.style-area')?.matches('textarea')), '입력칸에서 나옴');
	console.log('Style: Shift+Enter 줄바꿈·Enter 반영 passed');
	// class 값: 화면에 적용된 CSS의 클래스가 목록으로 뜬다(타이핑 중인 마지막 낱말 기준·앞 글자가 같은 것 먼저·앞쪽에 쓴 것은 뺌). 고르면 그 낱말만 넣고 Enter로 반영
	await page.evaluate(() => {
		const [input, ...others] = window.testDefs;
		window.send({ type: 'definitions', defs: [{ ...input, properties: [...input.properties, { name: 'class', category: '', order: 0, description: '' }] }, ...others] });
		// 아주 긴 이름이 있어 처음엔 넓은 목록이 화면 왼쪽으로 밀려 붙는다
		const rules = ['.btn', '.btn:hover', 'a[href$=".pdf"]', '.primary .icon', '.btn-lg', '.5', `.${'long_'.repeat(40)}`].map(selector => ({ file: 'a.css', line: 0, ch: 0, selector, match: selector, media: [], supports: [] }));
		window.send({ type: 'styles', css: [], rules });
	});
	await page.waitForFunction(() => [...document.querySelectorAll('.kv td.key')].some(td => td.textContent === 'class'));
	await page.evaluate(() => { window.sent.length = 0; [...document.querySelectorAll('.kv tr')].find(tr => tr.querySelector('.key')?.textContent === 'class').querySelector('.value').click(); });
	await page.waitForSelector('.kv input[role="combobox"]');
	const classOptions = () => page.$$eval('.combo-list li', items => items.map(li => li.textContent));
	const classValue = () => page.$eval('.kv input[role="combobox"]', input => input.value);
	const long = 'long_'.repeat(40);
	assert.deepEqual(await classOptions(), ['btn', 'btn-lg', 'icon', long, 'primary'], '열면 화면 CSS의 클래스 전체(속성 선택자·숫자는 제외)');
	const edges = () => page.evaluate(() => ({ list: Math.round(document.querySelector('.combo-list').getBoundingClientRect().left), input: Math.round(document.querySelector('.kv input[role="combobox"]').getBoundingClientRect().left) }));
	const wide = await edges();
	assert.ok(wide.list < wide.input - 5, `긴 이름 때문에 넓은 목록은 왼쪽으로 밀려 있음: ${JSON.stringify(wide)}`);
	await page.keyboard.type('btn');
	assert.deepEqual(await classOptions(), ['btn', 'btn-lg'], '타이핑한 글자로 거름');
	// 목록이 좁아지면 자리를 다시 잡아 입력칸 왼쪽에 붙는다(넓을 때 밀린 자리가 남지 않음)
	await page.waitForFunction(() => Math.abs(document.querySelector('.combo-list').getBoundingClientRect().left - document.querySelector('.kv input[role="combobox"]').getBoundingClientRect().left) <= 1, { timeout: 3000 })
		.catch(async () => assert.fail(`좁아진 목록 자리: ${JSON.stringify(await edges())}`));
	await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
	assert.equal(await classValue(), 'btn', '고른 낱말이 입력칸에 들어감');
	assert.ok(!await page.evaluate(() => window.sent.some(m => m.name === 'class')), '고르기만으로는 반영 안 함(이어서 입력)');
	await page.keyboard.type(' ');
	assert.deepEqual(await classOptions(), ['btn-lg', 'icon', long, 'primary'], '앞쪽에 쓴 클래스는 목록에서 뺌');
	await page.keyboard.type('pri');
	assert.deepEqual(await classOptions(), ['primary'], '마지막 낱말로만 거름');
	await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
	assert.equal(await classValue(), 'btn primary', '마지막 낱말만 바뀜');
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'class' && m.value === 'btn primary'));
	console.log('Property: class 값 자동완성(화면 CSS 클래스) passed');
	// Property 표 Key 열 너비: 머리 칸 손잡이를 끌면 바뀌고 Event 탭에도 유지된다
	await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('input[data-wse]'));
	await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('input[data-wse]').click());
	const handle = await page.waitForSelector('.kv-wrap > .col-resizer');
	const box = await handle.boundingBox();
	const keyWidth = () => page.$eval('.kv th', e => e.offsetWidth);
	const before = await keyWidth();
	const rowY = await page.$eval('.kv tbody tr:not(.category) td', e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }); // 머리 칸이 아닌 td 줄에서 끌기
	await page.mouse.move(box.x + 2, rowY); await page.mouse.down();
	await page.mouse.move(box.x + 42, rowY, {steps:5}); await page.mouse.up();
	// 마우스를 놓은 직후엔 마지막 pointermove 렌더가 아직일 수 있어 기다린다(바로 읽으면 가끔 32px만 반영돼 보였다)
	await page.waitForFunction(w => Math.abs(document.querySelector('.kv th').offsetWidth - w) <= 2, {timeout: 2000}, before + 40)
		.catch(async () => assert.fail(`Key 열 너비: ${before} → ${await keyWidth()}`));
	const resized = await keyWidth();
	await page.evaluate(() => window.tab('Event', '.pane').click());
	assert.equal(await keyWidth(), resized, 'Event 탭에도 너비 유지');
	// Event 값 옆 script 버튼: 핸들러 이름을 속성에 채우고 Script 탭으로 넘어간다
	await page.evaluate(() => { window.sent.length = 0; });
	await page.click('.kv .script-btn');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'ev:onclick' && m.value === 'scwin.ipt_name_onclick'));
	console.log('Event: script 버튼 → 핸들러 연결 passed');
	console.log('Property: Key 열 너비 조절 passed');
	// 표 모양: 카테고리 머리는 24px 줄의 작은 대문자 라벨, 값이 있는 행은 Key 칸 왼쪽에 강조선, 행 구분선은 머리선보다 옅다
	await page.evaluate(() => {
		window.tab('Property', '.pane').click();
		const [input, ...others] = window.testDefs;
		const properties = [{ name: 'label', category: 'Basic', order: 0, description: '' }, { name: 'disabled', category: 'Basic', order: 0, description: '', options: ['true', 'false'] }, { name: 'tooltip', category: 'Display', order: 1, description: '' }];
		window.send({ type: 'definitions', defs: [{ ...input, properties }, ...others] });
	});
	await page.waitForSelector('.kv tr.category');
	const look = await page.evaluate(() => {
		const head = document.querySelector('.kv tr.category th'), set = document.querySelector('.kv tr.set td:first-child'), plain = document.querySelector('.kv tbody tr:not(.set):not(.category) td:first-child');
		const line = e => getComputedStyle(e).borderBottomColor, h = getComputedStyle(head);
		const arrow = head.querySelector('.chevron'), range = document.createRange();
		range.selectNodeContents(head.lastChild);
		const center = r => (r.top + r.bottom) / 2;
		return { arrowFont: getComputedStyle(arrow).fontFamily, arrowClass: arrow.className, gap: Math.abs(center(arrow.getBoundingClientRect()) - center(range.getBoundingClientRect())), height: head.getBoundingClientRect().height, transform: h.textTransform, size: h.fontSize, accent: set && getComputedStyle(set).boxShadow, plainAccent: plain && getComputedStyle(plain).boxShadow, rowLine: line(plain), headLine: line(document.querySelector('.kv thead th')) };
	});
	assert.ok(look.height >= 23 && look.height <= 26, `카테고리 머리 높이: ${look.height}`);
	assert.deepEqual([look.transform, look.size], ['uppercase', '11px']);
	assert.ok(look.arrowFont === 'codicon' && look.arrowClass.includes('codicon-chevron-down'), `펼침 화살표는 VS Code Codicon: ${look.arrowFont} ${look.arrowClass}`);
	assert.ok(look.gap <= 1.5, `화살표와 글자의 세로 가운데가 맞음: ${look.gap}`);
	assert.ok(look.accent?.includes('inset') && look.plainAccent === 'none', `값이 있는 행만 강조선: ${look.accent} / ${look.plainAccent}`);
	assert.notEqual(look.rowLine, look.headLine, '행 구분선은 머리선보다 옅다');
	// 검색칸: Key·Value 선택과 입력칸이 같은 높이·글꼴·글자색·배경·모서리, Outline·Data 검색칸과도 같은 높이·모양
	const search = await page.evaluate(() => {
		const style = e => { const s = getComputedStyle(e); return [Math.round(e.getBoundingClientRect().height), s.fontFamily, s.fontSize, s.color, s.backgroundColor, s.borderRadius, s.borderTopColor]; };
		return { select: style(document.querySelector('.kv-search select')), input: style(document.querySelector('.kv-search input')), tree: style(document.querySelector('.pane .tree-search input')), padding: getComputedStyle(document.querySelector('.kv-search')).padding };
	});
	assert.deepEqual(search.select, search.input, `Key 선택과 입력칸이 같은 모양: ${JSON.stringify(search)}`);
	assert.deepEqual([search.input[0], search.input[5], search.tree[0], search.tree[5], search.tree[3], search.tree[4]], [28, '6px', 28, '6px', search.input[3], search.input[4]], '트리 검색칸과 같은 높이·모서리·색');
	assert.equal(search.padding, '0px 3px 8px', '검색칸 둘레 여백(팔레트·트리와 같은 좌우 8px 정렬)');
	// 안내 문구까지 코딩 글꼴 12px, 길면 …(잘려도 글자가 반쪽으로 끊기지 않음)
	const placeholder = await page.evaluate(() => [document.querySelector('.kv-search input'), document.querySelector('.pane .tree-search input')].map(i => { const s = getComputedStyle(i, '::placeholder'); return [s.fontFamily.includes('monospace'), s.fontSize, getComputedStyle(i).textOverflow]; }));
	assert.deepEqual(placeholder, [[true, '12px', 'ellipsis'], [true, '12px', 'ellipsis']], '검색 안내 문구 글꼴(코딩)·크기·줄임');
	await page.screenshot({ path: path.join(tmpdir(), 'ws5-property-table.png'), clip: await page.$eval('.kv-wrap', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y - 40, width: Math.min(r.width, 420), height: Math.min(r.height + 40, 220), scale: 2 }; }) });
	console.log('Property: 표 모양(카테고리 머리·값 있는 행 강조선·행 구분선) passed');
}
