import * as assert from 'assert';
import { extractSymbols } from '../core/symbols';

suite('기호 추출(Ctrl+Shift+O)', () => {
	test('JS/Script: scwin 대입·함수 선언·화살표 함수·클래스 메서드 추출과 문법 오류 폴백', () => {
		const js = [
			'scwin.onpageload = function() {',
			'    var inner = () => {};',
			'};',
			'scwin.btnSave_onclick = () => {};',
			'function helper(a) { return a; }',
			'const format = function(v) { return v; };',
			'class Calc { sum(a, b) { return a + b; } }',
		].join('\n');
		const syms = extractSymbols(js, 'js');
		assert.deepStrictEqual(syms.map(s => [s.name, s.kind, s.line, s.detail]), [
			['scwin.onpageload', 'function', 1, 'scwin'],
			['scwin.btnSave_onclick', 'function', 4, 'scwin'],
			['helper', 'function', 5, undefined],
			['format', 'function', 6, undefined],
			['Calc', 'class', 7, undefined],
			['sum', 'method', 7, 'Calc'],
		]);
		const broken = 'scwin.init = function() {\n    if (\n};\nfunction recover() {}\n';
		assert.deepStrictEqual(extractSymbols(broken, 'js').map(s => s.name), ['scwin.init', 'recover']);
	});

	test('Java: 클래스·인터페이스·메서드만 추출하고 제어문·주석·애너테이션 제외', () => {
		const java = [
			'package com.example;',
			'// void commented() {}',
			'@RestController',
			'public class UserController {',
			'    private final List<String> list = makeList();',
			'    @GetMapping("/users")',
			'    public List<Map<String, Object>> selectUsers(String id) throws Exception {',
			'        if (id != null) { return null; }',
			'        return null;',
			'    }',
			'    interface Helper {',
			'        void assist();',
			'    }',
			'}',
		].join('\n');
		const syms = extractSymbols(java, 'java');
		assert.deepStrictEqual(syms.map(s => [s.name, s.kind, s.line, s.detail]), [
			['UserController', 'class', 4, undefined],
			['selectUsers', 'method', 7, 'UserController'],
			['Helper', 'interface', 11, 'UserController'],
			['assist', 'method', 12, 'Helper'],
		]);
	});

	test('XML: MyBatis 매퍼는 namespace·SQL id, WebSquare 화면은 id 요소 추출', () => {
		const mapper = [
			'<mapper namespace="com.example.UserMapper">',
			'    <!-- <select id="commented"/> -->',
			'    <resultMap id="userMap" type="map"/>',
			'    <select id="selectList">SELECT 1</select>',
			'    <update id="updateUser">UPDATE t SET a=1</update>',
			'</mapper>',
		].join('\n');
		assert.deepStrictEqual(extractSymbols(mapper, 'xml').map(s => [s.name, s.kind, s.line, s.detail]), [
			['com.example.UserMapper', 'interface', 1, 'mapper'],
			['userMap', 'sql', 3, 'resultMap'],
			['selectList', 'sql', 4, 'select'],
			['updateUser', 'sql', 5, 'update'],
		]);

		const screen = '<html xmlns:w2="urn:test"><body><w2:gridView id="grd_list"/><w2:trigger id="btn_save"/></body></html>';
		assert.deepStrictEqual(extractSymbols(screen, 'xml').map(s => [s.name, s.kind, s.detail]), [
			['grd_list', 'tag', 'w2:gridView'],
			['btn_save', 'tag', 'w2:trigger'],
		]);
	});

	test('CSS: 최상위 선택자 추출(주석 제외)', () => {
		const css = '/* .hidden {} */\n.btn-primary { color: red; }\n#header .title { font-size: 14px; }\n';
		assert.deepStrictEqual(extractSymbols(css, 'css').map(s => [s.name, s.line]), [
			['.btn-primary', 2],
			['#header .title', 3],
		]);
	});
});
