import * as assert from 'node:assert/strict';
import { formatMapperSql, formatSqlText, hasXmlTag } from '../core/sqlFormat';

const options = { tabWidth: 4, useTabs: false, dialect: 'standard' as const };

suite('SQL 선택 포맷', () => {
	test('키워드를 대문자로 줄바꿈하고 #{}·${}는 그대로 둔다', () => {
		const out = formatSqlText('select a,b from t where id=#{id} and name like ${pat}', options);
		assert.match(out, /^SELECT\n/);
		assert.ok(out.includes('#{id}') && out.includes('${pat}'));
		assert.ok(out.split('\n').length > 3);
	});
	test('매퍼 엔티티는 풀어 정리한 뒤 다시 엔티티로 되돌린다', () => {
		const out = formatMapperSql('select * from t where id &gt;= #{from} and id &lt;= #{to}', options);
		assert.ok(out.includes('&lt;=') && out.includes('#{from}') && out.includes('#{to}'));
		assert.equal(out.includes('<'.concat('=')), false);
	});
	test('XML 주석은 태그로 보지 않고 그대로 보존하며 SQL 주석(--)도 읽는다', () => {
		const text = ['<!-- 메모 -->', 'UPDATE t SET a = #{a}, -- 첫째', ' b = #{b} -- 둘째', 'WHERE id = #{id}'].join('\n');
		assert.equal(hasXmlTag(text), false);
		assert.equal(hasXmlTag('select <if test="x">a</if>'), true);
		assert.equal(hasXmlTag('<![CDATA[ a ]]>'), true);
		const out = formatMapperSql(text, options);
		assert.ok(out.includes('<!-- 메모 -->') && out.includes('-- 첫째') && out.includes('-- 둘째') && out.includes('#{id}'));
	});
});
