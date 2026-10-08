import assert from 'node:assert/strict';

export async function pickProperty(page, key, value) {
	await page.evaluate(k => [...document.querySelectorAll('.kv tr')].find(tr => tr.querySelector('.key')?.textContent === k).querySelector('.value').click(), key);
	await page.waitForSelector('.combo-list li');
	await page.evaluate(v => [...document.querySelectorAll('.combo-list li')].find(l => l.textContent === v).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })), value);
}

export function helpers(page) {
	const reset = async text => {
		await page.evaluate(text => { const v = window.editor(); v.dispatch({ changes: {from:0, to:v.state.doc.length, insert:text}, selection:{anchor:text.length} }); v.focus(); }, text);
		await page.waitForFunction(() => !document.querySelector('.cm-tooltip-autocomplete'));
	};
	const content = () => page.evaluate(() => window.editor().state.doc.toString());
	const modifiedKey = async (modifier, key) => {
		await page.keyboard.down(modifier); await page.keyboard.press(key); await page.keyboard.up(modifier);
	};
	// 들여쓰기 단위 4칸: 4칸씩 중첩한 코드의 세로선은 단계마다 하나(2칸 단위면 두 배로 그려진다), Tab은 4칸
	const checkIndentUnit = async label => {
		await reset('a {\n    b {\n        c;\n    }\n}');
		const counts = () => page.evaluate(() => [...document.querySelectorAll('.tab-body:not([hidden]) .cm-line')]
			.map(line => (getComputedStyle(line).getPropertyValue('--indent-markers').match(/linear-gradient/g) ?? []).length));
		await page.waitForFunction(() => document.querySelectorAll('.tab-body:not([hidden]) .cm-line.cm-indent-markers').length, {timeout: 3000});
		assert.deepEqual(await counts(), [0, 1, 2, 1, 0], `${label}: 줄별 세로선 수`);
		await reset('');
		await page.keyboard.press('Tab');
		assert.equal(await content(), '    ', `${label}: Tab은 4칸`);
	};
	const clickTab = name => page.waitForFunction(name => {
		const button = window.tab(name);
		if (button.getAttribute('aria-selected') !== 'true') { button.click(); }
		return button.getAttribute('aria-selected') === 'true';
	}, { polling: 50, timeout: 5000 }, name);
	const lastSent = type => page.evaluate(type => window.sent.findLast(m => m.type === type), type);
	const javaText = 'public class A {\n    private MemberService memberService;\n    void list() { memberService.find(1); }\n}\n';
	return { page, reset, content, modifiedKey, checkIndentUnit, clickTab, lastSent, pickProperty, javaText };
}
