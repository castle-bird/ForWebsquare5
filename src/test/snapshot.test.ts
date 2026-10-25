import * as assert from 'assert';
import { pageHtml, shadowMarkup, updatePayload } from '../project/snapshot';

suite('브라우저 미리보기 페이지', () => {
	const page = { title: 'a<b>&c', html: '<div class="wse-page"><p>본문</p></div>', css: ['.wse-page p{color:red}', '</style><b>x</b>'], imports: ['https://fonts.example/a.css', 'file:///x.css', 'javascript:alert(1)'] };
	const html = pageHtml(page, 'abc123');

	test('Shadow DOM 템플릿 안에 CSS와 화면을 넣는다', () => {
		assert.ok(/<template shadowrootmode="open">[\s\S]*<style>\.wse-page p\{color:red\}<\/style>[\s\S]*<div class="wse-view"><div class="wse-page"><p>본문<\/p><\/div><\/div>[\s\S]*<\/template>/.test(html), html);
	});

	test('스크립트는 nonce 하나만 허용하고 CSP는 기본 차단', () => {
		assert.ok(html.includes(`script-src 'nonce-abc123'`) && html.includes("default-src 'none'"));
		assert.strictEqual(html.match(/<script/g)?.length, 1);
		assert.ok(html.includes('<script nonce="abc123">'));
	});

	test('CSS 안의 </style>은 템플릿을 깨지 않게 이스케이프', () => {
		// <style> 3개(머리 1 + CSS 2)가 각자 한 번씩만 닫힌다
		assert.strictEqual(html.match(/<style>/g)?.length, 3);
		assert.strictEqual(html.match(/<\/style>/g)?.length, 3);
	});

	test('제목은 이스케이프하고 외부 폰트는 https만 링크', () => {
		assert.ok(html.includes('<title>a&lt;b>&amp;c</title>'), html);
		assert.ok(html.includes('<link rel="stylesheet" href="https://fonts.example/a.css">'));
		assert.ok(!html.includes('javascript:') && !html.includes('file:///x.css'));
	});

	test('갱신 내용은 처음 페이지와 같은 마크업·https 폰트·제목', () => {
		type Update = { view: string; styles?: string; imports?: string[]; title: string };
		const update = JSON.parse(updatePayload(page)) as Update;
		assert.strictEqual(`${update.styles}\n${update.view}`, shadowMarkup(page));
		assert.deepStrictEqual(update.imports, ['https://fonts.example/a.css']);
		assert.strictEqual(update.title, page.title);
		assert.ok(!updatePayload(page).includes('\n'), 'SSE data 한 줄');
		const viewOnly = JSON.parse(updatePayload(page, false)) as Update;
		assert.deepStrictEqual([viewOnly.styles, viewOnly.imports, viewOnly.view], [undefined, undefined, update.view], 'CSS가 그대로면 화면만');
	});
});
