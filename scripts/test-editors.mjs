// 실제 웹뷰·CSP 검증. 기능 이름을 지정하면 해당 파일만 새 페이지에서 실행한다.
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { selectTests } from './test-selection.mjs';
import { createHarness } from './editors/harness.mjs';
import { helpers } from './editors/helpers.mjs';

const available = (await readdir(new URL('./editors/', import.meta.url))).filter(name => name.endsWith('.test.mjs')).map(name => name.slice(0, -9)).sort();
const { names, list } = selectTests(process.argv.slice(2), available);
if (list) {
	console.log(names.join('\n'));
} else {
	const started = performance.now();
	const harness = await createHarness();
	try {
		for (const name of names) {
			const start = performance.now();
			const context = await harness.browser.createBrowserContext();
			try {
				const page = await context.newPage();
				await page.setViewport({ width: 1200, height: 800 });
				const errors = [];
				page.on('pageerror', error => errors.push(error.message));
				page.on('console', msg => { if (msg.type() === 'error') { errors.push(msg.text()); } });
				await page.goto(harness.url);
				await page.waitForSelector('.tab-bar button');
				await page.waitForSelector('.pane .tree-row');
				await page.waitForFunction(() => window.initialDocument && window.testDefs && document.querySelector('.canvas-host')?.shadowRoot?.querySelector('input[data-wse]'));
				const { default: test } = await import(`./editors/${name}.test.mjs`);
				await test(helpers(page));
				assert.deepEqual(errors, [], name + ': browser errors');
				console.log(`[${name}] passed (${((performance.now() - start) / 1000).toFixed(2)}s)`);
			} catch (error) {
				process.exitCode = 1;
				console.error(`[${name}] failed`, error);
			} finally { await context.close(); }
		}
	} finally { await harness.close(); }
	console.log(`웹뷰 ${names.length}개 묶음: ${((performance.now() - started) / 1000).toFixed(2)}s`);
}
