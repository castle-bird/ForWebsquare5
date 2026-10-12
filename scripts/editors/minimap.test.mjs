import assert from 'node:assert/strict';

export default async function ({ page, clickTab }) {
	const lines = Array.from({ length: 3000 }, (_, i) => 'const value' + i + ' = "color";').join('\n');
	await page.evaluate(text => window.send({ ...window.initialDocument, version: 6000, script: { text } }), lines);
	await clickTab('Script');
	await page.waitForFunction(() => window.editor().state.doc.lines === 3000);
	await page.waitForFunction(() => {
		const canvas = document.querySelector('.tab-body:not([hidden]) .cm-minimap canvas');
		if (!canvas?.height) { return false; }
		const ratio = window.devicePixelRatio || 1, g = canvas.getContext('2d');
		const line = Math.min(250, Math.floor(canvas.height / ratio / 2) - 2);
		const at = n => [...g.getImageData(Math.floor(5 * ratio), Math.floor(((n - 1) * 2 + 0.5) * ratio), 1, 1).data];
		const first = at(1), last = at(line);
		return first[3] > 200 && first.join(',') === last.join(',');
	}, { timeout: 5000 });
	assert.equal(await page.evaluate(() => window.editor().scrollDOM.scrollTop), 0, '스크롤 없이 미니맵 아래쪽까지 문법 색칠');
	assert.equal(await page.evaluate(() => window.editor().state.doc.lines), 3000, '문서 내용 유지');
	console.log('Minimap: 긴 코드 첫 로드에서 스크롤 없이 문법 색칠 passed');
}
