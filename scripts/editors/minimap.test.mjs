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
	await page.evaluate(() => { const sc = window.editor().scrollDOM; sc.scrollTop = sc.scrollHeight; });
	await page.waitForFunction(() => {
		const v = window.editor(), end = v.coordsAtPos(v.state.doc.length), sc = v.scrollDOM.getBoundingClientRect();
		return end && end.top >= sc.top - 1 && end.bottom < sc.top + v.defaultLineHeight * 2;
	});
	assert.equal(await page.evaluate(() => window.editor().state.doc.lines), 3000, '하단 여백은 문서 줄을 추가하지 않음');
	assert.ok(await page.evaluate(() => {
		const mm = document.querySelector('.tab-body:not([hidden]) .cm-minimap'), slider = mm.querySelector('.cm-minimap-slider');
		return slider.getBoundingClientRect().bottom <= mm.getBoundingClientRect().bottom + 1;
	}), '하단 여백에서도 미니맵 슬라이더는 영역 안에 유지');
	console.log('Editor: 마지막 줄을 위로 올리고 번호 없는 하단 여백 표시 passed');
}
