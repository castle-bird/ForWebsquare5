import * as assert from 'assert';
import { inSql, isMapper, sqlWords } from '../core/sqlCompletion';

const MAPPER = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="sample.UserMapper">
	<!-- <select id="fake"> -->
	<resultMap id="rm" type="map"><result column="RM_COL" property="p"/></resultMap>
	<select id="list" parameterType="map">
		SELECT u.USER_ID, u.USER_NM AS userNm, NVL(u.AGE, 0)
		FROM APP.TB_USER u
		JOIN TB_DEPT d ON d.DEPT_ID = u.DEPT_ID
		<where>
			<if test="name != null">AND u.USER_NM LIKE '%' || #{name} || 'X_LITERAL'</if>
		</where>
		<![CDATA[ AND u.AGE < 30 ]]> -- LINE_COMMENT
	</select>
	<insert id="add">INSERT INTO TB_LOG (LOG_ID) VALUES (#{id})</insert>
	<sql id="empty"/>
</mapper>`;

const at = (marker: string, shift = 0) => MAPPER.indexOf(marker) + shift;

suite('MyBatis SQL 자동완성', () => {
	test('매퍼 XML만', () => {
		assert.ok(isMapper(MAPPER));
		assert.ok(!isMapper('<html xmlns:w2="http://www.inswave.com/websquare"><body/></html>'));
	});

	test('SQL 자리: 구문 태그 안 글자·CDATA, 동적 태그 안 포함', () => {
		assert.ok(inSql(MAPPER, at('SELECT u.')), 'select 본문');
		assert.ok(inSql(MAPPER, at('AND u.USER_NM')), 'if 안');
		assert.ok(inSql(MAPPER, at('AND u.AGE')), 'CDATA 안');
		assert.ok(inSql(MAPPER, at('INSERT')), 'insert 본문');
		assert.ok(!inSql(MAPPER, at('name != null')), '속성 안');
		assert.ok(!inSql(MAPPER, at('id="list"')), '태그 안');
		assert.ok(!inSql(MAPPER, at('RM_COL')), 'resultMap');
		assert.ok(!inSql(MAPPER, at('fake')), 'XML 주석');
		assert.ok(!inSql(MAPPER, at('<insert')), '구문 사이');
		assert.ok(!inSql(MAPPER, at('</mapper>')), '자기 닫힘 sql 뒤');
	});

	test('키워드·함수: 방언 함수는 그 방언에만', () => {
		const ora = sqlWords('oracle'), pg = sqlWords('postgresql'), std = sqlWords('standard');
		assert.ok(std.keywords.includes('select') && std.functions.includes('count'));
		assert.ok(ora.functions.includes('nvl') && ora.keywords.includes('rownum'));
		assert.ok(pg.functions.includes('string_agg') && !pg.functions.includes('nvl'));
		assert.ok(!std.functions.includes('nvl'));
		assert.strictEqual(new Set(ora.functions).size, ora.functions.length, '중복 없음');
	});
});
