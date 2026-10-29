import * as assert from 'assert';
import { cssClassNames } from '../core/cssClasses';

const names = (...selectors: string[]) => cssClassNames(selectors.map(selector => ({ selector })));

suite('CSS 클래스 이름 목록', () => {
	test('선택자에서 클래스만 뽑아 중복 없이 정렬한다', () => {
		assert.deepStrictEqual(names('.btn', 'div.btn.primary > .item:hover', '.w2group .btn::after, .b-1'), ['b-1', 'btn', 'item', 'primary', 'w2group']);
		assert.deepStrictEqual(names(':not(.off) .on', '.가나다 .-x'), ['-x', 'off', 'on', '가나다']);
	});
	test('속성 선택자·문자열·숫자·id·태그는 클래스가 아니다', () => {
		assert.deepStrictEqual(names('a[href$=".pdf"]', "input[data-x='.y']", '.5', '#id.cls', 'div'), ['cls']);
	});
	test('이스케이프로 이어지는 이름은 잘못된 이름으로 넣지 않는다', () => {
		assert.deepStrictEqual(names('.sm\\:flex', '.ok'), ['ok']);
	});
	test('규칙이 없으면 빈 목록', () => {
		assert.deepStrictEqual(cssClassNames([]), []);
	});
});
