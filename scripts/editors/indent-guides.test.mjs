import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';

export default async function ({ page, clickTab, reset }) {
	await clickTab('Script');
	await reset('if (a) {\n    if (b) {\n        if (c) {\n            if (d) {\n                run();\n            }\n        }\n    }\n}');
	await page.evaluate(() => {
		document.body.style.setProperty('--vscode-editorIndentGuide-background1', '#ff00ff');
		document.body.style.setProperty('--vscode-editorIndentGuide-activeBackground1', '#ff00ff');
	});
	const viewport = page.viewport();
	for (const [i, scale] of [1, 1.25, 1.5, 1.75, 2].entries()) {
		// 배율 에뮬레이션만으로는 창 이벤트가 발생하지 않으므로 창 크기도 바꿔 모니터 이동 조건을 재현한다.
		await page.setViewport({ ...viewport, width: viewport.width + i % 2, deviceScaleFactor: scale });
		await page.evaluate(() => window.dispatchEvent(new Event('resize')));
		await page.waitForFunction(scale => parseFloat(getComputedStyle(window.editor().dom).getPropertyValue('--indent-guide-pixel')) === 1 / scale, {}, scale);
		await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
		const clip = await page.evaluate(() => {
			const v = window.editor(), p = v.coordsAtPos(v.state.doc.line(5).from + 16), line = document.querySelectorAll('.tab-body:not([hidden]) .cm-line')[4].getBoundingClientRect();
			return { x: line.left, y: line.top, width: p.left - line.left - 1, height: line.height };
		});
		const png = await page.screenshot({ path: path.join(tmpdir(), `ws5-indent-${scale}.png`) });
		const widths = await page.evaluate(async (base64, clip, scale) => {
			const img = new Image(); img.src = 'data:image/png;base64,' + base64; await img.decode();
			const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
			const g = canvas.getContext('2d'); g.drawImage(img, 0, 0);
			const pixels = g.getImageData(Math.round(clip.x * scale), Math.floor((clip.y + clip.height / 2) * scale), Math.floor(clip.width * scale), 1).data, widths = [];
			let run = 0;
			for (let x = 0; x <= pixels.length / 4; x++) {
				const magenta = x < pixels.length / 4 && pixels[x * 4] > 150 && pixels[x * 4 + 1] < 100 && pixels[x * 4 + 2] > 150;
				if (magenta) { run++; } else if (run) { widths.push(run); run = 0; }
			}
			return widths;
		}, png.toString('base64'), clip, scale);
		console.log(`Indent guides ${scale * 100}%: ${widths.join(',')} physical pixels`);
		assert.equal(widths.length, 4, '들여쓰기 단계별 안내선 유지');
		assert.ok(widths.every(w => w === 1), `${scale * 100}% 안내선 두께: ${widths}`);
	}
	await page.setViewport(viewport);
}
