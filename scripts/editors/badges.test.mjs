import assert from 'node:assert/strict';

export default async function ({ page }) {
		// 표시: ref 있으면 초록, ev:* 있으면 빨강 (둘 다면 초록 → 빨강 순)
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test" xmlns:ev="http://www.w3.org/2001/xml-events"><body><w2:input id="a" ref="data:m.k" ev:onclick="scwin.a_onclick"/><w2:input id="b" ev:onblur="scwin.b"/><w2:input id="c"/></body></html>';
			window.send({ type: 'document', version: 70, text, root: window.parseXml(text), script: { text: '' } });
		});
		const badges = () => page.evaluate(() => [...document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-badges')].map(b => [...b.children].map(s => s.className).join(',')));
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-badges').length === 2);
		assert.deepEqual(await badges(), ['bind,event', 'event']);
		console.log('Design: ref·event 표시 점 passed');
		// 표시 점은 중첩 스크롤·요소 크기·위치 이동을 따라가고, DOM 교체 후 새 요소를 감시한다.
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test" xmlns:ev="urn:ev"><body><div xmlns="http://www.w3.org/1999/xhtml" id="badge_clip" style="height:80px;width:200px;overflow:auto"><div id="badge_shift" style="height:20px"/><w2:input id="badge_first" style="display:block;height:24px" ref="data:m.k" ev:onclick="scwin.first"/><div style="height:140px"/><w2:input id="badge_last" style="display:block;height:24px" ref="data:m.k"/></div></body></html>';
			const root = window.parseXml(text);
			const walk = n => { if (n.tag === 'w2:input') { n.def = 0; } n.children.forEach(walk); }; walk(root);
			window.send({ type: 'document', version: 71, text, root, script: { text: '' } });
			window.badgeAligned = id => {
				const shadow = document.querySelector('.canvas-host').shadowRoot, p = shadow.querySelector('.wse-page');
				const el = shadow.getElementById(id), badges = shadow.querySelectorAll('.wse-badges');
				return el && badges.length === 1 && Math.abs(parseFloat(badges[0].style.top) - (el.getBoundingClientRect().top - p.getBoundingClientRect().top)) < 1;
			};
		});
		await page.waitForFunction(() => window.badgeAligned('badge_first'));
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.getElementById('badge_shift').style.height = '32px');
		await page.waitForFunction(() => window.badgeAligned('badge_first'));
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.getElementById('badge_clip').scrollTop = 999);
		await page.waitForFunction(() => window.badgeAligned('badge_last'));
		assert.deepEqual(await badges(), ['bind'], '스크롤 밖 표시 점은 숨김');
		await page.evaluate(() => {
			const shadow = document.querySelector('.canvas-host').shadowRoot;
			const old = shadow.getElementById('badge_last'), replacement = old.cloneNode(true);
			window.replacedBadge = old;
			old.replaceWith(replacement);
		});
		await page.waitForFunction(() => window.badgeAligned('badge_last'));
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.getElementById('badge_last').style.height = '40px');
		await page.waitForFunction(() => window.badgeAligned('badge_last'));
		// ResizeObserver가 아닌 위치 이동도 감시(앞 공간과 뒤 공간의 합계 높이는 유지).
		await page.evaluate(() => {
			const shadow = document.querySelector('.canvas-host').shadowRoot, clip = shadow.getElementById('badge_clip');
			clip.scrollTop = 0;
			shadow.getElementById('badge_shift').style.height = '20px';
		});
		await page.waitForFunction(() => window.badgeAligned('badge_first'));
		await page.evaluate(() => {
			const shadow = document.querySelector('.canvas-host').shadowRoot;
			shadow.getElementById('badge_shift').style.height = '28px';
			shadow.getElementById('badge_first').nextElementSibling.style.height = '132px';
		});
		await page.waitForFunction(() => window.badgeAligned('badge_first'));
		// 캔버스 DOM은 다음 문서에서도 React가 그대로 고쳐 쓴다(스크롤 유지) → 손으로 바꾼 노드를 되돌려 둔다
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.getElementById('badge_last').replaceWith(window.replacedBadge));
		console.log('Design: 표시 점 중첩 스크롤·크기·위치 이동·DOM 교체 passed');
}
