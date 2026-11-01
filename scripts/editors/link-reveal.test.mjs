import assert from 'node:assert/strict';

export default async function ({ page }) {
	// Controller로 이동: 한 번도 안 본 연결 탭이면 편집기가 탭이 보인 뒤에 생긴다. 그래도 그 메서드를 선택하고 편집기로 포커스
	const java = Array.from({ length: 80 }, (_, i) => i === 60 ? '\tpublic void selectList() {}' : `\t// line ${i}`).join('\n');
	await page.evaluate(text => window.send({ type: 'linked', kind: 'controller', path: 'src/A.java', text, version: 5 }), java);
	await page.evaluate(() => window.send({ type: 'reveal', target: 'link:controller', line: 60, ch: 13, endLine: 60, endCh: 23 }));
	await page.waitForFunction(() => document.querySelector('.canvas-frame .tab-bar [aria-selected="true"]')?.textContent === 'Controller');
	await page.waitForFunction(() => window.editor?.()?.hasFocus, { timeout: 3000 });
	assert.deepEqual(await page.evaluate(() => { const v = window.editor(), s = v.state.selection.main; return [v.state.doc.lineAt(s.from).number, v.state.sliceDoc(s.from, s.to)]; }), [61, 'selectList']);
	console.log('Link: 처음 보는 연결 탭으로 reveal(Controller로 이동) passed');
}
