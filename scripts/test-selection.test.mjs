import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectTests } from './test-selection.mjs';

const available = ['design', 'outline'];
test('기본은 전체, 지정하면 중복 없이 그 파일만 선택', () => {
	assert.deepEqual(selectTests([], available), { list: false, names: available });
	assert.deepEqual(selectTests(['outline', 'outline'], available), { list: false, names: ['outline'] });
});
test('목록 확인과 알 수 없는 파일/옵션 거부', () => {
	assert.deepEqual(selectTests(['--list'], available), { list: true, names: available });
	assert.throws(() => selectTests(['desgin'], available), /알 수 없는 테스트/);
	assert.throws(() => selectTests(['--group'], available), /알 수 없는 테스트/);
});
