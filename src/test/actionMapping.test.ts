import * as assert from 'assert';
import { actionPath, matchAction, parseMappings } from '../core/actionMapping';

const CONTROLLER = [
	'package a;',
	'// @RequestMapping("/commented")',
	'@Controller',
	'@RequestMapping(value = "/user", produces = "application/json")',
	'public class UserController {',
	'\t/* @GetMapping("/old") */',
	'\t@PostMapping("/selectList.do")',
	'\t@ResponseBody',
	'\tpublic ResponseEntity<Map<String, Object>> selectList(@RequestBody Map<String, Object> param) {',
	'\t\treturn null; // "http://x"',
	'\t}',
	'\t@RequestMapping(path = {"/save", "/update"}, method = RequestMethod.POST)',
	'\tpublic void save() {}',
	'\t@GetMapping',
	'\tpublic void index() {}',
	'\t@GetMapping("/item/{id}")',
	'\tpublic void item(@PathVariable String id) {}',
	'}',
].join('\n');

suite('Submission action → Controller', () => {
	test('클래스 경로 + 메서드 경로, 주석 안 매핑은 무시, 여러 경로·value=·path=', () => {
		assert.deepStrictEqual(parseMappings(CONTROLLER).map(m => `${m.path} ${m.method} ${m.line}`), [
			'/user/selectList.do selectList 8', '/user/save save 12', '/user/update save 12', '/user index 14', '/user/item/{id} item 16',
		]);
	});

	test('action 경로: 주소·쿼리·확장자를 뗀다', () => {
		assert.deepStrictEqual(['/user/selectList.do', 'http://host:8080/ctx/user/selectList.do?x=1', 'user/save/'].map(actionPath), ['/user/selectList', '/ctx/user/selectList', '/user/save']);
	});

	test('같으면 2, 앞에 컨텍스트 경로가 붙으면 1, 경로 변수는 한 조각', () => {
		assert.strictEqual(matchAction('/user/selectList.do', '/user/selectList.do'), 2);
		assert.strictEqual(matchAction('/user/selectList.do', '/user/selectList'), 2, '.do 없는 매핑');
		assert.strictEqual(matchAction('/ctx/user/selectList.do', '/user/selectList.do'), 1);
		assert.strictEqual(matchAction('/user/item/7', '/user/item/{id}'), 2);
		assert.strictEqual(matchAction('/user/selectListAll.do', '/user/selectList.do'), 0, '더 긴 이름');
		assert.strictEqual(matchAction('/xuser/selectList.do', '/user/selectList.do'), 0, '조각 경계');
		assert.strictEqual(matchAction('/user', '/'), 0);
	});
});
