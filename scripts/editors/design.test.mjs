import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';

export default async function ({ page, pickProperty }) {
		// CSS 클래스의 여백을 실제 픽셀로 표시하고 선택·클릭·스크롤을 방해하지 않는다.
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:group id="spacing" class="spacing"><w2:input id="spacedInput" class="spaced-input"/><w2:input id="plainInput" style="padding:0;margin:0;border:0;"/></w2:group></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = window.testDefs.length;
			root.children[0].children[0].children.forEach(n => { n.def = 0; });
			window.send({ type: 'definitions', defs: [...window.testDefs, { id: 'group', ns: 'urn:test', realType: 'group', parents: [], bases: [], properties: [], events: [] }] });
			window.send({ type: 'styles', css: ['.spacing { box-sizing:border-box;width:300px;height:180px;border:3px solid black;padding:10px 20px 30px 40px;margin:11px 12px 13px 14px; } .spaced-input { box-sizing:border-box;width:120px;height:50px;border:2px solid black;padding:4px 5px 6px 7px;margin:8px 9px 10px 11px; }'] });
			window.send({ type: 'document', version: 2, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#spacing'));
		const spacingHover = async id => {
			const point = await page.evaluate(id => {
				const r = document.querySelector('.canvas-host').shadowRoot.querySelector('#' + id).getBoundingClientRect();
				return { x: r.left + 5, y: r.top + 5 };
			}, id);
			await page.mouse.move(point.x, point.y);
		};
		const spacingInfo = id => page.evaluate(id => {
			const s = document.querySelector('.canvas-host').shadowRoot, el = s.querySelector('#' + id), svg = s.querySelector('.wse-spacing');
			const r = el.getBoundingClientRect(), v = svg.getBoundingClientRect();
			return {
				x: r.left - v.left, y: r.top - v.top, width: r.width, height: r.height,
				padding: svg.querySelector('.padding').getAttribute('d'), margin: svg.querySelector('.margin').getAttribute('d'),
				colors: ['.padding', '.margin'].map(c => getComputedStyle(svg.querySelector(c)).fill),
				pointerEvents: getComputedStyle(svg).pointerEvents,
			};
		}, id);
		await spacingHover('spacing');
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-spacing .padding'));
		const box = (x, y, w, h) => `M${x},${y}h${w}v${h}h${-w}Z`;
		let info = await spacingInfo('spacing');
		assert.equal(info.padding, box(info.x + 3, info.y + 3, 294, 174) + box(info.x + 43, info.y + 13, 234, 134), 'padding만 표시하고 border·content는 비움');
		assert.equal(info.margin, box(info.x - 14, info.y - 11, 326, 204) + box(info.x, info.y, 300, 180), '상하좌우 margin');
		assert.deepEqual(info.colors, ['rgba(147, 196, 125, 0.55)', 'rgba(246, 178, 107, 0.55)']);
		assert.equal(info.pointerEvents, 'none');
		await page.mouse.click(...await page.evaluate(() => {
			const r = document.querySelector('.canvas-host').shadowRoot.querySelector('#spacing').getBoundingClientRect();
			return [r.left + 5, r.top + 5];
		}));
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-frame.selected'));
		await spacingHover('spacing');
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-spacing'));
		assert.ok(await page.evaluate(() => !!document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-spacing')), '선택된 컴포넌트도 여백 표시');
		await spacingHover('spacedInput');
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-spacing .padding')?.getAttribute('d').includes('h116v46'));
		info = await spacingInfo('spacedInput');
		assert.equal(info.padding, box(info.x + 2, info.y + 2, 116, 46) + box(info.x + 9, info.y + 6, 104, 36), '일반 입력 컴포넌트에도 padding');
		assert.equal(info.margin, box(info.x - 11, info.y - 8, 140, 68) + box(info.x, info.y, 120, 50));
		// 잘린 자리를 새 padding 경계로 삼지 않는다.
		await page.evaluate(() => {
			const s = document.querySelector('.canvas-host').shadowRoot, group = s.querySelector('#spacing');
			group.style.height = '55px'; group.style.overflow = 'hidden'; group.scrollTop = 10;
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-spacing')?.getBoundingClientRect().height === 49);
		info = await spacingInfo('spacedInput');
		assert.equal(info.padding, box(info.x + 2, info.y + 2, 116, 46) + box(info.x + 9, info.y + 6, 104, 36), '스크롤 후에도 원래 여백 경계 유지');
		await page.evaluate(() => {
			const s = document.querySelector('.canvas-host').shadowRoot;
			s.querySelector('#spacing').style.height = '180px';
			s.querySelector('#spacing').scrollTop = 0;
		});
		await spacingHover('plainInput');
		await page.waitForFunction(() => !document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-spacing'));
		await spacingHover('spacing');
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-spacing'));
		await page.mouse.move(1199, 799);
		await page.waitForFunction(() => !document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-spacing'));
		await page.evaluate(() => {
			window.send({ type: 'styles', css: [] });
			window.send({ type: 'definitions', defs: window.testDefs });
		});
		console.log('Design: Group·일반 컴포넌트 hover padding·margin·선택·스크롤·정리 passed');

		// 다단 헤더: 번호 칸(rowSpan 2)에 header 소속, 헤더 row 높이는 가장 높은 row에 맞춤
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:gridView id="grd" rowNumVisible="true" rowStatusVisible="true"><w2:header id="h"><w2:row id="h1"><w2:column id="hc" inputType="checkbox"/></w2:row><w2:row id="h2"><w2:column id="ht" value="zz"/></w2:row></w2:header><w2:gBody id="b"><w2:row id="r"><w2:column id="a"/></w2:row></w2:gBody></w2:gridView></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 2;
			window.send({ type: 'document', version: 91, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => {
			const rows = document.querySelector('.canvas-host')?.shadowRoot?.querySelectorAll('.w2grid thead tr');
			return rows?.length === 2 && rows[0].style.height && rows[0].style.height === rows[1].style.height;
		});
		assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid thead th.gridHeaderTDDefault_rowNumber').getAttribute('data-wse')), '3', '번호 칸 = w2:header');
		// 상태 칸(번호 칸과 같은 header index)에 올려도 헤더 전체가 hover 배경으로 덮인다
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('th.gridHeaderTDDefault_rowStatus').dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true })));
		await page.waitForFunction(() => {
			const s = document.querySelector('.canvas-host').shadowRoot;
			const hover = s.querySelector('.wse-frame.hover')?.getBoundingClientRect(), head = s.querySelector('.w2grid thead').getBoundingClientRect();
			return hover && Math.abs(hover.width - head.width) < 2 && Math.abs(hover.height - head.height) < 2;
		});
		console.log('Design: 다단 헤더 높이·번호/상태 칸 hover passed');
		// inputType 아이콘: 스킨에 없는 타입은 codicon, radio는 실제 입력 모양, select는 스킨 클래스만
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:gridView id="grd"><w2:gBody id="b"><w2:row id="r"><w2:column id="a" inputType="link"/><w2:column id="c" inputType="radio"/><w2:column id="d" inputType="select"/><w2:column id="e" inputType="secret"/></w2:row></w2:gBody></w2:gridView></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 2;
			window.send({ type: 'document', version: 93, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('.w2grid input[type="radio"]'));
		assert.deepEqual(await page.evaluate(() => [...document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.w2grid tbody td')].map(td => td.querySelector('.wse-input-icon')?.title ?? td.className.match(/gridBodyDefault_(?!data\b)(\w+)/)?.[1])), ['link', 'radio', 'select', 'secret']);
		console.log('Design: 그리드 inputType 아이콘 passed');
		// 그리드 열 너비: 그리드가 좁아도 XML width 그대로(가로 스크롤). autoFit="none"도 같고, allColumn·lastColumn은 남는 폭을 채운다
		const gridWidths = (autoFit, width = 300) => page.evaluate(async (autoFit, width) => {
			const text = `<html xmlns:w2="urn:test"><body><w2:gridView id="grd" style="width:${width}px" rowNumVisible="true"${autoFit ? ` autoFit="${autoFit}"` : ''}><w2:header id="h"><w2:row id="h1"><w2:column id="c1" width="100" value="A"/><w2:column id="c2" width="250" value="B"/></w2:row></w2:header><w2:gBody id="b"><w2:row id="r"><w2:column id="d1"/><w2:column id="d2"/></w2:row></w2:gBody></w2:gridView></body></html>`;
			const root = window.parseXml(text);
			root.children[0].children[0].def = 2;
			window.send({ type: 'document', version: 95, text, root, script: { text: '' } });
			await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
			return [...document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.w2grid thead th')].map(th => Math.round(th.getBoundingClientRect().width));
		}, autoFit, width);
		assert.deepEqual(await gridWidths(''), [40, 100, 250], '열 너비 유지');
		assert.deepEqual(await gridWidths('none'), [40, 100, 250], 'autoFit=none은 안 채움');
		const fitAll = await gridWidths('allColumn', 800);
		assert.ok(fitAll[2] > 250 && fitAll[1] > 100, `allColumn은 모든 열로 채움 ${fitAll}`);
		const fitLast = await gridWidths('lastColumn', 800);
		assert.ok(fitLast[0] === 40 && fitLast[1] === 100 && fitLast[2] > 250, `lastColumn은 마지막 열만 ${fitLast}`);
		// 속성을 바꿔 문서가 다시 와도 그리드 가로 스크롤 위치 유지(캔버스를 통째로 다시 만들지 않는다)
		{
			const sendGrid = (version, value) => page.evaluate(async (version, value) => {
				const text = `<html xmlns:w2="urn:test"><body><w2:gridView id="grd" style="width:200px"><w2:header id="h"><w2:row id="h1"><w2:column id="c1" width="300" value="${value}"/><w2:column id="c2" width="300" value="B"/></w2:row></w2:header><w2:gBody id="b"><w2:row id="r"><w2:column id="d1"/><w2:column id="d2"/></w2:row></w2:gBody></w2:gridView></body></html>`;
				const root = window.parseXml(text);
				root.children[0].children[0].def = 2;
				window.send({ type: 'document', version, text, root, script: { text: '' } });
				await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
			}, version, value);
			const grid = () => 'document.querySelector(".canvas-host").shadowRoot.querySelector(".w2grid")';
			await sendGrid(93, 'A');
			await page.evaluate(`${grid()}.scrollLeft = 150`);
			await sendGrid(94, 'A2');
			assert.equal(await page.evaluate(`${grid()}.scrollLeft`), 150, '속성 바꾼 뒤 가로 스크롤 유지');
			console.log('Design: 속성 변경 후 그리드 가로 스크롤 유지 passed');
		}
		// 우클릭 Header 추가로 header가 두 줄이 돼도 열 너비는 기존 header 기준 그대로(gBody에 width가 없어도 안 줄어듦), 끌기 손잡이도 그 칸에
		const multi = await page.evaluate(async () => {
			const text = '<html xmlns:w2="urn:test"><body><w2:gridView id="grd" style="width:300px" rowNumVisible="true"><w2:header id="h"><w2:row id="h1"><w2:column id="c1" width="100" value="A"/><w2:column id="c2" width="250" value="B"/></w2:row><w2:row id="h2"><w2:column id="x1" width="100"/><w2:column id="x2" width="100"/></w2:row></w2:header><w2:gBody id="b"><w2:row id="r"><w2:column id="d1"/><w2:column id="d2"/></w2:row></w2:gBody></w2:gridView></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 2;
			window.send({ type: 'document', version: 96, text, root, script: { text: '' } });
			await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
			const s = document.querySelector('.canvas-host').shadowRoot;
			return { widths: [...s.querySelectorAll('.w2grid thead tr:first-child th')].map(th => Math.round(th.getBoundingClientRect().width)),
				handles: [...s.querySelectorAll('.w2grid [data-wse-resize]')].map(e => `${e.id || e.getAttribute('data-wse')}:${e.getAttribute('data-wse-resize')}`) };
		});
		assert.deepEqual(multi.widths, [40, 100, 250], '다단 헤더 열 너비');
		assert.equal(multi.handles.length, 2, `손잡이는 기준 칸 둘: ${multi.handles}`);
		console.log('Design: 그리드 열 너비·autoFit·다단 헤더 passed');
		// Ctrl+클릭 다중 선택: 주 선택 + 점선 테두리
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:input id="m1"/><w2:input id="m2"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children.forEach(c => c.def = 0);
			window.send({ type: 'document', version: 92, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#m2'));
		await page.evaluate(() => {
			const s = document.querySelector('.canvas-host').shadowRoot;
			s.querySelector('#m1').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			s.querySelector('#m2').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, ctrlKey: true }));
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length === 2);
		assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected.extra').length), 1);
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('#m1').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length === 1);
		console.log('Design: Ctrl+클릭 다중 선택 passed');
		// 여러 개 고른 채 Property 값 변경 → 한 요청에 모두(id는 마지막 선택만), Style은 바뀐 CSS 속성만 각자의 style에
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:input id="m1" style="width:10px;top:1px;"/><w2:input id="m2" style="width:20px;top:2px;"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children.forEach(c => c.def = 0);
			window.send({ type: 'document', version: 93, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelectorAll('.canvas-host')[0]?.shadowRoot?.querySelector('#m2[style]') || true);
		await page.evaluate(() => {
			const s = document.querySelector('.canvas-host').shadowRoot;
			s.querySelector('#m1').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			s.querySelector('#m2').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, ctrlKey: true }));
		});
		await page.evaluate(() => { window.sent.length = 0; });
		await pickProperty(page, 'disabled', 'true');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'disabled'));
		const multiMsg = await page.evaluate(() => window.sent.find(m => m.type === 'setAttr'));
		assert.deepEqual({ index: multiMsg.index, value: multiMsg.value, more: multiMsg.more }, { index: 3, value: 'true', more: [{ index: 2, value: 'true' }] }, '두 컴포넌트 한 요청');
		await page.evaluate(() => { window.sent.length = 0; });
		await page.click('.style-area .style-value');
		await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
		await page.keyboard.type('width:99px;top:2px;');
		await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'style'));
		const styleMsg = await page.evaluate(() => window.sent.find(m => m.name === 'style'));
		assert.deepEqual({ value: styleMsg.value, more: styleMsg.more }, { value: 'width:99px;top:2px;', more: [{ index: 2, value: 'width:99px;top:1px;' }] }, 'Style은 바뀐 속성(width)만 다른 컴포넌트에');
		await page.evaluate(() => { window.sent.length = 0; });
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('#m2').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
		console.log('Property: 여러 개 선택 후 값·Style 변경 passed');
		// 바인딩된 그리드의 본문 셀: Property의 id는 dataList 컬럼 id 목록에서 고른다(헤더 셀은 그대로 입력칸)
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test" xmlns:xf="http://www.w3.org/2002/xforms"><head><xf:model><w2:dataCollection><w2:dataList id="dl"><w2:columnInfo><w2:column id="name"/><w2:column id="age"/></w2:columnInfo></w2:dataList></w2:dataCollection></xf:model></head>'
				+ '<body><w2:gridView id="grd" dataList="data:dl"><w2:header id="h"><w2:row id="hr"><w2:column id="hc" value="H"/></w2:row></w2:header><w2:gBody id="b"><w2:row id="br"><w2:column id="nmae"/></w2:row></w2:gBody></w2:gridView></body></html>';
			const root = window.parseXml(text);
			root.children[1].children[0].def = 2;
			window.send({ type: 'document', version: 94, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('.w2grid tbody td'));
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid tbody td').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
		// 입력칸 + 목록(datalist): 직접 입력도, 목록에서 고르기도
		const idValue = () => page.evaluateHandle(() => [...document.querySelectorAll('.kv tr')].find(tr => tr.querySelector('.key')?.textContent === 'id').querySelector('.value, input'));
		await page.waitForFunction(() => [...document.querySelectorAll('.kv tr')].find(tr => tr.querySelector('.key')?.textContent === 'id')?.querySelector('.value.has-list'), {timeout: 3000})
			.catch(() => assert.fail('본문 셀 id에 목록 표시 없음'));
		await (await idValue()).click();
		await page.waitForSelector('.kv input[role="combobox"]');
		const comboItems = () => page.evaluate(() => [...document.querySelectorAll('.combo-list li')].map(l => l.textContent));
		assert.deepEqual([await page.$eval('.kv input[role="combobox"]', i => i.value), ...await comboItems()], ['nmae', 'name', 'age'], '지금 값(오타)이 있어도 dataList 컬럼 전체 목록');
		await page.evaluate(() => { window.sent.length = 0; });
		await page.$eval('.kv input[role="combobox"]', i => i.select());
		await page.keyboard.type('a');
		assert.deepEqual(await comboItems(), ['name', 'age'], '타이핑하면 그 글자를 포함하는 것만');
		await page.keyboard.type('g');
		assert.deepEqual(await comboItems(), ['age']);
		await page.$eval('.kv input[role="combobox"]', i => i.select());
		await page.keyboard.type('custom'); await page.keyboard.press('Enter');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'id' && m.value === 'custom'), {timeout: 3000}).catch(() => assert.fail('직접 입력'));
		await (await idValue()).click();
		await page.waitForSelector('.combo-list li');
		await page.evaluate(() => [...document.querySelectorAll('.combo-list li')].find(l => l.textContent === 'age').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
		await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr' && m.name === 'id' && m.value === 'age'), {timeout: 3000}).catch(() => assert.fail('목록에서 고르면 바로 반영'));
		assert.equal(await page.$('.kv input[role="combobox"]'), null, '고르면 닫힘');
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid thead th:last-child').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
		await page.waitForFunction(() => !document.querySelector('.kv .value.has-list'));
		console.log('Property: 바인딩된 그리드 셀 id → 입력칸 + dataList 컬럼 목록 passed');
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:input id="m1"/><w2:input id="m2"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children.forEach(c => c.def = 0);
			window.send({ type: 'document', version: 95, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#m2'));
		// 캔버스의 input 컴포넌트를 실제로 클릭(그 안 input에 포커스)해도 Delete가 먹어야 한다. Ctrl+클릭으로 둘 고르면 한 요청에 둘 다
		const inputBox = async id => page.evaluate(id => {
			const r = document.querySelector('.canvas-host').shadowRoot.querySelector(`#${id}`).getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		}, id);
		await page.evaluate(() => { window.sent.length = 0; });
		const b1 = await inputBox('m1'), b2 = await inputBox('m2');
		await page.mouse.click(b1.x, b1.y);
		await page.keyboard.down('Control'); await page.mouse.click(b2.x, b2.y); await page.keyboard.up('Control');
		await page.keyboard.press('Delete');
		const delMsg = await page.evaluate(() => window.sent.find(m => m.type === 'delete'));
		assert.ok(delMsg && [delMsg.index, ...delMsg.more ?? []].length === 2, JSON.stringify(delMsg));
		console.log('Design: 캔버스 input 클릭 후 Delete(다중) passed');
		// Outline: 클릭·Ctrl+클릭 다중 선택(두 행 다 선택 표시, 캔버스와 공유) → Delete·복사·붙여넣기
		await page.evaluate(() => [...document.querySelectorAll('.pane button, .pane [role="tab"]')].find(b => b.textContent.trim() === 'Outline')?.click());
		const outlineRow = id => page.evaluate(id => {
			const r = [...document.querySelectorAll('.pane .tree-row')].find(row => row.querySelector('.id')?.textContent === id).getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		}, id);
		await page.evaluate(() => { window.sent.length = 0; });
		const o1 = await outlineRow('m1'), o2 = await outlineRow('m2');
		await page.mouse.click(o1.x, o1.y);
		await page.keyboard.down('Control'); await page.mouse.click(o2.x, o2.y); await page.keyboard.up('Control');
		assert.equal(await page.evaluate(() => document.querySelectorAll('.pane .tree-row.selected').length), 2, 'Outline 두 행 선택 표시');
		assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.wse-frame.selected').length), 2, '캔버스도 두 개');
		await page.keyboard.press('Delete');
		const outlineDel = await page.evaluate(() => window.sent.find(m => m.type === 'delete'));
		assert.ok(outlineDel && [outlineDel.index, ...outlineDel.more ?? []].length === 2, JSON.stringify(outlineDel));
		await page.mouse.click(o1.x, o1.y);
		await page.keyboard.down('Control'); await page.mouse.click(o2.x, o2.y); await page.keyboard.up('Control');
		await page.evaluate(() => {
			document.activeElement.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true }));
			document.activeElement.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }));
		});
		const outlinePaste = await page.evaluate(() => window.sent.find(m => m.type === 'paste'));
		assert.equal(outlinePaste?.xml.length, 2, JSON.stringify(outlinePaste));
		// 다른 화면 XML로: 복사하면 클립보드에도(확장 형식 + 글자), 붙여 넣을 때 클립보드의 것을 쓴다(다른 화면에서 복사한 것)
		const clip = await page.evaluate(() => {
			window.sent.length = 0;
			const copied = new DataTransfer();
			document.activeElement.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: copied }));
			const other = new DataTransfer();
			other.setData('application/x-websquare5-nodes', JSON.stringify(['<w2:input id="fromB"/>']));
			document.activeElement.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: other }));
			return { nodes: JSON.parse(copied.getData('application/x-websquare5-nodes')).length, text: copied.getData('text/plain'), pasted: window.sent.find(m => m.type === 'paste')?.xml };
		});
		assert.equal(clip.nodes, 2, '복사한 두 개가 클립보드에');
		assert.ok(clip.text.startsWith('<'), `글자로도: ${clip.text}`);
		assert.deepEqual(clip.pasted, ['<w2:input id="fromB"/>'], '다른 화면에서 복사한 것을 붙여 넣음');
		console.log('Outline: 클릭·Ctrl+클릭 다중 선택·Delete·복사·붙여넣기 passed');
		// F2: 고른 노드의 id를 트리에서 바로(Enter 반영, 형식·중복은 경고만, Esc 취소)
		await page.mouse.click(o1.x, o1.y);
		await page.evaluate(() => { window.sent.length = 0; });
		await page.keyboard.press('F2');
		await page.waitForSelector('.pane .tree-rename', {timeout: 3000}).catch(() => assert.fail('F2로 id 입력칸이 안 열림'));
		assert.equal(await page.$eval('.pane .tree-rename', i => i.value), 'm1');
		await page.$eval('.pane .tree-rename', i => i.select()); await page.keyboard.type('m9'); await page.keyboard.press('Enter');
		assert.deepEqual(await page.evaluate(() => { const m = window.sent.find(m => m.type === 'setAttr'); return m && [m.name, m.value]; }), ['id', 'm9'], 'F2 → Enter: id 변경');
		assert.equal(await page.$('.pane .tree-rename'), null, 'Enter로 닫힘');
		await page.evaluate(() => { window.sent.length = 0; });
		await page.keyboard.press('F2'); await page.waitForSelector('.pane .tree-rename');
		await page.$eval('.pane .tree-rename', i => i.select()); await page.keyboard.type('m2'); await page.keyboard.press('Enter');
		assert.deepEqual(await page.evaluate(() => window.sent.map(m => m.type)), ['warn'], '이미 있는 id는 경고만');
		await page.keyboard.press('F2'); await page.waitForSelector('.pane .tree-rename');
		await page.keyboard.type('x'); await page.keyboard.press('Escape');
		assert.equal(await page.$('.pane .tree-rename'), null, 'Esc로 취소');
		assert.equal(await page.evaluate(() => window.sent.filter(m => m.type === 'setAttr').length), 0);
		// id가 없는 노드(body)도 F2로 새 id를 넣는다
		await page.evaluate(() => [...document.querySelectorAll('.pane .tree-row')].find(r => r.querySelector('.tag')?.textContent === 'body' && !r.querySelector('.id')).click());
		await page.keyboard.press('F2'); await page.waitForSelector('.pane .tree-rename', {timeout: 3000}).catch(() => assert.fail('id 없는 노드에서 F2'));
		assert.equal(await page.$eval('.pane .tree-rename', i => i.value), '', '빈 칸으로');
		await page.keyboard.type('bodyMain'); await page.keyboard.press('Enter');
		assert.deepEqual(await page.evaluate(() => { const m = window.sent.findLast(m => m.type === 'setAttr'); return m && [m.name, m.value]; }), ['id', 'bodyMain'], 'id 새로 넣기');
		console.log('Outline: F2 id 바꾸기 passed');
		// 캔버스를 꽉 채운 컴포넌트를 골라도 선택 박스·손잡이·칩이 스크롤을 만들지 않는다(겹침 층). 칩은 보이는 영역 안, 마우스를 올리면 흐려짐
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:input id="top" class="a b" style="width:100%;height:100%;box-sizing:border-box"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 0;
			window.send({ type: 'document', version: 94, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#top'));
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('#top').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-overlay .wse-frame.selected .wse-handle'));
		await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
		const fill = await page.evaluate(() => {
			const s = document.querySelector('.canvas-host').shadowRoot, p = s.querySelector('.wse-page');
			const chip = s.querySelector('.wse-chip'), c = chip.getBoundingClientRect(), b = p.getBoundingClientRect();
			return { overflow: p.scrollWidth > p.clientWidth || p.scrollHeight > p.clientHeight, text: chip.textContent,
				inside: c.left >= b.left && c.top >= b.top && c.right <= b.left + p.clientWidth && c.bottom <= b.top + p.clientHeight, x: c.left + c.width / 2, y: c.top + c.height / 2 };
		});
		assert.deepEqual([fill.overflow, fill.text, fill.inside], [false, 'input #top .a.b', true]);
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row .cls')].some(e => e.textContent === '.a.b'));
		await page.mouse.move(fill.x, fill.y);
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-chip.faded'));
		await page.mouse.move(5, 5);
		await page.screenshot({path:path.join(tmpdir(), 'ws5-design-chip.png')});
		console.log('Design: 겹침 층(스크롤 없음)·선택 정보 칩·Outline class passed');
		// selectbox·radio 더블클릭 → 선택 항목 팝업. 확인하면 editChoices 한 번, 성공 응답이면 닫히고 실패면 팝업에 이유
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test" xmlns:xf="http://www.w3.org/2002/xforms"><body><xf:select1 id="sel" appearance="minimal" ref="data:m.a"><xf:choices><xf:item><xf:label><![CDATA[재직자]]></xf:label><xf:value><![CDATA[1]]></xf:value></xf:item></xf:choices></xf:select1><xf:select1 id="rad" appearance="full" cols="2"/></body><head><xf:model><w2:dataCollection><w2:dataList id="dlt_code"><w2:columnInfo><w2:column id="code"/><w2:column id="name"/></w2:columnInfo></w2:dataList></w2:dataCollection></xf:model></head></html>';
			const root = window.parseXml(text);
			const [sel, rad] = root.children[0].children;
			sel.def = 3; rad.def = 4;
			window.sent.length = 0;
			window.send({ type: 'document', version: 97, text, root, script: { text: '' } });
		});
		const dblclick = id => page.evaluate(id => document.querySelector('.canvas-host').shadowRoot.querySelector(`#${id}`)
			.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })), id);
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#rad'));
		await dblclick('sel');
		await page.waitForSelector('.choices-editor[open]');
		assert.deepEqual(await page.$$eval('.choices-editor tbody input:not([type="checkbox"]), #choices-ref', els => els.map(e => e.value)), ['재직자', '1', 'data:m.a']);
		await page.click('.choices-editor button[aria-label="행 추가"]');
		await page.type('.choices-editor input[aria-label="2행 Label"]', '퇴직자');
		await page.type('.choices-editor input[aria-label="2행 Value"]', '2');
		await page.keyboard.press('Enter');
		assert.deepEqual(await page.evaluate(() => [document.activeElement?.classList.contains('choices-editor'), document.querySelector('.choices-editor input[aria-label="2행 Value"]').value]), [true, '2'], '선택 항목 팝업도 Enter로 입력칸에서 나옴');
		await page.evaluate(() => [...document.querySelectorAll('.choices-editor .choices-check')].find(l => l.textContent.includes('All Option')).querySelector('input').click());
		// 손잡이(Codicon gripper)로 2행을 1행 위로 끌어 놓기(DataList와 같은 방식)
		const center = sel => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom, left: r.left }; });
		const second = await center('.choices-editor button[aria-label="2행 이동"]'), firstRow = await center('.choices-editor tbody tr');
		await page.mouse.move(second.x, second.y); await page.mouse.down();
		await page.mouse.move(second.x, firstRow.top + 2, { steps: 8 }); await page.mouse.up();
		assert.deepEqual(await page.$$eval('.choices-editor tbody input[aria-label$="Label"]', els => els.map(e => e.value)), ['퇴직자', '재직자'], '행 끌어 순서 변경');
		// 끄는 중에도 휠이 먹고, 표 아래 가장자리에 오면 스크롤. 놓은 뒤에는 안 굴러감
		const boxSel = await page.evaluate(() => {
			let box = document.querySelector('.choices-editor tbody');
			while (box && !/auto|scroll/.test(getComputedStyle(box).overflowY)) { box = box.parentElement; }
			box.style.maxHeight = '64px'; box.scrollTop = 0; box.dataset.testScroll = '';
			return '[data-test-scroll]';
		});
		const scrollTop = () => page.$eval(boxSel, b => b.scrollTop);
		const firstHandle = await center('.choices-editor button[aria-label="1행 이동"]'), scrollBox = await center(boxSel);
		await page.mouse.move(firstHandle.x, firstHandle.y); await page.mouse.down();
		await page.mouse.wheel({ deltaY: 30 });
		await page.waitForFunction(sel => document.querySelector(sel).scrollTop > 0, { timeout: 2000 }, boxSel).catch(() => assert.fail('끄는 중 휠 스크롤 안 됨'));
		await page.$eval(boxSel, b => { b.scrollTop = 0; });
		await page.mouse.move(firstHandle.x, scrollBox.bottom - 2, { steps: 4 });
		await page.waitForFunction(sel => document.querySelector(sel).scrollTop > 0, { timeout: 2000 }, boxSel).catch(() => assert.fail('가장자리 자동 스크롤 안 됨'));
		// 제자리(끈 행 위)에 놓으면 순서 그대로
		await page.$eval(boxSel, b => { b.style.maxHeight = ''; });
		await page.mouse.move(firstHandle.x, firstHandle.y, { steps: 2 }); await page.mouse.up();
		await page.$eval(boxSel, b => { b.style.maxHeight = '64px'; b.scrollTop = 0; });
		await new Promise(r => setTimeout(r, 100));
		assert.equal(await scrollTop(), 0, '놓은 뒤에는 안 굴러감');
		await page.$eval(boxSel, b => { b.style.maxHeight = ''; delete b.dataset.testScroll; });
		await page.screenshot({path:path.join(tmpdir(), 'ws5-choices-selectbox.png')});
		await page.click('.choices-editor .btn-primary');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'editChoices'));
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'editChoices').fields),
			{ items: [{ label: '퇴직자', value: '2' }, { label: '재직자', value: '1' }], attrs: { ref: 'data:m.a', allOption: 'true' } });
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'editChoices').popup, ok: true }));
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		// radio: 데이터 바인딩(BindItemSet, 항목 표는 비활성) + 정렬 방향 cols → rows
		await dblclick('rad');
		await page.waitForSelector('.choices-editor[open]');
		assert.deepEqual(await page.$$eval('#choices-direction, #choices-count', els => els.map(e => e.value ?? e.dataset.value)), ['cols', '2']);
		await page.evaluate(() => [...document.querySelectorAll('.choices-editor .choices-check')].find(l => l.textContent.includes('데이터에서 가져오기')).querySelector('input').click());
		assert.ok(await page.$eval('.choices-editor button[aria-label="행 추가"]', b => b.disabled), '바인딩 중 항목 표 비활성');
		// NodeSet·Label·Value: 입력칸 + 목록(동적 dataList는 목록에 없어 직접 입력)
		const pick = (v) => page.evaluate(v => [...document.querySelectorAll('.combo-list li')].find(l => l.textContent === v).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })), v);
		await page.type('#choices-nodeset', 'data:dlt_dyn');
		assert.equal(await page.$('.combo-list'), null, '목록에 없는 NodeSet도 입력');
		await page.$eval('#choices-nodeset', el => el.select());
		await page.type('#choices-nodeset', 'data:dlt_');
		await page.waitForSelector('.combo-list li');
		// 목록이 열린 채 Esc: 목록만 닫고 팝업은 그대로
		await page.keyboard.press('Escape');
		assert.deepEqual(await page.evaluate(() => [!!document.querySelector('.combo-list'), !!document.querySelector('.choices-editor[open]')]), [false, true], 'Esc는 목록만 닫음');
		await page.keyboard.press('ArrowDown');
		await page.waitForSelector('.combo-list li');
		await pick('data:dlt_code');
		await page.type('#choices-label', 'name');
		await page.focus('#choices-value');
		await page.waitForSelector('.combo-list li');
		await pick('code');
		await page.click('#choices-direction button:nth-child(3)');
		await page.$eval('#choices-count', el => { el.focus(); el.select(); });
		await page.keyboard.type('3');
		await page.screenshot({path:path.join(tmpdir(), 'ws5-choices-radio.png')});
		await page.evaluate(() => { window.sent.length = 0; });
		await page.click('.choices-editor .btn-primary');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'editChoices'));
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'editChoices').fields),
			{ items: [], itemset: { nodeset: 'data:dlt_code', label: 'name', value: 'code' }, attrs: { ref: null, cols: null, rows: '3' } }, '지울 속성은 null(JSON 메시지에서 undefined는 사라짐)');
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'editChoices').popup, ok: false, error: '문서가 바뀌었습니다. 팝업을 다시 열어 주세요.' }));
		await page.waitForFunction(() => document.querySelector('.choices-editor .error')?.textContent.includes('문서가 바뀌었습니다'));
		await page.$eval('.choices-editor .popup-close', b => b.click());
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		// Outline: 이름은 정의의 display(태그는 툴팁), 더블클릭하면 캔버스와 같은 팝업
		await page.evaluate(() => window.tab('Outline', '.pane').click());
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row .tag')].some(t => t.textContent === 'Radio'));
		assert.deepEqual(await page.$$eval('.pane .tree-row .tag', tags => tags.map(t => `${t.textContent}|${t.title}`).filter(s => s.endsWith('select1'))), ['SelectBox|xf:select1', 'Radio|xf:select1']);
		await page.evaluate(() => [...document.querySelectorAll('.pane .tree-row .tag')].find(t => t.textContent === 'Radio').closest('.tree-row').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
		await page.waitForSelector('.choices-editor[open]');
		assert.deepEqual(await page.$$eval('#choices-direction, #choices-count', els => els.map(e => e.value ?? e.dataset.value)), ['cols', '2'], 'Outline 더블클릭 → radio 팝업');
		await page.$eval('.choices-editor .popup-close', b => b.click());
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		console.log('Design: selectbox·radio 선택 항목 팝업(항목·All Option·바인딩·정렬, Outline 이름·더블클릭) passed');
		// 팔레트: 확장이 넣은 컴포넌트(select id)는 그 id가 든 다음 문서에서 선택된다
		await page.evaluate(() => {
			window.send({ type: 'select', id: 'radio1' });
			const text = '<html xmlns:w2="urn:test" xmlns:xf="http://www.w3.org/2002/xforms"><body><xf:select1 id="sel" appearance="minimal"/><xf:select1 id="radio1" appearance="full"><xf:choices></xf:choices></xf:select1><xf:select1 id="rad" appearance="full"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children.forEach((n, i) => { n.def = i === 0 ? 3 : 4; });
			window.send({ type: 'document', version: 97, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.pane .tree-row.selected .id')?.textContent === 'radio1');
		console.log('Palette: 넣은 컴포넌트 선택 passed');
		// 문구 편집(라벨 더블클릭) 중에는 선택 테두리·손잡이·표시 점(겹침 층)을 숨긴다: 페이지 위 층이라 편집 상자를 덮는다
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:input id="btnLabel" label="취소"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 0;
			window.send({ type: 'document', version: 97, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#btnLabel'));
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('#btnLabel').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })));
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit'), {timeout: 3000});
		assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-overlay').hidden), true, '문구 편집 중 겹침 층 숨김');
		await page.keyboard.press('Escape');
		await page.waitForFunction(() => !document.querySelector('.canvas-host').shadowRoot.querySelector('.edit'), {timeout: 3000});
		assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.wse-overlay').hidden), false, '편집을 닫으면 다시 보임');
		// 그리드 헤더 칸 더블클릭: 문구 상자 아래 너비(W)·높이(H). 칸으로 옮겨도 안 닫히고, Enter면 문구·width·style height를 한 편집으로
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:gridView id="grdSize"><w2:header id="hd"><w2:row id="hr"><w2:column id="h1" value="이름" width="70" style="height:26px;"/></w2:row></w2:header><w2:gBody id="gb"><w2:row id="br"><w2:column id="b1"/></w2:row></w2:gBody></w2:gridView></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 2;
			// 헤더 칸 문구 편집은 컬럼 정의(realType column)가 있어야 열린다
			window.send({ type: 'definitions', defs: [...window.testDefs, { id: 'column', ns: 'urn:test', realType: 'column', parents: [], bases: [], events: [],
				properties: [{ name: 'inputType', category: '', order: 0, description: '입력 방식', options: ['text', 'select', 'checkbox'] }] }] });
			const grid = root.children[0].children[0];
			grid.children[0].children[0].children[0].def = grid.children[1].children[0].children[0].def = window.testDefs.length;
			window.sent.length = 0;
			window.send({ type: 'document', version: 96, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('.w2grid thead th'));
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid thead th').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })));
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-footer input'), {timeout: 3000});
		assert.deepEqual(await page.evaluate(() => [...document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.edit-footer input')].slice(0, 2).map(i => i.value)), ['70', '26'], '지금 너비·높이');
		const sizeInput = await page.evaluateHandle(() => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.edit-footer input')[0]);
		await sizeInput.click(); await sizeInput.evaluate(i => i.select());
		await page.keyboard.type('12x0');
		assert.equal(await page.evaluate(() => !!document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-footer')), true, '칸으로 옮겨도 열려 있음');
		// 입력칸이 아닌 이름 글자를 눌러도 닫히지 않음(그 입력칸으로)
		const nameLabel = await page.evaluateHandle(() => [...document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.edit-fields .name')].find(e => e.textContent === 'class'));
		await nameLabel.click();
		assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.activeElement?.getAttribute('aria-label')), 'class', '이름을 누르면 그 입력칸으로');
		assert.equal(await page.evaluate(() => getSelection().toString()), '', '더블클릭 글자 선택이 남지 않음');
		await sizeInput.click();
		await page.keyboard.press('Enter');
		assert.deepEqual(await page.evaluate(() => { const m = window.sent.find(m => m.type === 'setAttr'); return m && { name: m.name, value: m.value, also: m.also }; }),
			{ name: 'value', value: '이름', also: [{ name: 'width', value: '120' }] }, '바뀐 너비만, 숫자만');
		assert.equal(await page.evaluate(() => !!document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-wrap')), false, 'Enter로 닫힘');
		// 본문 셀 더블클릭: 자주 고치는 속성(정해진 값도 입력칸 + 목록, 숫자 칸은 숫자만)을 한 편집으로
		await page.evaluate(() => { window.sent.length = 0; document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid tbody td').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })); });
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-fields'), {timeout: 3000}).catch(() => assert.fail('본문 셀 속성 입력 없음'));
		assert.deepEqual(await page.evaluate(() => [...document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.edit-fields .name')].map(e => e.textContent)),
			['width', 'height', 'id', 'class', 'inputType', 'dataType', 'maxLength', 'maxByteLength', 'expression', 'colMerge']);
		assert.deepEqual(await page.evaluate(() => { const r = document.querySelector('.canvas-host').shadowRoot; return { part: r.querySelector('.edit-head .edit-chip')?.textContent, id: r.querySelector('.edit-head .edit-id')?.textContent, sections: [...r.querySelectorAll('.edit-section')].map(e => e.textContent), buttons: [...r.querySelectorAll('.edit-actions button')].map(b => b.textContent) }; }),
			{ part: '본문 칸', id: 'b1', sections: ['크기', '속성'], buttons: ['취소', '적용'] }, '칸 종류·id, 크기·속성 묶음, 취소·적용');
		await page.screenshot({path:path.join(tmpdir(), 'ws5-cell-editor.png')});
		const cellField = name => page.evaluateHandle(name => document.querySelector('.canvas-host').shadowRoot.querySelector(`.edit-fields [aria-label="${name}"]`), name);
		assert.equal(await (await cellField('inputType')).evaluate(e => e.getAttribute('role')), 'combobox', '정해진 값도 입력칸 + 목록');
		await (await cellField('inputType')).click();
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.combo-list li'));
		await page.evaluate(() => [...document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.combo-list li')].find(l => l.textContent === 'checkbox').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
		await page.waitForFunction(() => !document.querySelector('.canvas-host').shadowRoot.querySelector('.combo-list'), {timeout: 3000}).catch(() => assert.fail('목록에서 고르면 목록 닫힘'));
		await (await cellField('inputType')).click();
		assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.canvas-host').shadowRoot.querySelector('.combo-list')).backgroundColor), 'rgb(255, 255, 255)', '다시 누르면 열림, 캔버스 목록은 밝게');
		await (await cellField('class')).click(); await page.keyboard.type('num');
		await (await cellField('maxLength')).click(); await page.keyboard.type('1a0');
		assert.equal(await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-status')?.textContent), '바꾼 속성 3');
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-apply').click());
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'setAttr')?.also),
			[{ name: 'class', value: 'num' }, { name: 'inputType', value: 'checkbox' }, { name: 'maxLength', value: '10' }], '적용 버튼: 바뀐 속성만 한 편집으로');
		assert.equal(await page.evaluate(() => !!document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-wrap')), false, '적용하면 닫힘');
		// 편집 상자 너비: 좁은 칸은 400, 넓은 칸(width 900)도 480까지만
		const wrapWidth = () => page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-wrap')?.getBoundingClientRect().width);
		for (const [cellWidth, expected] of [[70, 400], [900, 480]]) {
			await page.evaluate(cellWidth => {
				const text = `<html xmlns:w2="urn:test"><body><w2:gridView id="grdSize"><w2:header id="hd"><w2:row id="hr"><w2:column id="h1" value="이름" width="${cellWidth}"/></w2:row></w2:header><w2:gBody id="gb"><w2:row id="br"><w2:column id="b1"/></w2:row></w2:gBody></w2:gridView></body></html>`;
				const root = window.parseXml(text), grid = root.children[0].children[0];
				grid.def = 2;
				grid.children[0].children[0].children[0].def = grid.children[1].children[0].children[0].def = window.testDefs.length;
				window.send({ type: 'document', version: 96, text, root, script: { text: '' } });
			}, cellWidth);
			await page.waitForFunction(w => document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid thead th')?.getBoundingClientRect().width >= w - 2, {timeout: 3000}, Math.min(cellWidth, 600));
			await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid thead th').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })));
			await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-wrap'), {timeout: 3000});
			assert.equal(Math.round(await wrapWidth()), expected, `칸 너비 ${cellWidth} → 편집 상자 ${expected}`);
			// 취소 버튼: 바꾼 값이 있어도 반영 안 하고 닫음
			await page.evaluate(() => { window.sent.length = 0; });
			await (await cellField('class')).click(); await page.keyboard.type('x');
			await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-cancel').click());
			assert.equal(await page.evaluate(() => window.sent.some(m => m.type === 'setAttr')), false, '취소는 반영 안 함');
			await page.waitForFunction(() => !document.querySelector('.canvas-host').shadowRoot.querySelector('.edit-wrap'), {timeout: 3000});
		}
		await page.evaluate(() => window.send({ type: 'definitions', defs: window.testDefs }));
		console.log('Design: 그리드 헤더 칸 문구·너비·높이 편집 passed');
		console.log('Design: 그리드 칸(헤더·본문 공통) 더블클릭 속성 입력 passed');
		// 그리드 select 컬럼 칸 더블클릭 → 같은 팝업(Grid Select, All·Choose Option). text 컬럼 칸은 팝업 대신 문구 편집 그대로
		await page.evaluate(() => {
			const text = '<html xmlns:w2="urn:test"><body><w2:gridView id="grd"><w2:gBody id="b"><w2:row id="r"><w2:column id="stat" inputType="select"><w2:choices><w2:item><w2:label><![CDATA[미사용]]></w2:label><w2:value><![CDATA[F]]></w2:value></w2:item></w2:choices></w2:column><w2:column id="nm" inputType="text"/></w2:row></w2:gBody></w2:gridView></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 2;
			window.sent.length = 0;
			window.send({ type: 'document', version: 98, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('.w2grid td'));
		const cellDblclick = n => page.evaluate(n => document.querySelector('.canvas-host').shadowRoot.querySelectorAll('.w2grid tbody td')[n]
			.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })), n);
		await cellDblclick(1);
		assert.equal(await page.$('.choices-editor'), null, 'text 컬럼은 팝업 없음');
		await cellDblclick(0);
		await page.waitForSelector('.choices-editor[open]');
		assert.equal(await page.$eval('.choices-editor .popup-badge', e => e.textContent), 'Grid Select');
		assert.deepEqual(await page.$$eval('.choices-editor tbody input:not([type="checkbox"])', els => els.map(e => e.value)), ['미사용', 'F']);
		assert.ok(await page.$('.choices-editor .choices-inline'), 'Choose Option 칸');
		await page.evaluate(() => [...document.querySelectorAll('.choices-editor .choices-check')].find(l => l.textContent.includes('Choose Option')).querySelector('input').click());
		await page.type('.choices-editor input[aria-label="Choose Option 문구"]', '-선택-');
		await page.click('.choices-editor .btn-primary');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'editChoices'));
		// 요청 대상은 그 컬럼 노드(칸의 data-wse), 항목은 그대로·Choose Option만 추가
		const choicesMsg = await page.evaluate(() => {
			const m = window.sent.find(m => m.type === 'editChoices');
			const cell = document.querySelector('.canvas-host').shadowRoot.querySelector('.w2grid tbody td');
			return { sameNode: m.index === Number(cell.getAttribute('data-wse')), fields: m.fields };
		});
		assert.deepEqual(choicesMsg, { sameNode: true, fields: { items: [{ label: '미사용', value: 'F' }], attrs: { ref: null, chooseOption: 'true', chooseOptionLabel: '-선택-' } } });
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'editChoices').popup, ok: true }));
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		console.log('Design: 그리드 select 컬럼 선택 항목 팝업 passed');
		// checkbox(xf:select)도 radio와 같은 팝업(정렬 방향·개수). 원래 빈 rows=""·다른 속성은 건드리지 않는다
		await page.evaluate(() => {
			const text = '<html xmlns:xf="http://www.w3.org/2002/xforms"><body><xf:select id="chk" appearance="full" cols="" rows="" ref="data:dl.m07" falseValue="0"><xf:choices><xf:item><xf:label><![CDATA[7월]]></xf:label><xf:value><![CDATA[1]]></xf:value></xf:item></xf:choices></xf:select></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[0].def = 5;
			window.sent.length = 0;
			window.send({ type: 'document', version: 100, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#chk'));
		await dblclick('chk');
		await page.waitForSelector('.choices-editor[open]');
		assert.deepEqual(await page.$$eval('.choices-editor .popup-badge, .choices-editor tbody input:not([type="checkbox"]), #choices-ref, #choices-direction', els => els.map(e => e.value ?? e.dataset.value ?? e.textContent)),
			['Checkbox', '7월', '1', 'data:dl.m07', 'none']);
		await page.click('#choices-direction button:nth-child(2)');
		await page.type('#choices-count', '4');
		await page.click('.choices-editor .btn-primary');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'editChoices'));
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'editChoices').fields),
			{ items: [{ label: '7월', value: '1' }], attrs: { ref: 'data:dl.m07', cols: '4', rows: '' } });
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'editChoices').popup, ok: true }));
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		console.log('Design: checkbox 선택 항목 팝업 passed');
		// 엔진이 모르는 WebSquare 태그(w2:checkbox 등, 정의·UDC 선언 없음)는 엔진처럼 캔버스·Outline 모두 안 보인다. UDC(확장이 udc 표시)는 기본 박스
		await page.evaluate(() => {
			const text = '<html xmlns:w2="http://www.inswave.com/websquare"><body><w2:checkbox id="c1" label="1월"/><w2:udc_upload id="u1"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children[1].udc = true;
			window.send({ type: 'document', version: 97, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#u1'));
		assert.deepEqual(await page.evaluate(() => {
			const s = document.querySelector('.canvas-host').shadowRoot;
			return ['#c1', '#u1'].map(id => !!s.querySelector(id)?.getClientRects().length);
		}), [false, true], '캔버스: 모르는 태그는 없음, UDC는 표시');
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('#u1').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
		await page.waitForFunction(() => [...document.querySelectorAll('.pane .tree-row .id')].some(e => e.textContent === 'u1'));
		assert.ok(![...await page.$$eval('.pane .tree-row .id', es => es.map(e => e.textContent))].includes('c1'), 'Outline에도 모르는 태그 없음');
		console.log('Design: 엔진이 모르는 태그 숨김(캔버스·Outline)·UDC 박스 passed');
		// 자리 표시(wse-todo)였던 입력 컴포넌트: checkcombobox·multiselect·spinner·searchbox·output·calendar·multiupload
		await page.evaluate(() => {
			const WS = 'http://www.inswave.com/websquare', XF = 'http://www.w3.org/2002/xforms';
			const def = (id, ns, realType) => ({ id, ns, realType, parents: [], bases: [], properties: [], events: [] });
			window.send({ type: 'definitions', defs: [...window.testDefs, def('checkcombobox', XF, 'checkcombobox'), def('select', XF, 'multiselect'), def('spinner', WS, 'spinner'),
				def('searchbox', WS, 'searchbox'), def('output', XF, 'output'), def('calendar', WS, 'calendar'), def('multiupload', WS, 'multiupload'), def('output', XF, 'output')] });
			const text = `<html xmlns:w2="${WS}" xmlns:xf="${XF}"><body><xf:checkcombobox id="k1" style="width:148px;height:21px;"/><xf:select id="m1"><xf:choices><xf:item><xf:label>가</xf:label><xf:value>a</xf:value></xf:item><xf:item><xf:label>나</xf:label><xf:value>b</xf:value></xf:item></xf:choices></xf:select>`
				+ '<w2:spinner id="s1" value="3"/><w2:searchbox id="q1"/><xf:output id="o1" label="출력"/><w2:calendar id="cal1"/><w2:multiupload id="mu1"/><xf:output id="o2"/></body></html>';
			const root = window.parseXml(text);
			root.children[0].children.forEach((n, i) => { n.def = window.testDefs.length + i; });
			window.send({ type: 'document', version: 98, text, root, script: { text: '' } });
		});
		await page.waitForFunction(() => document.querySelector('.canvas-host')?.shadowRoot?.querySelector('#mu1'));
		assert.deepEqual(await page.evaluate(() => {
			const s = document.querySelector('.canvas-host').shadowRoot;
			return ['#k1', '#m1', '#s1', '#q1', '#o1', '#cal1', '#mu1'].map(id => s.querySelector(id).matches('.wse-todo'));
		}), [false, false, false, false, false, false, false], '자리 표시 아님');
		assert.deepEqual(await page.evaluate(() => {
			const s = document.querySelector('.canvas-host').shadowRoot;
			return [s.querySelector('#m1').textContent, s.querySelector('#s1 input').value, s.querySelector('#o1').textContent, s.querySelectorAll('#cal1 tbody td').length, s.querySelector('#k1').offsetWidth];
		}), ['가나', '3', '출력', 42, 148]);
		await page.screenshot({ path: path.join(tmpdir(), 'ws5-input-components.png') });
		console.log('Design: checkcombobox·multiselect·spinner·searchbox·output·calendar·multiupload 그리기 passed');
		// output: textbox처럼 더블클릭 → 문구(label) 편집
		await page.evaluate(() => { window.sent.length = 0; document.querySelector('.canvas-host').shadowRoot.querySelector('#o2').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })); });
		await page.waitForFunction(() => document.querySelector('.canvas-host').shadowRoot.querySelector('.edit'), { timeout: 3000 });
		await page.keyboard.type('결과');
		await page.keyboard.press('Enter');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'setAttr'));
		assert.deepEqual(await page.evaluate(() => { const m = window.sent.find(m => m.type === 'setAttr'); return [m.name, m.value]; }), ['label', '결과']);
		console.log('Design: output 더블클릭 문구 편집 passed');
		// multiupload 더블클릭 → 파라미터(Name·Value) 표만 있는 팝업
		await page.evaluate(() => { window.sent.length = 0; document.querySelector('.canvas-host').shadowRoot.querySelector('#mu1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })); });
		await page.waitForSelector('.choices-editor[open]');
		assert.deepEqual(await page.evaluate(() => [document.querySelector('.choices-editor .popup-badge').textContent, !!document.querySelector('#choices-nodeset'), !!document.querySelector('#choices-ref'),
			[...document.querySelectorAll('.choices-editor thead th')].map(t => t.textContent).slice(2)]), ['Multiupload', false, false, ['Name', 'Value']]);
		await page.click('.choices-editor button[aria-label="행 추가"]');
		await page.type('.choices-editor input[aria-label="1행 Label"]', 'folder');
		await page.type('.choices-editor input[aria-label="1행 Value"]', 'img');
		await page.click('.choices-editor .btn-primary');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'editChoices'));
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'editChoices').fields.items), [{ label: 'folder', value: 'img' }]);
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'editChoices').popup, ok: true }));
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		console.log('Design: multiupload 파라미터 팝업 passed');
		// checkcombobox 더블클릭 → selectbox와 같은 선택 항목 팝업(All·Choose Option 포함)
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('#k1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })));
		await page.waitForSelector('.choices-editor[open]');
		assert.deepEqual(await page.evaluate(() => [document.querySelector('.choices-editor .popup-badge').textContent, !!document.querySelector('.choices-editor .choices-options'), !!document.querySelector('#choices-direction')]),
			['CheckComboBox', true, false]);
		await page.click('.choices-editor .btn-secondary');
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		// multiselect: 같은 팝업, All·Choose Option 영역 없음
		await page.evaluate(() => document.querySelector('.canvas-host').shadowRoot.querySelector('#m1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true })));
		await page.waitForSelector('.choices-editor[open]');
		assert.deepEqual(await page.evaluate(() => [document.querySelector('.choices-editor .popup-badge').textContent, !!document.querySelector('.choices-editor .choices-options'), !!document.querySelector('#choices-direction'),
			[...document.querySelectorAll('.choices-editor tbody input[aria-label$="Label"]')].map(e => e.value)]), ['MultiSelect', false, false, ['가', '나']]);
		await page.evaluate(() => { window.sent.length = 0; });
		await page.$eval('#choices-ref', el => el.focus());
		await page.keyboard.type('data:m.b');
		await page.click('.choices-editor .btn-primary');
		await page.waitForFunction(() => window.sent.some(m => m.type === 'editChoices'));
		assert.deepEqual(await page.evaluate(() => window.sent.find(m => m.type === 'editChoices').fields.attrs), { ref: 'data:m.b' }, 'multiselect는 ref만');
		await page.evaluate(() => window.send({ type: 'popupAck', popup: window.sent.findLast(m => m.type === 'editChoices').popup, ok: true }));
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		// Outline 더블클릭도 같은 팝업
		await page.evaluate(() => [...document.querySelectorAll('.pane .tree-row .id')].find(t => t.textContent === 'k1').closest('.tree-row').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
		await page.waitForSelector('.choices-editor[open]');
		assert.equal(await page.$eval('.choices-editor .popup-badge', b => b.textContent), 'CheckComboBox', 'Outline 더블클릭 → checkcombobox 팝업');
		await page.click('.choices-editor .btn-secondary');
		await page.waitForFunction(() => !document.querySelector('.choices-editor'));
		console.log('Design: checkcombobox·multiselect 선택 항목 팝업(캔버스·Outline 더블클릭) passed');
		// 실제 VS Code처럼 문서 버전은 올라가기만 한다(편집기는 더 높은 버전만 받는다)
		await page.evaluate(() => window.send({ ...window.initialDocument, version: 200 }));
		console.log('Data: 생성 직후 팝업·행 추가·확인·다중 팝업 동시 표시·배경 상호작용 passed');
}
