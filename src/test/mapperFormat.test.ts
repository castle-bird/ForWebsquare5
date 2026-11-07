import * as assert from 'node:assert/strict';
import { formatMapper, isMapperXml } from '../core/mapperFormat';

const clean = `<?xml version="1.0" encoding="UTF-8"?>
<mapper namespace="a.B">
    <sql id="cols">id, name</sql>
    <select id="list">
        SELECT id,
               name
          FROM test_tbl
        <where>
            <if test="id != null">
                AND id = #{id}
            </if>
        </where>
    </select>
</mapper>`;

suite('매퍼 XML 포맷', () => {
	test('매퍼만 알아보고 이미 정돈된 파일은 그대로 둔다(SQL 안쪽 들여쓰기 유지)', () => {
		assert.equal(isMapperXml(clean), true);
		assert.equal(isMapperXml('<screen/>'), false);
		assert.equal(formatMapper(clean), clean);
	});
	test('들여쓰기가 흐트러진 태그와 붙은 SQL을 정리한다', () => {
		const messy = `<mapper namespace="a.B">
<select id="list">   SELECT *
      FROM t
  <where>
 <if test="x != null"> AND x = #{x} </if>
  </where></select>
        <insert id="add"> insert into t (id) values (#{id}) </insert>
</mapper>`;
		const expected = `<mapper namespace="a.B">
    <select id="list">
        SELECT *
              FROM t
        <where>
            <if test="x != null"> AND x = #{x} </if>
        </where>
    </select>
    <insert id="add">insert into t (id) values (#{id})</insert>
</mapper>`;
		assert.equal(formatMapper(messy), expected);
	});
	test('태그만 한 칸 어긋나 있으면 안쪽 SQL은 밀리지 않고 태그 아래 한 단계에 맞춘다', () => {
		const lines = (...items: string[]) => items.join('\n');
		const text = lines('<mapper>', '    <select id="a">', '       <if test="x != 1">', '            AND y = #{y}', '    </if>', '    </select>', '</mapper>');
		assert.equal(formatMapper(text), lines('<mapper>', '    <select id="a">', '        <if test="x != 1">', '            AND y = #{y}', '        </if>', '    </select>', '</mapper>'));
	});
	test('CDATA 안과 CRLF 줄바꿈은 그대로 보존한다', () => {
		const text = '<mapper>\r\n<select id="a">\r\nselect * from t where a <![CDATA[ <\r\n   = ]]> 1\r\n</select>\r\n</mapper>';
		assert.equal(formatMapper(text), '<mapper>\r\n    <select id="a">\r\n        select * from t where a <![CDATA[ <\r\n   = ]]> 1\r\n    </select>\r\n</mapper>');
	});
});
