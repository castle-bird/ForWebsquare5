import * as assert from 'assert';
import { inSql, isMapper, sqlWords } from '../core/sqlCompletion';

// lang-sql 타입은 DOM 타입을 끌어와(확장 tsconfig에는 DOM이 없다) 가져오지 않고 필요한 모양만 적어 읽는다
const langSql = require('@codemirror/lang-sql') as Record<string, { spec: { keywords?: string; types?: string; builtin?: string } }>;

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
		assert.ok(!inSql(MAPPER, at('LINE_COMMENT')), 'SQL -- 주석');
		const quoted = '<mapper><select id="t">WHERE c = \'--\' AND d</select></mapper>';
		assert.ok(inSql(quoted, quoted.indexOf(' d')), '문자열 안 -- 는 주석 아님');
		const block = '<mapper><select id="s">\nSELECT a, /* 이름 x */ b, /* 주문 y\n</select></mapper>';
		assert.ok(inSql(block, block.indexOf(' b')), '닫힌 /* */ 뒤');
		assert.ok(!inSql(block, block.indexOf('y')), '안 닫은 /* 안');
		const multiComment = '<mapper><select id="s">\n<!-- 여러 줄\n주석 끝 --> SELECT col FROM dual\n</select></mapper>';
		assert.ok(inSql(multiComment, multiComment.indexOf('FROM')), '여러 줄 XML 주석 끝 --> 뒤는 SQL -- 주석이 아님');
	});

	test('키워드·함수: 방언 함수는 그 방언에만', () => {
		const ora = sqlWords('oracle'), pg = sqlWords('postgresql'), std = sqlWords('standard');
		assert.ok(std.keywords.includes('select') && std.functions.includes('count'));
		assert.ok(ora.functions.includes('nvl') && ora.keywords.includes('rownum'));
		assert.ok(pg.functions.includes('string_agg') && !pg.functions.includes('nvl'));
		assert.ok(!std.functions.includes('nvl'));
		assert.strictEqual(new Set(ora.functions).size, ora.functions.length, '중복 없음');
	});

	test('mysql·mssql·sqlite도 방언 단어: lang-sql 명세 + 자주 쓰는 함수, 다른 방언 함수는 안 섞임', () => {
		const my = sqlWords('mysql'), ms = sqlWords('mssql'), lite = sqlWords('sqlite');
		assert.ok(my.keywords.includes('auto_increment') && my.functions.includes('ifnull') && my.functions.includes('date_format'));
		assert.ok(ms.keywords.includes('nvarchar') && ms.functions.includes('getdate') && ms.functions.includes('isnull'));
		assert.ok(lite.functions.includes('strftime') && lite.keywords.includes('autoincrement'));
		assert.ok(!my.functions.includes('nvl') && !ms.functions.includes('ifnull') && !lite.functions.includes('getdate'));
	});

	test('생성 파일(sqlDialectWords)이 lang-sql 명세를 빠짐없이 담음: 의존성을 올렸다면 npm run gen:sql-words', () => {
		const specs = { oracle: 'PLSQL', mysql: 'MySQL', mariadb: 'MariaSQL', postgresql: 'PostgreSQL', mssql: 'MSSQL', sqlite: 'SQLite' } as const;
		for (const [id, name] of Object.entries(specs)) {
			const spec = langSql[name].spec, have = sqlWords(id as keyof typeof specs);
			const split = (text?: string) => (text ?? '').split(/\s+/).map(w => w.toLowerCase()).filter(w => /^[a-z_][a-z0-9_$#]*$/.test(w));
			assert.deepStrictEqual(split(`${spec.keywords ?? ''} ${spec.types ?? ''}`).filter(w => !have.keywords.includes(w)), [], `${id} 키워드가 빠짐`);
			assert.deepStrictEqual(split(spec.builtin).filter(w => !have.functions.includes(w)), [], `${id} 함수가 빠짐`);
		}
	});
});
