import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';

export default async function ({ page }) {
	// Outline 처음: Body만 펼쳐 바로 아래 컴포넌트까지
	assert.deepEqual(await page.$$eval('.pane .tree-row', rows => rows.map(r => [r.querySelector('.id')?.textContent ?? '', r.getAttribute('aria-expanded')])),
		[['', 'true'], ['ipt_name', null], ['wfm_sub', null]], 'Outline 초기에는 Body 한 단계만 펼침');
	await page.evaluate(() => window.tab('Data', '.pane').click());
	// 테마 색 덮어쓰기 팝업: 코드 편집기가 한 번도 안 뜬 처음 Design 탭에서 열어도 미리 보기가 칠해진다
	// (CodeMirror가 넣는 <style>에 CSP nonce가 없으면 막혀서, Script 탭이 먼저 넣어 줘야만 칠해졌다)
	{
		assert.equal(await page.$$eval('.canvas-frame .tab-body .code-editor', e => e.length), 0, '아직 코드 편집기 없음');
		await page.click('.canvas-frame .tab-settings');
		await page.evaluate(() => [...document.querySelectorAll('.context-menu [role="menuitem"]')].find(b => b.textContent === '테마 색 덮어쓰기…').click());
		await page.waitForSelector('.theme-colors-editor[open]');
		const [keyword, fg] = await page.$eval('.theme-colors-editor .theme-preview', p => [
			getComputedStyle([...p.querySelectorAll('.cm-line span')].find(s => s.textContent === 'return')).color, getComputedStyle(p.querySelector('.cm-content')).color]);
		assert.notEqual(keyword, fg, `처음 Design 탭에서도 문법 색: ${keyword}`);
		await page.evaluate(() => [...document.querySelectorAll('.theme-colors-editor .data-editor-actions button')].find(b => b.textContent === '닫기').click());
		await page.waitForFunction(() => !document.querySelector('.theme-colors-editor'));
	}
	assert.equal(await page.$$eval('.pane .tree-row', rows => rows.length), 2, 'Data 초기에는 DataCollection·Submission 루트만 표시');
	// 둘 다 이 픽스처에서는 자식이 없는 루트라 aria-expanded 자체가 안 붙는다 (children 있는 Outline 쪽은 위에서 이미 확인)
	assert.equal(await page.$eval('.pane .tree-row', row => row.getAttribute('aria-expanded')), null);
	const submissionRoot = (await page.$$('.pane .tree-row'))[1];
	await submissionRoot.click();
	assert.ok(await page.$eval('.pane .tree-row:nth-child(2)', row => row.classList.contains('selected')), 'Submission 루트 클릭 선택');
	// 우클릭은 DataCollection처럼 먼저 메뉴("Submission 추가")를 보여주고, 눌러야 팝업이 열린다
	await submissionRoot.click({ button: 'right' });
	await page.waitForSelector('.context-menu');
	assert.deepEqual(await page.$$eval('.context-menu button', buttons => buttons.map(b => b.textContent)), ['Submission 추가']);
	// 애니메이션을 꺼도 팝업이 처음 그려질 때부터 제자리(창 가운데에 한 번 그려졌다 캔버스 가운데로 옮겨지는 깜빡임 없음)
	await page.evaluate(() => {
		window.send({ type: 'animation', on: false });
		window.firstPaint = undefined;
		const watch = new MutationObserver(() => {
			const popup = document.querySelector('.submission-editor[open]');
			if (popup && !window.firstPaint) {
				watch.disconnect();
				window.firstPaint = 'waiting';
				requestAnimationFrame(() => { window.firstPaint = popup.getBoundingClientRect().left; });
			}
		});
		watch.observe(document.body, { childList: true, subtree: true, attributes: true });
	});
	await page.$eval('.context-menu button', button => button.click());
	await page.waitForSelector('.submission-editor[open]');
	await page.waitForFunction(() => typeof window.firstPaint === 'number');
	await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 200)));
	const [firstLeft, settledLeft] = await page.evaluate(() => [window.firstPaint, document.querySelector('.submission-editor').getBoundingClientRect().left]);
	assert.ok(Math.abs(firstLeft - settledLeft) < 1, `팝업 첫 프레임부터 제자리: ${firstLeft} → ${settledLeft}`);
	await page.evaluate(() => window.send({ type: 'animation', on: true }));
	assert.equal(await page.$eval('#submission-id', input => input.value), 'submission1');
	assert.equal(await page.$eval('#submission-method', input => input.value), 'post');
	assert.equal(await page.$eval('#submission-mode', input => input.value), 'asynchronous');
	assert.equal(await page.$eval('#submission-media', input => input.value), 'application/json');
	// 팝업 입력칸·선택칸은 모두 VS Code 편집기 글꼴
	assert.deepEqual(await page.evaluate(() => {
		document.body.style.setProperty('--vscode-editor-font-family', '"Test Mono", monospace');
		const fonts = [...new Set([...document.querySelectorAll('.submission-editor :is(input, select, textarea)')].map(e => getComputedStyle(e).fontFamily))];
		document.body.style.removeProperty('--vscode-editor-font-family');
		return fonts;
	}), ['"Test Mono", monospace'], '서브미션 팝업 입력 글꼴 통일');
	assert.deepEqual(await page.$$eval('.submission-handler button', bs => bs.map(b => b.disabled)), [true, true, true], '추가 팝업: 코드 버튼은 확인 전 비활성');
	// form 팝업도 Enter는 확인이 아니라 입력칸에서 나오기만
	await page.focus('#submission-id');
	await page.keyboard.press('Enter');
	assert.deepEqual(await page.evaluate(() => [document.activeElement?.classList.contains('submission-editor'), window.sent.some(m => m.type === 'addSubmission')]), [true, false], '서브미션 팝업 Enter: 확인 안 하고 입력칸에서 나옴');
	await page.$eval('.submission-actions button:last-child', button => button.click());
	await page.waitForFunction(() => window.sent.some(m => m.type === 'addSubmission'));
	assert.equal(await page.evaluate(() => window.sent.find(m => m.type === 'addSubmission').index), 5);
	await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'addSubmission' || m.type === 'editSubmission').popup, ok: true }));
	await page.waitForFunction(() => !document.querySelector('.submission-editor'));
	await submissionRoot.click({ count: 2 });
	await page.waitForSelector('.submission-editor[open]');
	await page.$eval('.submission-actions button:first-child', button => button.click());
	const collection = await page.waitForSelector('.pane .tree-row .tag');
	await collection.click({ button: 'right' });
	await page.waitForSelector('.context-menu');
		assert.deepEqual(await page.$$eval('.context-menu button', buttons => buttons.map(b => b.textContent)),
			['DataList 추가', 'DataMap 추가', 'LinkedDataList 추가', 'AliasDataList 추가', 'AliasDataMap 추가']);
		await page.$eval('.context-menu button', button => button.click());
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'addData')),
			{ type: 'addData', version: 1, index: 6, kind: 'dataList' });
		console.log('Data: 우클릭 메뉴 → DataList 추가 요청 passed');
		await page.evaluate(() => {
			const previous = window.sent.find(m => m.type === 'addData');
			const text = '<html xmlns:w2="urn:test" xmlns:xf="http://www.w3.org/2002/xforms"><body><w2:input id="ipt_name" label="Name"/><w2:wframe id="wfm_sub" src="sub.xml"/></body><head><xf:model><ws:dataCollection xmlns:ws="http://www.inswave.com/websquare" baseNode="map"><ws:dataList id="dataList1"><ws:columnInfo/></ws:dataList></ws:dataCollection></xf:model></head></html>';
			window.send({ type: 'document', version: previous.version + 1, text, root: window.parseXml(text), script: { text: '' } });
		});
		await page.waitForSelector('.data-editor[open]');
		assert.equal(await page.$('.data-editor-tabs'), null, 'Column/Data 탭 없음');
		assert.equal(await page.$$('.popup-resize').then(handles => handles.length), 8, '8방향 크기 조절 손잡이');
		assert.deepEqual(await page.$$eval('.data-editor-actions button', buttons => buttons.map(b => b.textContent)), ['닫기', '확인']);
		const centered = await page.evaluate(() => {
			const canvas = document.querySelector('.canvas-frame').getBoundingClientRect();
			const popup = document.querySelector('.data-editor').getBoundingClientRect();
			return Math.abs((popup.left + popup.width / 2) - (canvas.left + canvas.width / 2)) <= 2;
		});
		assert.ok(centered, '팝업은 왼쪽 편집 영역 가운데에서 시작');
		// 가운데(ID 입력칸·모서리 리사이즈 손잡이 밖)를 잡아야 제목줄 드래그가 시작된다
		const title = await page.$eval('.popup-title', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
		const beforeDrag = await page.$eval('.data-editor', el => el.getBoundingClientRect().left);
		await page.mouse.move(title.x, title.y); await page.mouse.down(); await page.mouse.move(title.x + 40, title.y + 20, { steps: 5 }); await page.mouse.up();
		assert.ok(await page.$eval('.data-editor', (el, before) => el.getBoundingClientRect().left > before + 25, beforeDrag), '제목줄로 팝업 이동');
		await page.$eval('.data-editor-tools button', button => button.click());
		await page.click('.data-editor input[aria-label="1행 id"]');
		await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
		await page.keyboard.type('customer');
		// 글자 입력칸의 좌우 방향키는 칸 이동이 아니라 입력 커서 이동
		await page.keyboard.press('ArrowLeft');
		assert.deepEqual(await page.evaluate(() => [document.activeElement?.getAttribute('aria-label'), document.activeElement?.selectionStart]), ['1행 id', 7], '←: 입력 커서만 이동');
		await page.keyboard.press('ArrowRight');
		assert.deepEqual(await page.evaluate(() => [document.activeElement?.getAttribute('aria-label'), document.activeElement?.selectionStart]), ['1행 id', 8], '→: 입력 커서만 이동');
		await page.focus('.data-editor input[aria-label="1행 name"]');
		await page.keyboard.press('End');
		// Enter: 입력칸에서 나와 팝업에 포커스(값은 그대로, Esc로 닫기 유지). 제목줄 ID도
		await page.keyboard.type('n');
		await page.keyboard.press('Enter');
		assert.deepEqual(await page.evaluate(() => [document.activeElement?.classList.contains('data-editor'), document.querySelector('.data-editor input[aria-label="1행 name"]').value]), [true, 'name1n'], 'Enter로 입력칸에서 나옴');
		assert.deepEqual(await page.evaluate(() => {
			document.body.style.setProperty('--vscode-editor-font-family', '"Test Mono", monospace');
			const fonts = [...new Set([...document.querySelectorAll('.data-editor :is(input:not([type="checkbox"]), select)')].map(e => getComputedStyle(e).fontFamily))];
			document.body.style.removeProperty('--vscode-editor-font-family');
			return fonts;
		}), ['"Test Mono", monospace'], 'DataList 팝업 입력 글꼴 통일');
		await page.click('.data-editor-id'); await page.keyboard.press('Enter');
		assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('data-editor')), '제목줄 ID도 Enter로 나옴');
		await page.$eval('.data-editor-tools button', button => button.click());
		const handles = await page.$$eval('.data-row-handle', buttons => buttons.map(button => { const r = button.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
		await page.mouse.move(handles[0].x, handles[0].y); await page.mouse.down();
		await page.mouse.move(handles[1].x, handles[1].y + 6, { steps: 12 }); await page.mouse.up();
		assert.deepEqual(await page.$$eval('.data-editor tbody input[aria-label$=" id"]', inputs => inputs.map(input => input.value)), ['col1', 'customer']);
		const popupBeforeResize = await page.$eval('.data-editor', el => el.getBoundingClientRect().width);
		const corner = await page.$eval('.popup-resize.resize-se', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
		await page.mouse.move(corner.x, corner.y); await page.mouse.down();
		await page.mouse.move(corner.x + 40, corner.y + 30, { steps: 5 }); await page.mouse.up();
		assert.ok(await page.$eval('.data-editor', (el, width) => el.getBoundingClientRect().width > width + 20, popupBeforeResize), '팝업 크기 조절');
		const idWidth = await page.$eval('.data-editor th:nth-child(2)', el => el.getBoundingClientRect().width);
		const columnHandle = await page.$eval('.data-editor th:nth-child(2) .data-col-resizer', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
		await page.mouse.move(columnHandle.x, columnHandle.y); await page.mouse.down();
		await page.mouse.move(columnHandle.x + 35, columnHandle.y, { steps: 5 }); await page.mouse.up();
		assert.ok(await page.$eval('.data-editor th:nth-child(2)', (el, width) => el.getBoundingClientRect().width > width + 20, idWidth), '열 너비 조절');
		// 삭제 뒤 다음 행이 골라져 있어 삭제를 이어 누르면 여러 행이 지워짐
		const ids = () => page.$$eval('.data-editor tbody input[aria-label$=" id"]', inputs => inputs.map(input => input.value));
		await page.$eval('.data-editor-tools button', button => button.click());
		await page.$eval('.data-editor-tools button', button => button.click());
		assert.equal((await ids()).length, 4);
		await page.click('.data-editor tbody tr:nth-child(3)');
		for (let i = 0; i < 2; i++) { await page.$eval('.data-editor button[aria-label="행 삭제"]', button => button.click()); }
		assert.deepEqual(await ids(), ['col1', 'customer'], '삭제 연달아');
		assert.equal(await page.$eval('.data-editor tbody tr.selected input[aria-label$=" id"]', input => input.value), 'customer', '마지막 행을 지우면 이전 행 선택');
		await page.$eval('.data-editor-actions button:last-child', button => button.click());
		await page.waitForFunction(() => window.sent.some(m => m.type === 'editDataFields'));
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'editDataFields').fields.map(f => f.id)), ['col1', 'customer']);
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'editDataFields').popup, ok: true }));
		await page.waitForFunction(() => !document.querySelector('.data-editor'));
		await page.$eval('.pane .tree-row .id', id => id.closest('.tree-row').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
		await page.waitForSelector('.data-editor[open]');
		// 행이 늘어 세로 스크롤바가 생겨도 가로 스크롤은 안 생긴다: 열 합계 ≈ 표 폭인 팝업 폭(650px)에서 스크롤바(위 10px, VS Code 웹뷰와 같음)만큼 넘치던 것.
		// 이 팝업은 적용 없이 닫는다
		await page.$eval('.data-editor', el => { el.style.width = '650px'; });
		const wrapScroll = () => page.$eval('.data-editor-table-wrap', el => [el.scrollHeight > el.clientHeight, el.scrollWidth > el.clientWidth]);
		assert.deepEqual(await wrapScroll(), [false, false]);
		for (let i = 0; i < 25; i++) { await page.click('.data-editor-tools button'); }
		assert.deepEqual(await wrapScroll(), [true, false], '세로 스크롤만');
		// 다중 팝업: DataEditor가 열려 있는 상태에서 Submission 팝업도 함께 띄우기
		await submissionRoot.click({ button: 'right' });
		await page.waitForSelector('.context-menu');
		await page.$eval('.context-menu button', button => button.click());
		await page.waitForSelector('.submission-editor[open]');
		assert.equal(await page.$$eval('.popup[open]', popups => popups.length), 2, 'DataEditor와 SubmissionEditor가 동시에 2개 이상 띄워짐');
		// ref 데이터 선택: 체크리스트로 여러 개를 고르고(기존 값 유지·고른 순서), DataList는 action도 정한다
		await page.type('#submission-ref', 'data:json,dma_old');
		await page.$eval('.submission-editor .field-action', b => b.click());
		await page.waitForSelector('.data-ref-picker');
		assert.deepEqual(await page.$$eval('.data-ref-id', ls => ls.map(l => [l.querySelector('span').textContent, l.querySelector('input').checked])),
			[['dataList1', false], ['dma_old', true]], '화면의 데이터 + 기존 값에만 있는 id');
		assert.ok(await page.$eval('.data-ref-picker select[aria-label="dataList1 Action"]', s => s.disabled), '체크하기 전 Action 비활성');
		await page.$eval('.data-ref-id input', c => c.click());
		await page.select('.data-ref-picker select[aria-label="dataList1 Action"]', 'modified');
		assert.equal(await page.$eval('.data-ref-preview', o => o.textContent), 'data:json,[\n  {"id":"dma_old"},\n  {"action":"modified","id":"dataList1"}\n]');
		// 창 높이는 처음 뜰 때 고정: 내용이 넘쳐도 미리 보기는 안 눌리고(글자 안 삐져나옴) 본문이 스크롤
		assert.deepEqual(await page.evaluate(async () => {
			const popup = document.querySelector('.data-ref-popup'), height = popup.style.height;
			const preview = document.querySelector('.data-ref-preview'), body = document.querySelector('.data-ref-picker'), text = preview.textContent;
			preview.textContent = Array.from({ length: 8 }, (_, i) => `line${i}`).join('\n');
			popup.style.height = '260px';
			await new Promise(requestAnimationFrame);
			const result = [preview.scrollHeight <= preview.clientHeight, body.scrollHeight > body.clientHeight];
			popup.style.height = height; preview.textContent = text;
			return result;
		}), [true, true], '미리 보기 안 넘침');
		await page.$eval('.data-ref-picker .segmented button:last-child', b => b.click());
		assert.ok(await page.$eval('.data-ref-preview', o => o.textContent.startsWith('data:array,[')), 'array 형식');
		await page.$eval('.data-ref-picker .segmented button:first-child', b => b.click());
		await page.$$eval('.data-ref-id input', cs => cs[1].click());
		assert.equal(await page.$eval('.submission-editor .form-sections', e => e.scrollHeight > e.clientHeight), false, '서브미션 본문은 스크롤 안 생김');
		await page.screenshot({path:path.join(tmpdir(), 'ws5-submission-data-ref.png')});
		await page.$eval('.data-ref-popup .btn-primary', b => b.click());
		assert.deepEqual(await page.evaluate(() => [!!document.querySelector('.data-ref-picker'), document.querySelector('#submission-ref').value]),
			[false, 'data:json,{"action":"modified","id":"dataList1"}'], '적용하면 ref에 채우고 패널 닫힘');
		// 팝업이 떠 있는 상태에서도 배경의 Outline 탭 전환 및 상호작용 가능 (non-modal)
		await page.evaluate(() => window.tab('Outline', '.pane').click());
		assert.equal(await page.$$eval('.pane .tree-row', rows => rows.length), 3, '팝업 뒤 배경과 상호작용 가능(Body + 자식 2)');
		await page.evaluate(() => window.tab('Data', '.pane').click());
		// 타이틀바 닫기 버튼으로 SubmissionEditor 닫기
		await page.$eval('.submission-editor .popup-close', btn => btn.click());
		await page.waitForFunction(() => !document.querySelector('.submission-editor'));
		assert.equal(await page.$$eval('.popup[open]', popups => popups.length), 1, 'SubmissionEditor만 닫히고 DataEditor는 유지');
		// 타이틀바 닫기 버튼으로 DataEditor 닫기
		await page.$eval('.data-editor .popup-close', btn => btn.click());
		await page.waitForFunction(() => !document.querySelector('.data-editor'));
		// 기존 Submission 더블클릭 → 추가 팝업을 수정 모드로 재사용, 값이 채워지고 확인하면 editSubmission
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test" xmlns:xf="http://www.w3.org/2002/xforms"><body/><head><xf:model><xf:submission id="sbm_sel1" action="/api/sel" method="get" mode="synchronous"/></xf:model></head></html>';
			window.sent.length = 0;
			window.send({ type: 'document', version: 50, text, root: window.parseXml(text), script: { text: 'scwin.sbm_sel1_submitdone = function(e) {\n};\n' } });
		});
		await page.evaluate(() => [...document.querySelectorAll('.pane .tree-row')].find(r => r.textContent.includes('Submission'))?.click());
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row')].some(r => r.textContent.includes('sbm_sel1'))
			|| (document.querySelector('.pane .tree-row[aria-expanded="false"]')?.click(), false));
		await page.evaluate(() => [...document.querySelectorAll('.pane .tree-row')].find(r => r.textContent.includes('sbm_sel1')).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
		await page.waitForSelector('.submission-editor[open]');
		assert.equal(await page.$eval('.submission-editor .popup-title', el => el.textContent), 'Submission서브미션 수정');
		assert.deepEqual(await page.$$eval('#submission-id, #submission-action, #submission-method, #submission-mode, #submission-media', els => els.map(e => e.value)), ['sbm_sel1', '/api/sel', 'get', 'synchronous', '']);
		await page.$eval('#submission-action', el => el.focus());
		await page.keyboard.type('2');
		// 처리 중 메시지(processMsg): 비어 있다가 입력하면 수정 요청에 들어감
		assert.equal(await page.$eval('#submission-processMsg', el => el.value), '');
		await page.focus('#submission-processMsg');
		await page.keyboard.type('조회중입니다...');
		// 수정 팝업 코드 버튼: 비어 있으면 scwin.{id}_{이벤트}. Script에 이미 정의가 있어 그리로 이동, 속성·입력칸은 그 이름으로
		await page.click('.submission-editor button[aria-label="submitdone Script"]');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'ev:submitdone' && m.value === 'scwin.sbm_sel1_submitdone'));
		assert.equal(await page.$eval('#submission-submitdone', el => el.value), 'scwin.sbm_sel1_submitdone');
		await page.screenshot({path:path.join(tmpdir(), 'ws5-submission-events.png')});
		assert.ok(await page.evaluate(() => window.tab('Script').classList.contains('active')), 'Script 탭으로');
		await page.evaluate(() => window.tab('Design').click());
		// 버튼(코드)으로 연 Script도 다른 탭으로 가면 숨기기만(편집기 유지: 커서·Ctrl+Z 기록)
		assert.ok(await page.$('.canvas-frame .tab-body[hidden] .cm-editor'), '코드로 연 Script 탭 유지');
		await page.$eval('.submission-actions .btn-primary', b => b.click());
		await page.waitForFunction(() => window.sent.some(m => m.type === 'editSubmission'));
		const editMsg = await page.evaluate(() => window.sent.find(m => m.type === 'editSubmission'));
		assert.equal(editMsg.fields.action, '/api/sel2');
		assert.equal(editMsg.fields.id, 'sbm_sel1');
		assert.equal(editMsg.fields.processMsg, '조회중입니다...');
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'addSubmission' || m.type === 'editSubmission').popup, ok: true }));
		await page.waitForFunction(() => !document.querySelector('.submission-editor'));
		console.log('Data: Submission 더블클릭 → 수정 팝업·값 채움·수정 요청 passed');
		// 값 바인딩: Data 트리의 dataMap key를 캔버스 컴포넌트에 떨구면 그 컴포넌트 ref에 data:{map}.{key}
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test" xmlns:xf="http://www.w3.org/2002/xforms"><body><w2:input id="ipt_bind" label="B"/></body><head><xf:model><w2:dataCollection xmlns:w2="http://www.inswave.com/websquare" baseNode="map"><w2:dataMap id="dataMap1"><w2:keyInfo><w2:key id="m_bucd_from" name="from"/></w2:keyInfo></w2:dataMap></w2:dataCollection></xf:model></head></html>';
			window.sent.length = 0;
			window.send({ type: 'document', version: 60, text, root: window.parseXml(text), script: { text: '' } });
		});
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row')].some(r => r.textContent.includes('m_bucd_from'))
			|| (document.querySelector('.pane .tree-row[aria-expanded="false"] .chevron')?.click(), false));
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('[data-tag="w2:input"]'));
		await page.evaluate(() => {
			const dt = new DataTransfer();
			const row = [...document.querySelectorAll('.pane .tree-row')].find(r => r.textContent.includes('m_bucd_from'));
			row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, composed: true, dataTransfer: dt }));
			const input = document.querySelector('.canvas-host').shadowRoot.querySelector('[data-tag="w2:input"]');
			input.dispatchEvent(new DragEvent('dragover', { bubbles: true, composed: true, cancelable: true, dataTransfer: dt }));
			input.dispatchEvent(new DragEvent('drop', { bubbles: true, composed: true, cancelable: true, dataTransfer: dt }));
		});
		const bind = await page.evaluate(() => window.sent.find(m => m.type === 'setAttr' && m.name === 'ref'));
		assert.equal(bind?.value, 'data:dataMap1.m_bucd_from', JSON.stringify(bind));
		console.log('Data: key → 컴포넌트 드래그 앤 드롭 ref 바인딩 passed');
}
