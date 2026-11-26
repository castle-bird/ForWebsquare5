import * as assert from 'assert';
import { applyMapperTables, extractMapperTables } from '../core/sqlTables';
import { emptyTables } from '../core/tables';

const MAPPER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.example.UserMapper">
	<sql id="activeOnly">
		AND u.USE_YN = 'Y'
	</sql>

	<select id="selectUserList" resultType="map">
		WITH active_dept AS (
			SELECT DEPT_CD FROM TB_DEPT WHERE USE_YN = 'Y'
		)
		SELECT u.USER_ID, u.USER_NM, d.DEPT_NM, TO_CHAR(SYSDATE, 'YYYYMMDD') AS TODAY
		FROM TB_USER u
		INNER JOIN TB_DEPT d ON u.DEPT_CD = d.DEPT_CD
		INNER JOIN active_dept ad ON d.DEPT_CD = ad.DEPT_CD
		<where>
			<include refid="activeOnly"/>
			<if test="userNm != null and userNm != ''">
				AND u.USER_NM LIKE '%' || #{userNm} || '%'
			</if>
			<if test="ids != null">
				AND u.USER_ID IN
				<foreach collection="ids" item="id" open="(" close=")" separator=",">
					#{id}
				</foreach>
			</if>
		</where>
	</select>

	<select id="selectWithCommaJoin" resultType="map">
		SELECT u.USER_ID, r.ROLE_NM
		FROM TB_USER u, TB_ROLE r
		WHERE u.ROLE_CD = r.ROLE_CD(+)
		  AND ROWNUM &lt;= 10
	</select>

	<select id="selectNow" resultType="string">
		SELECT SYSDATE FROM DUAL
	</select>

	<insert id="insertUser">
		<selectKey keyProperty="userId" resultType="string" order="BEFORE">
			SELECT SEQ_USER.NEXTVAL FROM DUAL
		</selectKey>
		INSERT INTO TB_USER (USER_ID, USER_NM, DEPT_CD)
		VALUES (#{userId}, #{userNm}, #{deptCd})
	</insert>

	<update id="updateUser">
		UPDATE TB_USER
		<set>
			<if test="userNm != null">USER_NM = #{userNm},</if>
			MOD_DT = SYSDATE,
		</set>
		WHERE USER_ID = #{userId}
	</update>

	<delete id="deleteRole">
		DELETE FROM TB_ROLE WHERE ROLE_CD = #{roleCd}
	</delete>

	<update id="mergeAudit">
		MERGE INTO TB_AUDIT a
		USING (SELECT USER_ID FROM TB_USER) u
		ON (a.USER_ID = u.USER_ID)
		WHEN MATCHED THEN UPDATE SET a.CNT = a.CNT + 1
		WHEN NOT MATCHED THEN INSERT (USER_ID, CNT) VALUES (u.USER_ID, 1)
	</update>
</mapper>`;

suite('sqlTables (node-sql-parser)', () => {
	test('MyBatis 동적 태그·CTE·DUAL·조인·Oracle MERGE에서 테이블·CRUD·컬럼·관계를 추출한다', async () => {
		const res = await extractMapperTables([MAPPER_XML], 'oracle');
		assert.strictEqual(res.failed, 0);
		const byName = new Map(res.tables.map(t => [t.name.toUpperCase(), t]));
		assert.strictEqual(byName.has('ACTIVE_DEPT'), false, 'CTE 이름은 제외');
		assert.strictEqual(byName.has('DUAL'), false, 'DUAL 가상 테이블 제외');
		assert.deepStrictEqual(byName.get('TB_USER')?.crud, ['C', 'R', 'U']);
		assert.deepStrictEqual(byName.get('TB_DEPT')?.crud, ['R']);
		assert.deepStrictEqual(byName.get('TB_ROLE')?.crud, ['R', 'D']);
		assert.deepStrictEqual(byName.get('TB_AUDIT')?.crud, ['C', 'U']);
		assert.ok(byName.get('TB_USER')?.columns.includes('USER_ID'));
		assert.ok(byName.get('TB_USER')?.columns.includes('USER_NM'));
		assert.strictEqual(byName.get('TB_USER')?.columns.some(c => /sysdate|rownum/i.test(c)), false, '의사 컬럼 제외');
		const joins = res.joins.map(j => `${j.from}>${j.to}:${j.label}`).sort();
		assert.deepStrictEqual(joins, [
			'TB_USER>TB_DEPT:DEPT_CD',
			'TB_USER>TB_ROLE:ROLE_CD',
		]);
	});

	test('기존 ERD에 병합 시 기존 위치·컬럼은 보존하고 CRUD·누락 컬럼·새 테이블·조인만 반영한다', async () => {
		const extracted = await extractMapperTables([MAPPER_XML], 'oracle');
		const base = {
			...emptyTables(),
			tables: [{
				id: 'existing-user', name: 'tb_user', desc: '사용자 정보', crud: ['R' as const],
				columns: [{ id: 'c1', name: 'USER_ID', desc: '아이디', type: 'VARCHAR(20)', pk: true }],
				keysOnly: false, color: 'blue' as const, x: 100, y: 120,
			}],
		};
		let seq = 0;
		const applied = applyMapperTables(base, extracted, () => `id-${++seq}`);
		assert.strictEqual(applied.added, 3);
		assert.strictEqual(applied.updated, 1);
		assert.strictEqual(applied.linksAdded, 2);
		const user = applied.data.tables.find(t => t.id === 'existing-user')!;
		assert.strictEqual(user.x, 100, '기존 위치 유지');
		assert.strictEqual(user.desc, '사용자 정보', '기존 설명 유지');
		assert.deepStrictEqual(user.crud, ['C', 'R', 'U'], 'CRUD 병합');
		assert.strictEqual(user.columns[0].desc, '아이디', '기존 컬럼 설명 유지');
		assert.ok(user.columns.some(c => c.name === 'USER_NM'), '새 컬럼 추가');
		assert.strictEqual(user.columns.filter(c => c.name.toUpperCase() === 'USER_ID').length, 1, '기존 컬럼 중복 없음');
		const addedTables = applied.data.tables.filter(t => t.id !== 'existing-user');
		assert.ok(addedTables.every(t => t.x > 100 + 240), '새 테이블은 기존 오른쪽에 배치');
		assert.strictEqual(applied.data.links.length, 2);

		// 다시 실행해도 중복 추가 없음
		const again = applyMapperTables(applied.data, extracted, () => `id-${++seq}`);
		assert.strictEqual(again.added, 0);
		assert.strictEqual(again.updated, 0);
		assert.strictEqual(again.linksAdded, 0);
		assert.strictEqual(again.data, applied.data);
	});

	test('MySQL·MSSQL 방언 파서 지원', async () => {
		const mysqlXml = `<mapper namespace="m"><select id="s">SELECT \`u\`.\`id\` FROM \`users\` u LIMIT 10</select></mapper>`;
		const res = await extractMapperTables([mysqlXml], 'mysql');
		assert.deepStrictEqual(res.tables.map(t => [t.name, t.crud, t.columns]), [['users', ['R'], ['id']]]);

		const mssqlXml = `<mapper namespace="m"><select id="s">SELECT TOP 5 u.id FROM [dbo].[Users] u</select></mapper>`;
		const ms = await extractMapperTables([mssqlXml], 'mssql');
		assert.deepStrictEqual(ms.tables.map(t => [t.name, t.crud]), [['dbo.Users', ['R']]]);
	});
});
