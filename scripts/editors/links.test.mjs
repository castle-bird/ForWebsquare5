import assert from 'node:assert/strict';

export default async function ({ page, modifiedKey, reset, checkIndentUnit, content, clickTab, lastSent }) {
	// 연결 탭(Controller·Service·Mapper·Mybatis): 경로 입력 → 편집기, 파일별 저장·Undo, 우클릭 메뉴, 탭 끌어 순서 바꾸기
	const tabNames = () => page.$$eval('.canvas-frame .tab-bar button[role="tab"]:not(.tab-pinned)', bs => bs.map(b => b.textContent));
	// 탭을 끌어 놓은 직후 잠깐은 dnd-kit이 클릭을 막는다 → 선택될 때까지 다시 누른다

	const tabButton = name => page.evaluateHandle(name => window.tab(name), name);

	assert.deepEqual(await tabNames(), ['Design', 'Info', 'Script', 'Source', 'Controller', 'Service', 'Mapper', 'Mybatis']);
	await page.evaluate(() => ['controller', 'service', 'mapper', 'mybatis'].forEach(kind => window.send({ type: 'linked', kind })));
	await clickTab('Controller');
	await page.waitForSelector('.tab-body:not([hidden]) .link-picker input');
	assert.equal(await page.$eval('.tab-body:not([hidden]) .link-picker button[type="submit"]', b => b.disabled), true, '빈 경로는 연결 버튼 비활성');
	await page.type('.tab-body:not([hidden]) .link-picker input', '"src/A.java"');
	await page.keyboard.press('Enter');
	assert.deepEqual(await lastSent('link'), { type: 'link', kind: 'controller', path: '"src/A.java"' });
	await page.evaluate(() => [...document.querySelectorAll('.tab-body:not([hidden]) .link-picker button')].find(b => b.textContent === '찾아보기…').click());
	assert.deepEqual(await lastSent('link'), { type: 'link', kind: 'controller' }, '찾아보기는 경로 없이 (파일 선택 창)');
	const javaText = 'public class A {\n    private MemberService memberService;\n    void list() { memberService.find(1); }\n}\n';
	await page.evaluate(text => window.send({ type: 'linked', kind: 'controller', path: 'src/A.java', text, version: 5 }), javaText);
	await page.waitForFunction(text => window.editor()?.state.doc.toString() === text, {}, javaText);
	assert.equal(await page.evaluate(b => b.title, await tabButton('Controller')), 'src/A.java', '탭 툴팁은 연결 경로');
	await page.evaluate(() => { window.sent.length = 0; });
	await page.evaluate(() => { const v = window.editor(); v.dispatch({ selection: { anchor: v.state.doc.length } }); v.focus(); });
	await page.keyboard.type('// x');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'setCode' && m.target === 'link:controller' && m.version === 5));
	// Ctrl+S는 이 파일만 저장(VS Code로 넘기면 화면 XML이 저장된다), Ctrl+Z는 이 편집기만 되돌린다
	await modifiedKey('Control', 's');
	assert.deepEqual(await lastSent('saveLink'), { type: 'saveLink', kind: 'controller' });
	assert.equal(await page.evaluate(() => window.leakedSave), 0, 'Ctrl+S가 VS Code로 전달됨');
	await modifiedKey('Control', 'z');
	await page.waitForFunction(text => window.editor().state.doc.toString() === text, {}, javaText);
	assert.equal(await page.evaluate(() => window.leakedUndo), 0, '연결 탭 Ctrl+Z가 VS Code로 전달됨');
	// Java 자동완성: 키워드, 이 파일의 필드·타입, 점 뒤에는 이 파일에서 호출한 메서드
	for (const [typed, expected] of [['pub', 'public'], ['memberS', 'memberService'], ['Memb', 'MemberService'], ['memberService.', 'find']]) {
		await reset(javaText + typed);
		await page.keyboard.press('Backspace'); await page.keyboard.type(typed.slice(-1), {delay:25});
		await page.waitForFunction(expected => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === expected), {timeout: 3000}, expected)
			.catch(() => assert.fail(`Java 자동완성: ${typed} → ${expected}`));
	}
	await reset(javaText + '// pub');
	await page.keyboard.press('Backspace'); await page.keyboard.type('b');
	await new Promise(resolve => setTimeout(resolve, 300));
	assert.equal(await page.$('.cm-tooltip-autocomplete'), null, '주석 안에서는 자동완성 없음');
	await checkIndentUnit('Controller');
	// 마우스 올림 설명: 연결 탭은 언어 확장 hover(마크다운, 코드 블록은 편집기 색)
	await reset(javaText); await page.evaluate(() => { window.sent.length = 0; });
	const coordsOf = (needle, offset = 1) => page.evaluate((needle, offset) => { const v = window.editor(), c = v.coordsAtPos(v.state.doc.toString().indexOf(needle) + offset); return { x: c.left + 1, y: (c.top + c.bottom) / 2 }; }, needle, offset);
	const findAt = await coordsOf('find(');
	await page.evaluate(() => { window.remoteHoverText = () => '```java\nint find(int id)\n```\n\nasdasd\n\n* **Parameters:**\n    * **str**\n\n<!-- -->\n\n    * **num**\n* **Returns:**\n    * id'; });
	await page.mouse.move(0, 0); await page.mouse.move(findAt.x, findAt.y);
	const remoteHoverShown = await page.waitForFunction(() => document.querySelector('.cm-tooltip .ws-hover')?.textContent, {timeout: 3000}).then(h => h.jsonValue()).catch(() => undefined);
	assert.match(remoteHoverShown ?? '', /int find\(int id\).*asdasd/s, '연결 탭 hover');
	// Java 언어 서버가 파라미터 사이에 넣는 빈 줄·HTML 주석은 안 보이고, 뒤 파라미터도 같은 목록 안(라벨은 바깥 목록에만)
	assert.deepEqual(await page.evaluate(() => {
		const h = document.querySelector('.cm-tooltip .ws-hover');
		return h && { comment: h.textContent.includes('<!--'), labels: [...h.querySelectorAll(':scope > ul > li > strong')].map(l => l.textContent),
			nested: [...h.querySelectorAll('ul ul')].map(u => [...u.children].map(l => l.textContent)) };
	}), { comment: false, labels: ['Parameters:', 'Returns:'], nested: [['str', 'num'], ['id']] }, 'HTML 주석·빈 줄');
	await page.mouse.move(0, 0);
	await page.evaluate(() => { window.remoteHoverText = undefined; });
	console.log('Link: 언어 확장 hover(마크다운·HTML 주석·빈 줄) passed');
	// 정의로 이동: Ctrl+클릭·F12 → 반영된 버전·그 자리로 물음, 확장이 준 reveal로 커서·스크롤. 커서 추가는 Alt+클릭
	await reset(javaText); await page.evaluate(() => { window.sent.length = 0; });
	await page.keyboard.down('Control'); await page.mouse.click(findAt.x, findAt.y); await page.keyboard.up('Control');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'definition'), {timeout: 3000}).catch(() => assert.fail('Ctrl+클릭 → 정의 요청(편집 반영을 기다린 뒤)'));
	const defAsked = await lastSent('definition');
	assert.deepEqual({ target: defAsked.target, line: defAsked.line, ch: defAsked.ch }, { target: 'link:controller', line: 2, ch: javaText.split('\n')[2].indexOf('find') + 1 }, '연결 탭·누른 자리로 물음');
	assert.equal(await page.evaluate(() => window.editor().state.selection.ranges.length), 1, 'Ctrl+클릭은 커서를 늘리지 않음');
	await page.evaluate(() => { window.sent.length = 0; });
	await page.keyboard.press('F12');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'definition'), {timeout: 3000}).catch(() => assert.fail('F12 → 정의 요청'));
	// 끝이 없으면 그 자리 단어를, 끝이 있으면 그 범위를 선택(커서만 가면 잘 안 보인다)
	const selected = () => page.evaluate(() => { const v = window.editor(), m = v.state.selection.main; return v.state.sliceDoc(m.from, m.to); });
	await page.evaluate(() => window.send({ type: 'reveal', target: 'link:controller', line: 1, ch: 12 }));
	await page.waitForFunction(() => { const v = window.editor(), m = v.state.selection.main; return v.state.sliceDoc(m.from, m.to) === 'MemberService'; }, {timeout: 3000}).catch(async () => assert.fail(`reveal → 그 자리 단어 선택: ${await selected()}`));
	await page.evaluate(() => window.send({ type: 'reveal', target: 'link:controller', line: 1, ch: 26, endLine: 1, endCh: 39 }));
	await page.waitForFunction(() => { const v = window.editor(), m = v.state.selection.main; return v.state.sliceDoc(m.from, m.to) === 'memberService'; }, {timeout: 3000}).catch(async () => assert.fail(`reveal → 준 범위 선택: ${await selected()}`));
	const listAt = await coordsOf('list()');
	await page.keyboard.down('Alt'); await page.mouse.click(listAt.x, listAt.y); await page.keyboard.up('Alt');
	assert.equal(await page.evaluate(() => window.editor().state.selection.ranges.length), 2, 'Alt+클릭은 커서 추가');
	// 다른 탭을 보고 있어도 reveal이 오면 그 연결 탭으로 바꿔 그 자리로
	await clickTab('Script');
	await page.evaluate(() => window.send({ type: 'reveal', target: 'link:controller', line: 2, ch: 9 }));
	await page.waitForFunction(() => window.tab('Controller').getAttribute('aria-selected') === 'true', {timeout: 3000}).catch(() => assert.fail('reveal → 연결 탭으로 전환'));
	await page.waitForFunction(text => { const s = window.editor().state.selection; return s.ranges.length === 1 && s.main.from === text.indexOf('list()') && s.main.to === text.indexOf('list()') + 4; }, {timeout: 3000}, javaText).catch(() => assert.fail('reveal → 탭 전환 뒤 그 자리로'));
	console.log('Link: 정의로 이동(Ctrl+클릭·F12·reveal·Alt+클릭 커서 추가) passed');
	// 파라미터 힌트: ( · , 입력 때 언어 확장에 묻고(그 글자를 trigger로) 커서 위에 함수 모양·지금 파라미터(굵게)·설명. Esc로 닫고 Ctrl+Shift+Space로 다시, 결과가 없으면 닫힘
	await page.evaluate(() => {
		window.remoteSignature = msg => ({ label: 'find(int id, String name)', params: [[5, 11], [13, 24]], active: msg.trigger === ',' || window.sigSecond ? 1 : 0, index: 1, count: 2, paramDoc: 'the **id**', doc: 'Finds a member' });
	});
	await reset(javaText); await page.evaluate(() => { window.sent.length = 0; });
	const sigShown = () => page.evaluate(() => { const t = document.querySelector('.cm-tooltip.ws-signature'); return t && { label: t.querySelector('.ws-sig-label').textContent, active: t.querySelector('.ws-sig-active')?.textContent, text: t.textContent }; });
	await page.keyboard.type('find(');
	await page.waitForFunction(() => document.querySelector('.cm-tooltip.ws-signature'), {timeout: 3000}).catch(() => assert.fail('( 입력 → 파라미터 힌트'));
	const sigAsked = await lastSent('signature');
	assert.deepEqual({ target: sigAsked.target, trigger: sigAsked.trigger, line: sigAsked.line, ch: sigAsked.ch }, { target: 'link:controller', trigger: '(', line: 4, ch: 5 }, '연결 탭·( 자리로 물음');
	assert.deepEqual(await sigShown(), { label: '1/2find(int id, String name)', active: 'int id', text: '1/2find(int id, String name)the idFinds a member' }, '함수 모양·지금 파라미터·설명');
	assert.equal(await page.$eval('.cm-tooltip.ws-signature', t => getComputedStyle(t).paddingLeft), '14px', '설명 팝업과 같은 여백(.ws-hover 스타일)');
	await page.keyboard.type('1,');
	await page.waitForFunction(() => document.querySelector('.ws-sig-active')?.textContent === 'String name', {timeout: 3000}).catch(() => assert.fail(', 입력 → 다음 파라미터'));
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => !document.querySelector('.ws-signature'), {timeout: 3000}).catch(() => assert.fail('Esc로 닫힘'));
	await page.evaluate(() => { window.sigSecond = true; });
	await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('Space'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
	await page.waitForFunction(() => document.querySelector('.ws-sig-active')?.textContent === 'String name', {timeout: 3000}).catch(() => assert.fail('Ctrl+Shift+Space로 다시'));
	await page.evaluate(() => { window.remoteSignature = () => undefined; });
	await page.keyboard.press('End');
	await page.waitForFunction(() => !document.querySelector('.ws-signature'), {timeout: 3000}).catch(() => assert.fail('결과가 없으면(괄호 밖) 닫힘'));
	await page.evaluate(() => { window.remoteSignature = undefined; window.sigSecond = undefined; });
	console.log('Link: 파라미터 힌트(( · , · Esc · Ctrl+Shift+Space · 괄호 밖 닫힘) passed');
	// VS Code 언어 확장(Java 언어 서버) 자동완성: 편집이 반영된 버전·커서 위치로 묻고, 고르면 자동 import 같은 추가 편집도 넣는다
	assert.deepEqual(await page.evaluate(() => [window.toSnippet('forEach(${1:action})$0'), window.toSnippet('${1|a,b|} \\$x #{y} $2')]),
		['forEach(${1:action})${0}', '${1:a} $x #\\{y} ${2}'], 'VS Code 스니펫 → CodeMirror 스니펫');
	await page.evaluate(() => {
		window.remoteItems = msg => ({ from: { line: msg.line, ch: msg.ch - 3 }, items: [
			{ label: 'BigDecimal', display: 'BigDecimal', detail: 'java.math', type: 'class', insert: 'BigDecimal', sort: 'a',
				edits: [{ fromLine: 0, fromCh: 0, toLine: 0, toCh: 0, insert: 'import java.math.BigDecimal;\n' }] },
			{ label: 'BigInteger', display: 'BigInteger', detail: 'java.math', type: 'class', insert: 'BigInteger', sort: 'b' },
		] });
	});
	await reset(javaText); await page.evaluate(() => { window.sent.length = 0; });
	await page.keyboard.type('Big', {delay: 25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].map(e => e.textContent).join() === 'BigDecimal,BigInteger', {timeout: 3000})
		.catch(async () => assert.fail(`언어 서버 자동완성 목록: ${await page.evaluate(() => [...document.querySelectorAll('.cm-completionLabel')].map(e => e.textContent))}`));
	assert.equal(await page.$eval('.cm-completionDetail', e => e.textContent), 'java.math');
	const asked = await lastSent('complete');
	assert.deepEqual({ target: asked.target, line: asked.line, ch: asked.ch }, { target: 'link:controller', line: 4, ch: 3 }, '연결 탭·커서 위치로 물음');
	assert.equal(asked.version, (await lastSent('setCode')).version + 1, '입력한 편집이 반영된 버전으로 물음');
	await new Promise(resolve => setTimeout(resolve, 100));
	await page.keyboard.press('Enter');
	assert.equal(await content(), 'import java.math.BigDecimal;\n' + javaText + 'BigDecimal', '고른 항목 + 자동 import');
	// 목록은 풀지 않고 바로, 자동 import는 항목을 푼 결과(늦게 옴): 먼저 고르면 넣고, 오면 그때 import
	await page.evaluate(() => {
		window.remoteItems = msg => ({ from: { line: msg.line, ch: msg.ch - 3 }, items: [{ label: 'BigDecimal', type: 'class', insert: 'BigDecimal', sort: 'a' }] });
		window.pendingDetails = [];
		window.remoteDetails = () => [{ label: 'BigDecimal', info: 'Immutable decimal', edits: [{ fromLine: 0, fromCh: 0, toLine: 0, toCh: 0, insert: 'import java.math.BigDecimal;\n' }] }];
	});
	await reset(javaText); await page.keyboard.type('Big', {delay: 25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'BigDecimal'), {timeout: 3000});
	await new Promise(resolve => setTimeout(resolve, 100));
	await page.keyboard.press('Enter');
	assert.equal(await content(), javaText + 'BigDecimal', '고르면 바로 넣음(푼 결과 전)');
	await page.evaluate(() => { window.pendingDetails.forEach(reply => reply()); window.pendingDetails = undefined; });
	await page.waitForFunction(text => window.editor().state.doc.toString() === text, {timeout: 3000}, 'import java.math.BigDecimal;\n' + javaText + 'BigDecimal').catch(() => assert.fail('늦게 온 자동 import'));
	await page.evaluate(() => { window.remoteDetails = undefined; });
	// 설명은 마크다운으로(언어 서버 MarkdownString): 굵게·인라인 코드·코드 블록·목록·이스케이프, HTML은 글자로
	await page.evaluate(() => {
		const fence = '`'.repeat(3);
		const info = ['Returns a stream of `int`.', '**Specified by:** chars() in <b>CharSequence</b>', '', '* **Returns:**', '* an IntStream', '', fence + 'java', 'int x = 1;', fence, 'surrogate \\* point'].join('\n');
		window.remoteItems = () => ({ items: [{ label: 'chars', type: 'method', insert: 'chars()', info }] });
	});
	await reset('s.'); await page.keyboard.type('cha', {delay: 25});
	await page.waitForSelector('.cm-completionInfo .md', {timeout: 3000}).catch(() => assert.fail('설명 마크다운'));
	assert.deepEqual(await page.$eval('.cm-completionInfo .md', md => ({
		code: [...md.querySelectorAll('p > code')].map(c => c.textContent), strong: [...md.querySelectorAll('strong')].map(b => b.textContent),
		items: [...md.querySelectorAll('li')].map(l => l.textContent), pre: md.querySelector('pre code')?.textContent, html: !!md.querySelector('b'), escaped: md.textContent.includes('surrogate * point'),
	})), { code: ['int'], strong: ['Specified by:', 'Returns:'], items: ['Returns:', 'an IntStream'], pre: 'int x = 1;', html: false, escaped: true });
	// 코드 블록은 편집기 언어·테마 색(키워드 int는 글자색과 다름)
	// 목록 라벨(Returns:)은 지금 코드 테마의 키워드 색(설명 글자색과 다름)
	assert.ok(await page.$eval('.cm-completionInfo', info => { const b = [...info.querySelectorAll('li > strong')].find(e => e.textContent === 'Returns:'); return !!b && getComputedStyle(b).color !== getComputedStyle(info).color; }), '라벨 색');
	assert.ok(await page.$eval('.cm-completionInfo .md pre code', c => { const s = [...c.querySelectorAll('span')].find(e => e.textContent === 'int'); return !!s && getComputedStyle(s).color !== getComputedStyle(c).color; }), '코드 블록 색');
	await page.keyboard.press('Escape');
	await page.evaluate(() => { window.remoteItems = () => ({ items: [{ label: 'forEach', type: 'method', insert: 'forEach(${1:action})$0', snippet: true }] }); });
	await reset('list.'); await page.keyboard.type('forE', {delay: 25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'forEach'), {timeout: 3000});
	await new Promise(resolve => setTimeout(resolve, 100));
	await page.keyboard.press('Enter');
	assert.equal(await content(), 'list.forEach(action)');
	assert.equal(await page.evaluate(() => { const v = window.editor(), r = v.state.selection.main; return v.state.sliceDoc(r.from, r.to); }), 'action', '스니펫 첫 자리 선택');
	await reset('memberService'); await page.evaluate(() => { window.sent.length = 0; });
	await page.keyboard.type('.', {delay: 25});
	await page.waitForFunction(() => window.sent.some(m => m.type === 'complete'));
	assert.equal((await lastSent('complete')).trigger, '.', '점 뒤는 trigger character로');
	await page.keyboard.press('Escape');
	// 자리 없는 스니펫(Java getHour()): '.' 바로 뒤에서 Enter로 골라도 커서는 넣은 글자 끝으로
	await page.evaluate(() => { window.remoteItems = () => ({ items: [{ label: 'getHour', type: 'method', insert: 'getHour()', snippet: true }] }); });
	await reset('entry'); await page.keyboard.type('.', {delay: 25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'getHour'), {timeout: 3000});
	await new Promise(resolve => setTimeout(resolve, 100));
	await page.keyboard.press('Enter');
	assert.equal(await content(), 'entry.getHour()');
	assert.equal(await page.evaluate(() => window.editor().state.selection.main.head), 'entry.getHour()'.length, '커서는 넣은 글자 끝');
	await page.evaluate(() => { window.remoteItems = undefined; });
	console.log('Link: VS Code 언어 확장 자동완성(위치·자동 import·스니펫·점) passed');
	// 자동완성 아이콘: IntelliJ처럼 종류별 글자(C I E T N · m f p v c · ƒ k S), 타입류는 원·멤버류는 둥근 사각, 종류마다 다른 색
	const kinds = ['class', 'interface', 'enum', 'type', 'namespace', 'method', 'field', 'property', 'variable', 'constant', 'function', 'keyword', 'snippet'];
	await page.evaluate(kinds => { window.remoteItems = () => ({ items: kinds.map((type, i) => ({ label: 'icon' + type, type, insert: 'icon' + type, sort: String(i).padStart(2, '0') })).concat([{ label: 'iconNone', insert: 'iconNone', sort: '99' }]) }); }, kinds);
	await reset('icon'); await page.keyboard.type('.', {delay: 25}); await page.keyboard.type('ic', {delay: 25});
	await page.waitForFunction(n => document.querySelectorAll('.cm-tooltip-autocomplete li').length === n, {timeout: 4000}, kinds.length + 1);
	const icons = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.cm-tooltip-autocomplete li')].map(li => {
		const icon = li.querySelector('.cm-completionIcon'), style = getComputedStyle(icon);
		return [li.querySelector('.cm-completionLabel').textContent, { letter: getComputedStyle(icon, '::after').content.replace(/"/g, ''), round: style.borderTopLeftRadius === '50%' || parseFloat(style.borderTopLeftRadius) >= 9, color: style.color }];
	})));
	assert.deepEqual(Object.fromEntries(kinds.map(k => [k, icons['icon' + k]?.letter])), { class: 'C', interface: 'I', enum: 'E', type: 'T', namespace: 'N', method: 'm', field: 'f', property: 'p', variable: 'v', constant: 'c', function: 'ƒ', keyword: 'k', snippet: 'S' }, '종류별 아이콘 글자');
	assert.deepEqual(['class', 'interface', 'enum', 'type', 'namespace'].filter(k => !icons['icon' + k].round), [], '타입류는 원');
	assert.deepEqual(['method', 'field', 'property', 'variable', 'constant', 'function'].filter(k => icons['icon' + k].round), [], '멤버류는 둥근 사각');
	assert.notEqual(icons.iconclass.color, icons.iconmethod.color, '종류마다 색이 다름(VS Code 심볼 아이콘 색)');
	assert.equal(icons.iconNone.letter, 'none', '종류 없으면 글자 없음');
	await page.keyboard.press('Escape');
	await page.evaluate(() => { window.remoteItems = undefined; });
	console.log('Link: 자동완성 아이콘(종류별 글자·모양·색) passed');
	// 키 입력: Tab은 커서 자리에 다음 4칸 자리까지(줄 전체가 아니라), Java Enter는 윗줄 기준(+ { 뒤 한 단계, } 앞 한 단계 덜), XML 태그 자동 닫기
	const typed = async (doc, pos, keys) => {
		await page.evaluate((d, p) => { const v = window.editor(); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: d }, selection: { anchor: p } }); v.focus(); }, doc, pos);
		// 앞 입력의 자동완성 결과(모의 언어 서버 5ms)가 늦게 와서 창이 뜨면 Tab이 그 항목을 받는다 → 늦은 응답까지 기다린 뒤 확인
		await new Promise(resolve => setTimeout(resolve, 50));
		await page.waitForFunction(() => !document.querySelector('.cm-tooltip-autocomplete'));
		for (const k of keys) {
			if (k.length > 1) { await page.keyboard.press(k); } else { await page.keyboard.type(k); }
		}
		await page.keyboard.press('Escape');
		return content();
	};
	const block = 'class A {\n    void f() {\n        query.put("rowStatus", "U");\n    }\n}\n';
	assert.equal(await typed(block, block.indexOf('"U");') + 5, ['Enter', 'x']), block.replace('"U");', '"U");\n        x'), 'Java: 문장 뒤 Enter는 같은 들여쓰기');
	assert.equal(await typed(block, block.indexOf('f() {') + 5, ['Enter', 'x']), block.replace('f() {', 'f() {\n        x'), 'Java: { 뒤 Enter는 한 단계 더');
	assert.equal(await typed('void f() {}', 10, ['Enter', 'x']), 'void f() {\n    x\n}', 'Java: {} 사이 Enter');
	assert.equal(await typed('if (a) {\n    b();\n    ', 22, ['}']), 'if (a) {\n    b();\n}', 'Java: } 입력하면 한 단계 덜');
	assert.equal(await typed('ab', 1, ['Tab']), 'a   b', 'Tab: 커서 자리에 다음 4칸 자리까지');
	await clickTab('Source');
	assert.equal(await typed('<a b="1"/>', 2, ['Tab']), '<a   b="1"/>', 'XML Tab: 줄 전체가 아니라 커서 자리');
	assert.equal(await typed('', 0, ['<', 'w', '2', ':', 'i', 'n', 'p', 'u', 't', '>']), '<w2:input></w2:input>', 'Source: > 입력하면 닫는 태그');
	assert.equal(await typed('<a>', 3, ['<', '/']), '<a></a>', 'Source: </ 입력하면 닫는 태그');
	assert.equal(await typed('', 0, ['<', 'u', 'p', 'd', 'a', 't', 'e', '>', ' ', '<', '/', 'x']), '<update> </update>x', 'Source: 이미 붙은 닫는 태그는 </ 로 건너뜀');
	await clickTab('Controller');
	console.log('Keys: Tab 커서 자리·Java Enter 들여쓰기·XML 태그 자동 닫기 passed');
	console.log('Link: 경로 입력·찾아보기·편집·Ctrl+S/Ctrl+Z 파일별·Java 자동완성·들여쓰기 4칸 passed');
	// 저장 안 함 표시, 연결 상태에 따라 바뀌는 우클릭 메뉴
	const cleanWidth = await page.evaluate(() => window.tab('Controller').getBoundingClientRect().width);
	await page.evaluate(text => window.send({ type: 'linked', kind: 'controller', path: 'src/A.java', text, version: 50, dirty: true }), javaText);
	await page.waitForFunction(() => window.tab('Controller').classList.contains('dirty'));
	assert.equal(await page.evaluate(() => getComputedStyle(window.tab('Controller'), '::after').visibility), 'visible', '● 표시');
	assert.equal(await page.evaluate(() => window.tab('Controller').getBoundingClientRect().width), cleanWidth, '● 표시가 생겨도 탭 너비 그대로');
	// 탭 줄 위치: 기본 위, 맨 앞 화살표로 아래·위(확장에 저장 요청, 다른 화면이 보낸 위치도 따름)
	const barAt = () => page.evaluate(() => { const f = document.querySelector('.canvas-frame'); return f.firstElementChild.classList.contains('tab-bar') ? 'top' : f.lastElementChild.classList.contains('tab-bar') ? 'bottom' : '?'; });
	assert.equal(await barAt(), 'top', '탭 줄 기본 위');
	assert.equal(await page.$eval('.canvas-frame .tab-bar > :first-child', b => b.classList.contains('tab-palette')), true, '팔레트 버튼은 화살표 왼쪽');
	assert.equal(await page.$eval('.canvas-frame .tab-move', b => b.title), '탭을 아래로', '탭 방향 화살표 유지');
	await page.click('.canvas-frame .tab-move');
	await page.waitForFunction(() => document.querySelector('.canvas-frame').lastElementChild.classList.contains('tab-bar'));
	assert.equal((await lastSent('setTabPosition')).position, 'bottom', '위치 저장 요청');
	await page.evaluate(() => window.send({ type: 'tabPosition', position: 'top' }));
	await page.waitForFunction(() => document.querySelector('.canvas-frame').firstElementChild.classList.contains('tab-bar'));
	await page.click('.canvas-frame .tab-move');
	await page.waitForFunction(() => document.querySelector('.canvas-frame').lastElementChild.classList.contains('tab-bar'));
	assert.equal(await page.$eval('.canvas-frame .tab-move', b => b.title), '탭을 위로');
	console.log('Tabs: 탭 줄 위·아래 전환(기본 위) passed');
	const menuOf = async name => {
		const box = await (await tabButton(name)).boundingBox();
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
		await page.waitForSelector('.context-menu');
		return page.$$eval('.context-menu button', bs => bs.map(b => `${b.textContent}${b.disabled ? ' (비활성)' : ''}`));
	};
	assert.deepEqual(await menuOf('Controller'), ['VS Code에서 열기', '다른 파일로 변경…', '연결 해제', '탭 이름 변경…', '탭 삭제…']);
	// 아래쪽 탭에서 연 메뉴: 실제 크기로 재서 위로 뒤집혀 화면 안에, 자리를 잡은 뒤 첫 항목에 포커스
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.context-menu')).visibility === 'visible');
	const menuBox = await page.evaluate(() => {
		const r = document.querySelector('.context-menu').getBoundingClientRect();
		return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, focused: document.activeElement?.textContent };
	});
	const controllerBox = await (await tabButton('Controller')).boundingBox();
	assert.ok(menuBox.top >= 0 && menuBox.bottom <= await page.evaluate(() => innerHeight) && menuBox.left >= 0 && menuBox.right <= await page.evaluate(() => innerWidth), `메뉴가 화면 안: ${JSON.stringify(menuBox)}`);
	assert.ok(menuBox.bottom <= controllerBox.y + controllerBox.height / 2 + 1, '아래 공간이 없으면 누른 자리 위로');
	assert.equal(menuBox.focused, 'VS Code에서 열기');
	await page.evaluate(() => [...document.querySelectorAll('.context-menu button')].find(b => b.textContent === '연결 해제').click());
	assert.deepEqual(await lastSent('unlink'), { type: 'unlink', kind: 'controller' });
	assert.equal(await page.$('.context-menu'), null, '메뉴 닫힘');
	assert.deepEqual(await menuOf('Service'), ['VS Code에서 열기', '파일 연결…', '연결 해제 (비활성)', '탭 이름 변경…', '탭 삭제…']);
	await page.evaluate(() => [...document.querySelectorAll('.context-menu button')].find(b => b.textContent === 'VS Code에서 열기').click());
	assert.deepEqual(await lastSent('openLink'), { type: 'openLink', kind: 'service' }, '연결 전에도 요청(확장이 알림)');
	await page.keyboard.press('Escape');
	const designBox = await (await tabButton('Design')).boundingBox();
	await page.mouse.click(designBox.x + 5, designBox.y + 5, { button: 'right' });
	assert.equal(await page.$('.context-menu'), null, 'Design 탭에는 메뉴 없음');
	// 파일이 사라짐: 경로 입력으로 돌아가고 경고
	await page.evaluate(() => window.send({ type: 'linked', kind: 'controller', path: 'src/A.java' }));
	await page.waitForFunction(() => document.querySelector('.tab-body:not([hidden]) .link-picker .warning')?.textContent.includes('src/A.java'));
	console.log('Link: 저장 안 함 표시·우클릭 메뉴·파일 없음 passed');
	// 경로 입력칸 파일 검색: 들어가면 목록을 받고, 입력하면 파일 이름·경로로 퍼지 검색, ↓·Enter나 클릭으로 연결
	await page.evaluate(() => { window.mockFiles = ['src/main/java/a/MemberService.java', 'src/main/java/a/OrderService.java', 'src/test/java/a/MemberServiceTest.java']; window.sent.length = 0; });
	await clickTab('Service');
	await page.click('.tab-body:not([hidden]) .link-picker input');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'findFiles' && m.kind === 'service'));
	await page.keyboard.type('memsvc', {delay: 20});
	await page.waitForFunction(() => document.querySelectorAll('.tab-body:not([hidden]) .file-suggest li').length === 2, {timeout: 3000})
		.catch(async () => assert.fail(`검색 결과: ${await page.$$eval('.file-suggest li', ls => ls.map(l => l.title))}`));
	assert.deepEqual(await page.$$eval('.tab-body:not([hidden]) .file-suggest li', ls => ls.map(l => l.title)), ['src/main/java/a/MemberService.java', 'src/test/java/a/MemberServiceTest.java']);
	await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
	assert.deepEqual(await lastSent('link'), { type: 'link', kind: 'service', path: 'src/test/java/a/MemberServiceTest.java' }, '↓·Enter로 고름');
	await page.evaluate(() => { const i = document.querySelector('.tab-body:not([hidden]) .link-picker input'); i.focus(); });
	await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
	await page.keyboard.type('order', {delay: 20});
	await page.waitForSelector('.tab-body:not([hidden]) .file-suggest li');
	await page.click('.tab-body:not([hidden]) .file-suggest li');
	assert.deepEqual(await lastSent('link'), { type: 'link', kind: 'service', path: 'src/main/java/a/OrderService.java' }, '클릭으로 고름');
	// 연결 못 한 이유는 알림을 꺼 둬도 보이게 경로 입력 화면에, 다시 입력하면 지움
	await page.evaluate(() => window.send({ type: 'linkProblem', kind: 'service', message: '이미 Controller 탭에 연결된 파일입니다.' }));
	await page.waitForFunction(() => document.querySelector('.tab-body:not([hidden]) .link-picker .warning')?.textContent === '이미 Controller 탭에 연결된 파일입니다.');
	await page.keyboard.type('x');
	await page.waitForFunction(() => !document.querySelector('.tab-body:not([hidden]) .link-picker .warning'));
	await page.keyboard.press('Escape');
	console.log('Link: 경로 입력 파일 검색(퍼지·키보드·클릭) passed');
	// MyBatis: 매퍼 태그·속성 자동완성, XML 문법 오류 밑줄
	await page.evaluate(() => window.send({ type: 'linked', kind: 'mybatis', path: 'res/a.xml', text: '<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "mybatis-3-mapper.dtd">\n<mapper namespace="a">\n</mapper>', version: 3 }));
	await clickTab('Mybatis');
	await page.waitForFunction(() => window.editor()?.state.doc.toString().includes('<mapper'));
	await page.evaluate(() => { const v = window.editor(); const at = v.state.doc.toString().indexOf('</mapper>'); v.dispatch({ selection: { anchor: at } }); v.focus(); });
	await page.keyboard.type('<sel', {delay:25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'select'), {timeout: 3000}).catch(() => assert.fail('MyBatis 태그 자동완성'));
	await page.keyboard.press('Escape');
	await reset('<mapper><select id="a" ');
	await page.keyboard.type('resultT', {delay:25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'resultType'), {timeout: 3000}).catch(() => assert.fail('MyBatis 속성 자동완성'));
	await reset('<mapper><select></mapper>');
	await page.waitForFunction(() => window.diagnostics().length, {timeout: 3000}).catch(() => assert.fail('MyBatis 문법 오류 밑줄'));
	assert.ok(await page.evaluate(() => window.sent.some(m => m.type === 'setCode' && m.target === 'link:mybatis')), 'MyBatis 편집 전송');
	await checkIndentUnit('Mybatis');
	await reset('<mapper>\n</mapper>'); await page.evaluate(() => window.editor().dispatch({ selection: { anchor: 8 } }));
	await page.keyboard.press('Enter'); await page.keyboard.type('<select id="a">');
	await page.keyboard.press('Escape');
	assert.match(await content(), /<select id="a"><\/select>/, 'Mybatis: 태그 자동 닫기');
	await reset(''); await page.keyboard.type('<update> </x', {delay: 20}); await page.keyboard.press('Escape');
	assert.equal(await content(), '<update> </update>x', 'Mybatis: 이미 붙은 닫는 태그는 </ 로 건너뜀');
	// 커서 뒤 닫는 태그가 안쪽 요소의 것이 아니면(바깥 요소의 것) 건너뛰지 않고 안쪽 요소를 닫는다
	await reset('<if><where>a</if>'); await page.evaluate(() => window.editor().dispatch({ selection: { anchor: 12 } }));
	await page.keyboard.type('</', {delay: 20}); await page.keyboard.press('Escape');
	assert.equal(await content(), '<if><where>a</where></if>', 'Mybatis: 바깥 요소의 닫는 태그는 건너뛰지 않음');
	// 탭 문자·2칸으로 들여쓴 파일도 들여쓰기 단위는 공백 4칸
	await page.evaluate(() => window.send({ type: 'linked', kind: 'mapper', path: 'src/M.java', text: 'interface M {\n\tvoid a();\n}\n', version: 2 }));
	await clickTab('Mapper');
	await page.waitForFunction(() => window.editor()?.state.doc.toString().startsWith('interface M'));
	await reset('');
	await page.keyboard.press('Tab');
	assert.equal(await content(), '    ', 'Mapper(탭 파일): Tab도 공백 4칸');
	await clickTab('Script');
	const twoSpace = 'scwin.f = function() {\n  if (a) {\n    b();\n  }\n};';
	await page.evaluate(text => window.send({ ...window.initialDocument, version: 100000, script: { text } }), twoSpace);
	await page.waitForFunction(text => window.editor().state.doc.toString().startsWith(text), {}, twoSpace);
	assert.equal(await page.evaluate(() => window.editor().state.facet(window.indentUnit)), '    ', '2칸 Script도 4칸');
	console.log('Link: MyBatis 자동완성·문법 오류·들여쓰기 4칸 passed');
	// HTML·CSS·JS도 연결: 확장자로 언어를 고른다(HTML 태그 자동 닫기, CSS 속성 자동완성, JS는 ES 모듈도 문법 오류 아님)
	const linkAs = async (path, text, version) => {
		await page.evaluate((path, text, version) => window.send({ type: 'linked', kind: 'service', path, text, version }), path, text, version);
		await clickTab('Service');
		await page.waitForFunction(text => window.editor()?.state.doc.toString() === text, {}, text);
	};
	await linkAs('web/a.html', '<!-- h -->', 500);
	await reset(''); await page.keyboard.type('<div>', {delay: 20}); await page.keyboard.press('Escape');
	assert.equal(await content(), '<div></div>', 'HTML: 태그 자동 닫기');
	await reset(''); await page.keyboard.type('<div> </x', {delay: 20}); await page.keyboard.press('Escape');
	assert.equal(await content(), '<div> </div>x', 'HTML: 이미 붙은 닫는 태그는 </ 로 건너뜀');
	await linkAs('web/a.css', '/* c */', 501);
	await reset('a { '); await page.keyboard.type('backgr', {delay: 25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'background'), {timeout: 6000}).catch(() => assert.fail('CSS 속성 자동완성'));
	await page.keyboard.press('Escape');
	// 연결 탭 문법 검사 = VS Code가 그 파일에 낸 문제(JS 내장 검사·Java 언어 서버 등). 편집기 버전과 같은 결과를 그 줄·글자에
	await linkAs('web/a.js', 'const = 1;\nok();', 502);
	await new Promise(resolve => setTimeout(resolve, 700));
	assert.deepEqual(await page.evaluate(() => window.diagnostics()), [], 'JS: 편집기가 직접 검사하지 않음(VS Code 결과만)');
	await page.evaluate(() => window.send({ type: 'diagnostics', target: 'link:service', version: 502, items: [{ fromLine: 0, fromCh: 6, toLine: 0, toCh: 7, severity: 'error', message: "Variable declaration expected.", source: 'ts' }] }));
	await page.waitForFunction(() => window.diagnostics().length === 1, { timeout: 3000 }).catch(() => assert.fail('VS Code 문제 밑줄'));
	assert.deepEqual(await page.evaluate(() => window.diagnostics()), [{ from: 6, message: 'Variable declaration expected.' }]);
	// 확장은 연결 내용 바로 뒤에 문제를 보낸다: 새 파일 편집기가 뜨기 전에 온 문제도 표시
	await page.evaluate(() => {
		window.send({ type: 'linked', kind: 'service', path: 'src/B.java', text: 'class B {\n    void f() {\n        if( ) {}\n    }\n}\n', version: 503 });
		window.send({ type: 'diagnostics', target: 'link:service', version: 503, items: [{ fromLine: 2, fromCh: 11, toLine: 2, toCh: 12, severity: 'error', message: 'Syntax error on token "(", Expression expected after this token', source: 'Java' }, { fromLine: 99, fromCh: 0, toLine: 99, toCh: 3, severity: 'warning', message: '끝 밖', source: 'Java' }] });
	});
	await page.waitForFunction(() => window.diagnostics().length === 2, { timeout: 3000 }).catch(() => assert.fail('Java 언어 서버 문제 밑줄'));
	const javaProblems = await page.evaluate(() => window.diagnostics());
	assert.equal(javaProblems[0].from, 'class B {\n    void f() {\n        if( ) {}'.indexOf('( )') + 1, 'Java: 줄·글자 위치');
	assert.equal(javaProblems[1].from, await page.evaluate(() => window.editor().state.doc.length), '문서 밖 위치는 끝으로');
	assert.ok(await page.$('.tab-body:not([hidden]) .cm-lint-marker-error'), 'Java: 줄 번호 옆 표시');
	await page.evaluate(() => window.send({ type: 'diagnostics', target: 'link:service', version: 503, items: [] }));
	await page.waitForFunction(() => window.diagnostics().length === 0, { timeout: 3000 }).catch(() => assert.fail('고치면(문제 없음) 밑줄 사라짐'));
	console.log('Link: HTML·CSS·JS·Java 파일 언어(자동 닫기·자동완성), 문법 검사는 VS Code 문제 그대로 passed');
	// 문서 주석: /** 뒤 Enter → 아래 함수의 @param·@return 틀(커서는 설명 줄), 주석 안 Enter → * 이어짐, 주석 안 . 은 자동완성 없음
	const javaMethod = '\n    @RequestMapping("/a")\n    public Map<String, Object> list(HttpServletRequest request, @RequestParam Map<String, Object> param) {\n    }';
	await linkAs('src/C.java', 'class C {' + javaMethod + '\n}', 510);
	await page.evaluate(() => { const v = window.editor(); v.dispatch({ changes: { from: 9, insert: '\n    /**' }, selection: { anchor: 17 } }); v.focus(); });
	await page.keyboard.press('Enter');
	assert.equal(await content(), 'class C {\n    /**\n     * \n     * @param request\n     * @param param\n     * @return\n     */' + javaMethod + '\n}', 'Java: /** Enter 틀');
	assert.equal(await page.evaluate(() => window.editor().state.selection.main.head), 'class C {\n    /**\n     * '.length, 'Java: 커서는 설명 줄');
	await page.keyboard.type('목록');
	await page.keyboard.press('Enter');
	assert.ok((await content()).startsWith('class C {\n    /**\n     * 목록\n     * \n     * @param request'), 'Java: 주석 안 Enter → * 이어짐');
	await page.keyboard.type('a.', {delay: 30});
	await new Promise(resolve => setTimeout(resolve, 400));
	assert.equal(await page.$('.cm-tooltip-autocomplete'), null, 'Java: 주석 안 . 자동완성 없음');
	await linkAs('web/b.js', '\nfunction save(form, { id }, ...rest) {\n}', 511);
	await page.evaluate(() => { const v = window.editor(); v.dispatch({ changes: { from: 0, insert: '/**' }, selection: { anchor: 3 } }); v.focus(); });
	await page.keyboard.press('Enter');
	assert.equal(await content(), '/**\n * \n * @param form\n * @param rest\n */\nfunction save(form, { id }, ...rest) {\n}', 'JS: /** Enter 틀');
	await clickTab('Script');
	await reset('scwin.f = function(e) {\n};');
	await page.evaluate(() => window.editor().dispatch({ changes: { from: 0, insert: '/**\n' }, selection: { anchor: 3 } }));
	await page.keyboard.press('Enter');
	assert.ok((await content()).startsWith('/**\n * \n * @param e\n */\n'), `Script: /** Enter 틀: ${JSON.stringify(await content())}`);
	console.log('Link·Script: 문서 주석 틀·* 이어짐·주석 안 자동완성 없음 passed');
	// DTD 스키마가 오면 XML 자동완성을 그 스키마로(없으면 기본 MyBatis 목록), 그 밖의 확장자는 일반 텍스트
	await linkAs('res/s.xml', '<!DOCTYPE sqlMap SYSTEM "sql-map-2.dtd">\n<sqlMap>\n</sqlMap>', 520);
	await page.evaluate(() => window.send({ type: 'xmlSchema', kind: 'service', elements: [{ name: 'sqlMap', top: true, children: ['statement'], attributes: [] }, { name: 'statement', children: [], attributes: [{ name: 'resultClass' }] }] }));
	await page.evaluate(() => { const v = window.editor(); const at = v.state.doc.toString().indexOf('</sqlMap>'); v.dispatch({ selection: { anchor: at } }); v.focus(); });
	await page.keyboard.type('<stat', {delay: 25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'statement'), {timeout: 6000}).catch(() => assert.fail('DTD 스키마 태그 자동완성'));
	assert.ok(!await page.evaluate(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'select')), 'DTD가 있으면 MyBatis 기본 목록 안 씀');
	await page.keyboard.press('Escape');
	await linkAs('web/a.jsp', '<%@ page %>', 521);
	await reset(''); await page.keyboard.type('<div>', {delay: 20}); await page.keyboard.press('Escape');
	assert.equal(await content(), '<div>', '그 밖의 확장자: 일반 텍스트(태그 자동 닫기 없음)');
	console.log('Link: DTD 스키마 자동완성·그 밖의 확장자 일반 텍스트 passed');
	// SQL: 매퍼 XML 안 SQL(글자·CDATA)과 .sql 파일에 색과 키워드 자동완성, 방언 설정에 맞춰 바뀜
	await page.evaluate(() => window.send({ type: 'xmlSchema', kind: 'service' }));
	const mapper = '<mapper namespace="a">\n<select id="s">\nselect id from t where x = #{x}\n</select>\n<update id="u"><![CDATA[\ndelete from t where n < 1\n]]></update>\n</mapper>';
	await linkAs('res/m.xml', mapper, 530);
	// SQL 키워드(select·from·where·delete)는 색 칠한 조각(span)으로 나뉜다. 일반 글자였다면 줄에 span이 없다
	const spans = line => page.evaluate(line => [...[...document.querySelectorAll('.tab-body:not([hidden]) .cm-line')][line].querySelectorAll('span')].map(e => e.textContent), line);
	assert.deepEqual((await spans(2)).filter(t => ['select', 'from', 'where'].includes(t)), ['select', 'from', 'where'], `XML 안 SQL 색: ${JSON.stringify(await spans(2))}`);
	assert.ok((await spans(5)).includes('delete'), `CDATA 안 SQL 색: ${JSON.stringify(await spans(5))}`);
	const complete = async (text, label, where) => {
		await reset(mapper);
		await page.evaluate(at => { const v = window.editor(); const pos = v.state.doc.toString().indexOf(at); v.dispatch({ selection: { anchor: pos } }); v.focus(); }, where);
		await page.keyboard.type(text, {delay: 25});
		await page.waitForFunction(label => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent.toLowerCase() === label), {timeout: 6000}, label)
			.catch(async () => assert.fail(`'${text}' 자동완성에 ${label} 없음: ${(await page.evaluate(() => [...document.querySelectorAll('.cm-completionLabel')].map(e => e.textContent))).join(',')}`));
		await page.keyboard.press('Escape');
	};
	await complete('whe', 'where', 'select id from');
	// 같은 자리에서 태그 자동완성도 그대로(`<in` → include)
	await complete('<in', 'include', 'select id from');
	// 방언: rownum은 Oracle에만
	assert.equal(await page.evaluate(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'rownum')), false);
	await page.evaluate(() => window.send({ type: 'codeOptions', wordWrap: false, sqlDialect: 'oracle', fontFeatures: '"liga" off, "calt" off' }));
	await new Promise(resolve => setTimeout(resolve, 200));
	await complete('rown', 'rownum', 'select id from');
	await linkAs('res/q.sql', 'select * from t', 531);
	assert.ok((await spans(0)).includes('select'), `.sql 색: ${JSON.stringify(await spans(0))}`);
	await reset('sel'); await page.keyboard.type('e', {delay: 25});
	await page.waitForFunction(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent.toLowerCase() === 'select'), {timeout: 6000}).catch(() => assert.fail('.sql 키워드 자동완성'));
	await page.keyboard.press('Escape');
	await page.evaluate(() => window.send({ type: 'codeOptions', wordWrap: false, sqlDialect: 'standard', fontFeatures: '"liga" off, "calt" off' }));
	console.log('SQL: 매퍼 XML 안·CDATA·.sql 색, 키워드 자동완성, 태그 자동완성 공존, 방언 변경 passed');
	// 줄바꿈: VS Code editor.wordWrap을 따라 모든 코드 편집기에 적용·해제(긴 줄이 여러 줄로)
	const wrapped = () => page.evaluate(() => { const v = window.editor(); const line = v.dom.querySelector('.cm-line'); return { on: v.contentDOM.classList.contains('cm-lineWrapping'), tall: line.getBoundingClientRect().height > parseFloat(getComputedStyle(line).lineHeight) * 1.5 }; });
	await reset('x'.repeat(400) + ' ' + 'word '.repeat(80));
	assert.deepEqual(await wrapped(), { on: false, tall: false }, '기본: 줄바꿈 없음');
	await page.evaluate(() => window.send({ type: 'codeOptions', wordWrap: true, sqlDialect: 'standard', fontFeatures: '"liga" off, "calt" off' }));
	await page.waitForFunction(() => window.editor().contentDOM.classList.contains('cm-lineWrapping'));
	assert.deepEqual(await wrapped(), { on: true, tall: true }, '줄바꿈 켜면 긴 줄이 여러 줄');
	await clickTab('Script');
	assert.equal((await wrapped()).on, true, 'Script 편집기도 같은 설정');
	await page.evaluate(() => window.send({ type: 'codeOptions', wordWrap: false, sqlDialect: 'standard', fontFeatures: '"liga" off, "calt" off' }));
	await page.waitForFunction(() => !window.editor().contentDOM.classList.contains('cm-lineWrapping'));
	await clickTab('Service');
	console.log('줄바꿈: editor.wordWrap 따라가기(Service·Script) passed');
	// 탭 끌어 놓기: Mybatis를 Design 왼쪽에 → 맨 앞, 순서는 확장에 저장 요청
	// 놓기 전 표시(앞·뒤 선)가 실제로 놓이는 자리와 같아야 한다
	const dragTab = async (name, target, after) => {
		const from = await (await tabButton(name)).boundingBox(), to = await (await tabButton(target)).boundingBox();
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
		await page.mouse.move(to.x + (after ? to.width - 4 : 4), to.y + to.height / 2, { steps: 10 });
		await page.waitForFunction((target, cls) => window.tab(target).classList.contains(cls),
			{ timeout: 3000 }, target, after ? 'drop-after' : 'drop-before').catch(() => assert.fail(`${name} → ${target} 놓기 표시 없음`));
		await page.mouse.up();
	};
	await dragTab('Mybatis', 'Design', false);
	await page.waitForFunction(() => document.querySelector('.canvas-frame .tab-bar button[role="tab"]')?.textContent === 'Mybatis');
	assert.deepEqual(await tabNames(), ['Mybatis', 'Design', 'Info', 'Script', 'Source', 'Controller', 'Service', 'Mapper']);
	assert.deepEqual((await lastSent('setTabOrder')).order, await tabNames());
	await dragTab('Design', 'Source', true);
	assert.deepEqual(await tabNames(), ['Mybatis', 'Info', 'Script', 'Source', 'Design', 'Controller', 'Service', 'Mapper']);
	// 다른 화면에서 바꾼 순서(확장이 보냄)
	await page.evaluate(() => window.send({ type: 'tabOrder', order: ['Design', 'Script', 'Source', 'Controller', 'Service', 'Mapper', 'Mybatis'] }));
	await page.waitForFunction(() => document.querySelector('.canvas-frame .tab-bar button[role="tab"]')?.textContent === 'Design');
	await clickTab('Script');
	await page.waitForFunction(() => document.querySelector('.canvas-frame .tab-bar button.active')?.textContent === 'Script');
	await page.evaluate(() => window.editor().focus());
	await modifiedKey('Control', 's');
	assert.equal(await page.evaluate(() => window.leakedSave), 1, 'Script 탭의 Ctrl+S는 그대로 VS Code(화면 XML 저장)');
	console.log('Tabs: 끌어서 순서 바꾸기·저장된 순서 반영 passed');
	// 옆 패널 탭(Property/Event, Outline/Data)도 끌어서 순서 변경. 한 목록에 저장하되 다른 탭 줄의 순서는 그대로
	const anyTab = name => page.evaluateHandle(name => [...document.querySelectorAll('.tab-bar button[role="tab"]')].find(b => b.textContent === name), name);
	const barNames = name => page.evaluate(name => [...[...document.querySelectorAll('.tab-bar button[role="tab"]')].find(b => b.textContent === name).closest('.tab-bar').querySelectorAll('button[role="tab"]')].map(b => b.textContent), name);
	const activeTabs = await page.evaluate(() => [...document.querySelectorAll('.tab-bar button[role="tab"].active')].map(b => b.textContent));
	for (const [name, target] of [['Event', 'Property'], ['Data', 'Outline']]) {
		const from = await (await anyTab(name)).boundingBox(), to = await (await anyTab(target)).boundingBox();
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
		await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 10 }); await page.mouse.up();
		await page.waitForFunction(([name, target]) => { const b = [...document.querySelectorAll('.tab-bar button[role="tab"]')].find(x => x.textContent === target); return b.closest('.tab-bar').querySelector('button[role="tab"]').textContent === name; }, { timeout: 3000 }, [name, target])
			.catch(() => assert.fail(`${name} → ${target} 앞으로 안 옮겨짐`));
	}
	assert.deepEqual([await barNames('Property'), await barNames('Outline')], [['Event', 'Property'], ['Data', 'Outline']]);
	const savedOrder = (await lastSent('setTabOrder')).order;
	assert.ok(savedOrder.indexOf('Event') < savedOrder.indexOf('Property') && savedOrder.indexOf('Data') < savedOrder.indexOf('Outline') && savedOrder.includes('Design'), `다른 탭 줄 순서도 그대로 저장: ${savedOrder}`);
	await page.evaluate(() => window.send({ type: 'tabOrder', order: ['Design', 'Script', 'Source', 'Controller', 'Service', 'Mapper', 'Mybatis'] }));
	await page.waitForFunction(() => [...document.querySelectorAll('.tab-bar button[role="tab"]')].find(b => b.textContent === 'Property').closest('.tab-bar').querySelector('button[role="tab"]').textContent === 'Property');
	for (const name of activeTabs.filter(n => ['Property', 'Event', 'Outline', 'Data'].includes(n))) { await (await anyTab(name)).click(); }
	console.log('Tabs: Property/Event·Outline/Data 끌어서 순서 바꾸기 passed');
	// + 로 탭 추가(이름은 확장이 받음) → 확장이 새 목록과 select를 보내면 그 탭으로. 우클릭 → 탭 삭제
	await page.click('.canvas-frame .tab-add');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'addTab'), {timeout: 2000}).catch(() => assert.fail('+ 클릭 → addTab 요청 없음'));
	const withDto = [{ id: 'controller', label: 'Controller' }, { id: 'service', label: 'Service' },
		{ id: 'mapper', label: 'Mapper' }, { id: 'mybatis', label: 'Mybatis' }, { id: 'tab1', label: 'DTO' }];
	await page.evaluate(tabs => { window.send({ type: 'linkTabs', tabs, exts: ['.java', '.xml', '.jsp'], select: 'DTO' }); window.send({ type: 'linked', kind: 'tab1' }); }, withDto);
	await page.waitForFunction(() => document.querySelector('.canvas-frame .tab-bar button.active')?.textContent === 'DTO');
	assert.deepEqual((await tabNames()).slice(-2), ['Mybatis', 'DTO'], '새 탭은 맨 뒤');
	assert.match(await page.$eval('.tab-body:not([hidden]) .link-picker', e => e.textContent), /DTO 파일 연결.*\.java·\.xml·\.jsp 파일/, "설정한 확장자 안내");
	await page.evaluate(() => window.send({ type: 'linked', kind: 'tab1', path: 'res/d.xml', text: '<a>\n</a>', version: 1 }));
	await page.waitForFunction(() => window.editor()?.state.doc.toString() === '<a>\n</a>');
	await page.evaluate(() => { const v = window.editor(); v.dispatch({ selection: { anchor: 3 } }); v.focus(); });
	await page.keyboard.type('<b/>');
	await page.waitForFunction(() => window.sent.some(m => m.type === 'setCode' && m.target === 'link:tab1'));
	assert.deepEqual(await menuOf('DTO'), ['VS Code에서 열기', '다른 파일로 변경…', '연결 해제', '탭 이름 변경…', '탭 삭제…']);
	// 이름 변경: 이름은 확장이 입력 상자로 받는다 → 새 목록이 오면 보고 있던 탭을 새 이름으로 계속 보고, 자리도 그대로
	await page.evaluate(() => [...document.querySelectorAll('.context-menu button')].find(b => b.textContent === '탭 이름 변경…').click());
	assert.deepEqual(await lastSent('renameTab'), { type: 'renameTab', kind: 'tab1' });
	const renamed = withDto.map(t => t.id === 'tab1' ? { ...t, label: 'Model' } : t);
	await page.evaluate(tabs => window.send({ type: 'linkTabs', tabs, exts: ['.java'] }), renamed);
	await page.waitForFunction(() => window.tab('Model') && !window.tab('DTO'));
	assert.equal(await page.$eval('.canvas-frame .tab-bar button.active', b => b.textContent), 'Model', '보던 탭 그대로');
	assert.equal(await page.evaluate(() => window.editor()?.state.doc.toString().includes('<b/>')), true, '편집기 그대로');
	assert.deepEqual(await menuOf('Model'), ['VS Code에서 열기', '다른 파일로 변경…', '연결 해제', '탭 이름 변경…', '탭 삭제…']);
	await page.evaluate(() => [...document.querySelectorAll('.context-menu button')].find(b => b.textContent === '탭 삭제…').click());
	assert.deepEqual(await lastSent('removeTab'), { type: 'removeTab', kind: 'tab1' });
	// 확장이 확인 창(모달)에서 삭제를 고르면 새 목록을 보낸다 → 보고 있던 탭이 없어져 Design으로
	await page.evaluate(tabs => window.send({ type: 'linkTabs', tabs: tabs.slice(0, 4), exts: ['.java'] }), withDto);
	await page.waitForFunction(() => !window.tab('Model') && document.querySelector('.canvas-frame .tab-bar button.active')?.textContent === 'Design');
	assert.ok(await page.$('.canvas-frame > .tab-body:not([hidden]) > div'), 'Design 내용 표시');
	console.log('Tabs: + 탭 추가·이름 변경·탭 삭제 passed');
}
