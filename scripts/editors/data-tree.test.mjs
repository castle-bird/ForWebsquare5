import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';

export default async function ({ page }) {
	// Data 트리 끌어 옮기기: submission끼리·dataMap/dataList끼리만, 루트에 놓으면 맨 뒤, 다른 종류에는 못 놓음
	const dataIds = await page.evaluate(() => {
		const text = '<html xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms"><head><xf:model><w2:dataCollection baseNode="map"><w2:dataMap id="dm1"/><w2:dataList id="dl1"/></w2:dataCollection><xf:submission id="s1"/><xf:submission id="s2"/></xf:model></head><body/></html>';
		const root = window.parseXml(text);
		window.send({ type: 'document', version: 950, text, root, script: { text: '' } });
		const ids = {}; const walk = n => { ids[n.attrs.id ?? n.tag] = n.index; n.children.forEach(walk); }; walk(root); return ids;
	});
	await page.evaluate(() => window.tab('Data', '.pane').click());
	await page.evaluate(() => [...document.querySelectorAll('.pane .codicon-expand-all')].at(-1)?.click());
	await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row .id')].some(e => e.textContent === 's2'));
	const dragTo = (from, to, where) => page.evaluate((from, to, where) => {
		const row = id => [...document.querySelectorAll('.pane .tree-row')].find(r => (r.querySelector('.id')?.textContent ?? r.querySelector('.tag')?.textContent) === id);
		const a = row(from), b = row(to), dt = new DataTransfer(), r = b.getBoundingClientRect();
		const y = r.top + r.height * (where === 'before' ? 0.2 : 0.8);
		a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
		const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y });
		b.dispatchEvent(over);
		window.sent.length = 0;
		return new Promise(res => setTimeout(() => { b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y })); a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); res({ accepted: over.defaultPrevented, sent: window.sent.find(m => m.type === 'move') ?? null }); }, 50));
	}, from, to, where);
	assert.deepEqual(await dragTo('s2', 's1', 'before'), { accepted: true, sent: { type: 'move', version: 950, dragged: dataIds.s2, target: dataIds.s1, position: 'before' } }, 'submission끼리 앞으로');
	assert.deepEqual(await dragTo('dm1', 'dl1', 'after'), { accepted: true, sent: { type: 'move', version: 950, dragged: dataIds.dm1, target: dataIds.dl1, position: 'after' } }, 'dataMap → dataList 뒤');
	assert.deepEqual(await dragTo('s1', 'Submission', 'after'), { accepted: true, sent: { type: 'move', version: 950, dragged: dataIds.s1, target: dataIds['xf:model'], position: 'inside' } }, 'Submission 루트 → model 맨 뒤');
	assert.deepEqual(await dragTo('s1', 'dm1', 'before'), { accepted: false, sent: null }, '다른 종류에는 못 놓음');
	// 화면 점검: Data 줄에 경고(마우스를 올리면 이유), 접힌 줄은 안쪽 문제를 흐리게
	await page.evaluate(() => {
		const text = '<html xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms" xmlns:ev="urn:ev"><head><xf:model><w2:dataCollection baseNode="map"><w2:dataMap id="dm1"/><w2:dataList id="dm1"/></w2:dataCollection><xf:submission id="s1" ev:submitdone="scwin.s1_done"/><xf:submission id="s2" ref="data:json,dl_none" ev:submitdone="scwin.s2_done"/></xf:model></head><body/></html>';
		window.send({ type: 'document', version: 950, text, root: window.parseXml(text), script: { text: 'scwin.s2_done = function () {};' } });
	});
	const problemOf = id => page.evaluate(id => [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.id')?.textContent === id)?.querySelector('.tree-problem')?.title ?? null, id);
	await page.waitForFunction(() => document.querySelectorAll('.pane .tree-row .tree-problem').length >= 3, {timeout: 3000})
		.catch(async () => assert.fail(`경고 수: ${await page.$$eval('.pane .tree-row .tree-problem', e => e.length)}`));
	assert.equal(await problemOf('dm1'), 'ID가 중복되었습니다. dm1 (2곳)');
	assert.equal(await problemOf('s1'), '등록되지 않은 handler가 적용되어 있습니다. scwin.s1_done');
	assert.equal(await problemOf('s2'), null, '화면에 없는 데이터(스크립트에서 만듦)는 경고 안 함');
	await page.evaluate(() => [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.tag')?.textContent === 'Submission')?.querySelector('.chevron').click());
	await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.tag')?.textContent === 'Submission')?.querySelector('.tree-problem.inside'), {timeout: 3000});
	// 경고 개수 버튼: 누를 때마다 다음 경고 줄을 펼쳐 선택하고 이유를 알림으로(마지막 다음은 처음)
	assert.equal(await page.evaluate(() => [...document.querySelectorAll('.pane .tree-problems')].find(b => b.offsetParent)?.textContent), '3');
	const nextProblemRow = async () => {
		await page.evaluate(() => [...document.querySelectorAll('.pane .tree-problems')].find(b => b.offsetParent).click());
		return page.evaluate(() => ({ id: document.querySelector('.pane .tree-row.selected .id')?.textContent, toast: document.querySelector('.toast')?.textContent }));
	};
	assert.deepEqual(await nextProblemRow(), { id: 'dm1', toast: '경고 1/3\nID가 중복되었습니다. dm1 (2곳)' });
	assert.deepEqual(await nextProblemRow(), { id: 'dm1', toast: '경고 2/3\nID가 중복되었습니다. dm1 (2곳)' });
	await page.screenshot({path:path.join(tmpdir(), 'ws5-problem-toast.png')});
	assert.deepEqual(await nextProblemRow(), { id: 's1', toast: '경고 3/3\n등록되지 않은 handler가 적용되어 있습니다. scwin.s1_done' }, '접힌 Submission을 펼쳐 선택');
	assert.equal((await nextProblemRow()).toast, '경고 1/3\nID가 중복되었습니다. dm1 (2곳)', '마지막 다음은 처음');
	await page.evaluate(() => window.tab('Outline', '.pane').click());
	console.log('Data: 트리 끌어 옮기기, 화면 점검 경고 passed');
}
