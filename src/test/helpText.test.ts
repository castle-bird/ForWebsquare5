import * as assert from 'assert';
import { helpBlocks } from '../core/helpText';

suite('도움말 설명 나누기', () => {
	test('`|` 없는 설명은 글자 한 덩어리', () => {
		assert.deepStrictEqual(helpBlocks('화면에 보이는 글자 \r\n 둘째 줄'), [{ kind: 'text', text: '화면에 보이는 글자\n둘째 줄' }]);
	});

	test('코드 표시가 없는 `|` 덩어리(옵션 목록)는 `|`만 뗀 글자, 괄호 줄은 제목', () => {
		assert.deepStrictEqual(helpBlocks('필수 선택.\n |(옵션 설명)\n | "false" (기본 값) : 적용 안 함.\n | "true" : 적용.\n |\n |(관련 함수)\n | validate();'), [
			{ kind: 'text', text: '필수 선택.' },
			{ kind: 'heading', text: '(옵션 설명)' },
			{ kind: 'text', text: '"false" (기본 값) : 적용 안 함.\n"true" : 적용.' },
			{ kind: 'heading', text: '(관련 함수)' },
			{ kind: 'code', text: 'validate();' },
		]);
	});

	test('코드 덩어리는 코드 상자로: 빈 `|` 줄은 빈 줄, 들여쓰기는 유지, 앞뒤 빈 줄은 없앰', () => {
		assert.deepStrictEqual(helpBlocks('설명\n |(예제)\n |\n | scwin.fn_msg = function(){\n |    var a = 1;\n |\n |    return a;\n | }\n |'), [
			{ kind: 'text', text: '설명' },
			{ kind: 'heading', text: '(예제)' },
			{ kind: 'code', text: 'scwin.fn_msg = function(){\n   var a = 1;\n\n   return a;\n}' },
		]);
	});

	test('XML 예제와 주석 줄도 코드', () => {
		assert.deepStrictEqual(helpBlocks('|// (작성 예)\n| data:dataMap1.dept\n|\n| <xf:group id="g">'), [{ kind: 'code', text: '// (작성 예)\ndata:dataMap1.dept\n\n<xf:group id="g">' }]);
	});

	test('`|`만 있는 줄은 어디에도 남지 않는다', () => {
		assert.ok(helpBlocks(' |\n | a = 1;\n |\n |(주의)\n |').every(b => !/^\|$/m.test(b.text)));
	});
});
