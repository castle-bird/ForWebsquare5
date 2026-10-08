import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';

export default async function ({ clickTab, page, reset, javaText }) {
	await clickTab('Script');
	const marks = () => page.evaluate(() => {
		const body = document.querySelector('.tab-body:not([hidden])');
		const gutter = [...body.querySelectorAll('.cm-changes-gutter .cm-gutterElement')].flatMap(e => {
			const kind = e.querySelector('.cm-change')?.className.match(/cm-change-(\w+)/)?.[1];
			return kind ? [`${window.editor().state.doc.lineAt(window.editor().lineBlockAtHeight(e.offsetTop + 1).from).number}:${kind}`] : [];
		});
		return { gutter, ruler: [...body.querySelectorAll('.cm-change-ruler .cm-change-mark')].map(e => e.className.match(/cm-change-(\w+)$/)[1]) };
	});
	// 입력이 멈춘 뒤 다시 비교하므로 표시가 기대대로 바뀔 때까지 기다린다
	const marksAre = async (expected, label) => {
		for (let i = 0; i < 60 && JSON.stringify(await marks()) !== JSON.stringify(expected); i++) {
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		assert.deepEqual(await marks(), expected, label);
	};
	await reset('a\nB\nc\nd');
	await page.evaluate(() => window.send({ type: 'gitBase', target: 'script', text: 'a\r\nb\r\nc' }));
	await page.waitForFunction(() => document.querySelectorAll('.tab-body:not([hidden]) .cm-change-ruler .cm-change-mark').length === 2, {timeout: 3000})
		.catch(async () => assert.fail(`변경 표시 없음: ${JSON.stringify(await marks())}`));
	assert.deepEqual(await marks(), { gutter: ['2:modified', '4:added'], ruler: ['modified', 'added'] }, '수정·추가 (기준 CRLF도 줄 단위로)');
	// 미니맵 왼쪽 끝에도 같은 색 막대(2번 줄 수정, 4번 줄 추가, 1번 줄 없음)
	const minimapChange = () => page.evaluate(() => {
		const canvas = document.querySelector('.tab-body:not([hidden]) .cm-minimap canvas'), g = canvas.getContext('2d'), r = window.devicePixelRatio || 1;
		const at = line => [...g.getImageData(0, Math.floor(((line - 1) * 2 + 1) * r), 1, 1).data].join(',');
		return [at(1), at(2), at(4)];
	});
	for (let i = 0; i < 40 && (await minimapChange())[1].endsWith(',0'); i++) { await new Promise(resolve => setTimeout(resolve, 50)); }
	const [line1, line2, line4] = await minimapChange();
	assert.ok(line1.endsWith(',0') && !line2.endsWith(',0') && !line4.endsWith(',0') && line2 !== line4, `미니맵 Git 변경 막대: ${line1} / ${line2} / ${line4}`);
	await page.screenshot({path:path.join(tmpdir(), 'ws5-git-changes.png'), clip: await page.$eval('.tab-body:not([hidden]) .code-editor', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: 110 }; })});
	// 짧은 파일: 띠의 표시가 그 줄 높이에 있다
	assert.ok(await page.evaluate(() => {
		const body = document.querySelector('.tab-body:not([hidden])'), mark = body.querySelector('.cm-change-ruler .cm-change-mark').getBoundingClientRect();
		const line = window.editor().coordsAtPos(window.editor().state.doc.line(2).from);
		return Math.abs(mark.top - line.top) < 8;
	}), '띠 표시 위치 = 줄 위치');
	await page.evaluate(() => { const v = window.editor(); v.dispatch({ changes: { from: 0, to: 1, insert: 'A' } }); });
	await page.waitForFunction(() => document.querySelectorAll('.tab-body:not([hidden]) .cm-change-ruler .cm-change-mark').length === 2 && Math.abs(document.querySelector('.tab-body:not([hidden]) .cm-change-ruler .cm-change-mark').getBoundingClientRect().top - window.editor().coordsAtPos(0).top) < 8);
	await marksAre({ gutter: ['1:modified', '2:modified', '4:added'], ruler: ['modified', 'added'] }, '입력이 멈추면 다시 비교');
	await reset('a\nc');
	await marksAre({ gutter: ['2:deleted'], ruler: ['deleted'] }, '지운 줄은 그 아래 줄에 표시');
	await page.evaluate(() => window.send({ type: 'gitBase', target: 'script' }));
	await page.waitForFunction(() => !document.querySelector('.tab-body:not([hidden]) .cm-change-ruler .cm-change-mark'));
	assert.deepEqual((await marks()).gutter, [], '기준이 없으면(Git 밖) 표시 없음');
	// 연결 탭도 같은 방식(대상 link:{id})
	await page.evaluate(text => { window.send({ type: 'linked', kind: 'controller', path: 'src/A.java', text, version: 60 }); window.send({ type: 'gitBase', target: 'link:controller', text: text.replace('memberService.find(1)', 'x()') }); }, javaText);
	await clickTab('Controller');
	await page.waitForFunction(() => document.querySelectorAll('.tab-body:not([hidden]) .cm-change-ruler .cm-change-mark').length === 1, {timeout: 3000});
	assert.deepEqual(await marks(), { gutter: ['3:modified'], ruler: ['modified'] });
	console.log('Git changes: 수정·추가·삭제 표시·입력이 멈추면 갱신·연결 탭 passed');
	// Git blame: 커서 줄 끝 "작성자 · n일 전"(커밋 안 된 줄은 커밋 안 됨), 지금 문서 버전 것만, 편집하면 숨김, 톱니바퀴에서 끄기
	{
		await clickTab('Script');
		// 앞 테스트가 남긴 충돌 안내가 있으면 다시 불러온 뒤, 편집기 문서 버전을 알 수 있게 화면 문서를 새 버전으로 보낸다(Script 3줄)
		await page.evaluate(() => document.querySelector('.tab-body:not([hidden]) .code-banner button')?.click());
		let docVersion = 5000000;
		const sendDoc = () => page.evaluate(v => window.send({ ...window.initialDocument, version: v, script: { ...window.initialDocument.script, text: 'a\nb\nc' } }), docVersion += 10);
		await sendDoc();
		await page.waitForFunction(() => window.editor().state.doc.toString() === 'a\nb\nc');
		const shownBlame = () => page.evaluate(() => document.querySelector('.tab-body:not([hidden]) .cm-blame')?.textContent ?? null);
		const sendBlame = version => page.evaluate(version => {
			const now = Date.now() / 1000;
			window.send({ type: 'blame', target: 'script', version, data: { authors: ['홍길동'], author: [0, -1, 0], time: [now - 3 * 86400 - 60, now, now - 7200] } });
		}, version ?? docVersion);
		const cursorAt = line => page.evaluate(line => { const v = window.editor(); v.dispatch({ selection: { anchor: v.state.doc.line(line).from } }); v.focus(); }, line);
		await sendBlame(docVersion - 1);
		await cursorAt(1);
		assert.equal(await shownBlame(), null, '다른 문서 버전 blame은 안 씀');
		await sendBlame();
		await page.waitForFunction(() => document.querySelector('.tab-body:not([hidden]) .cm-blame'), { timeout: 2000 }).catch(() => assert.fail('blame 표시'));
		assert.equal(await shownBlame(), '홍길동 · 3일 전');
		await cursorAt(2);
		assert.equal(await shownBlame(), '커밋 안 됨');
		await cursorAt(3);
		assert.equal(await shownBlame(), '홍길동 · 2시간 전');
		assert.equal(await page.$$eval('.tab-body:not([hidden]) .cm-blame', e => e.length), 1, '커서 줄에만');
		await page.keyboard.type('x');
		assert.equal(await shownBlame(), null, '편집하면 다음 blame까지 숨김');
		// 보낸 편집이 처리된 뒤 새 문서(편집 중이면 문서를 덮지 않는다)
		await new Promise(r => setTimeout(r, 200));
		await sendDoc();
		await page.waitForFunction(() => window.editor().state.doc.toString() === 'a\nb\nc');
		await sendBlame();
		await page.waitForFunction(() => document.querySelector('.tab-body:not([hidden]) .cm-blame'), { timeout: 2000 }).catch(() => assert.fail('새 blame 다시 표시'));
		// 톱니바퀴 → 코드 Git blame 끄기(모든 화면 공통 저장)
		await page.click('.canvas-frame .tab-settings');
		await page.waitForSelector('.context-menu [role="menuitemcheckbox"]');
		await page.evaluate(() => [...document.querySelectorAll('.context-menu [role="menuitemcheckbox"]')].find(b => b.textContent === '코드 Git blame').click());
		assert.equal(await shownBlame(), null, '끄면 표시 없음');
		assert.deepEqual(await page.evaluate(() => window.sent.findLast(m => m.type === 'setCodeBlame')), { type: 'setCodeBlame', on: false }, '설정 저장 요청');
		await page.evaluate(() => window.send({ type: 'codeBlame', on: true }));
		await page.waitForFunction(() => document.querySelector('.tab-body:not([hidden]) .cm-blame'), { timeout: 2000 }).catch(() => assert.fail('다시 켜면 받아 둔 blame 표시'));
		console.log('Script: Git blame 커서 줄 끝·문서 버전·편집 중 숨김·켜고 끄기 passed');
	}
}
