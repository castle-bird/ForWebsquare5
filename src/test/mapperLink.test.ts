import * as assert from 'assert';
import { javaTargetAt, xmlTargetAt } from '../core/mapperLink';

const JAVA = [
	'package com.example.user;',
	'// List<User> commented(String id);',
	'@Mapper',
	'public interface UserMapper {',
	'\t@Select("select count(*) from users")',
	'\tint count();',
	'\tList<Map<String, Object>> selectList(@Param("id") String id, Map<String, Object> param);',
	'\tdefault void run() { selectList(null, null); }',
	'}',
].join('\n');

const XML = [
	'<?xml version="1.0" encoding="UTF-8"?>',
	'<mapper namespace="com.example.user.UserMapper">',
	'\t<!-- <select id="commented"> -->',
	'\t<select id="selectList" resultType="map">',
	'\t\t<![CDATA[ <delete id="inCdata"> ]]>',
	'\t</select>',
	'</mapper>',
].join('\n');

const at = (text: string, word: string, nth = 0) => text.split(word).slice(0, nth + 1).join(word).length + 1;

suite('Mapper ↔ 매퍼 XML', () => {
	test('Java: 메서드 선언·인터페이스 이름 위만. 주석·애너테이션·호출은 아님', () => {
		const fqcn = 'com.example.user.UserMapper';
		assert.deepStrictEqual(javaTargetAt(JAVA, at(JAVA, 'selectList(@')), { fqcn, id: 'selectList' });
		assert.deepStrictEqual(javaTargetAt(JAVA, at(JAVA, 'count()')), { fqcn, id: 'count' });
		assert.deepStrictEqual(javaTargetAt(JAVA, at(JAVA, 'UserMapper')), { fqcn });
		assert.strictEqual(javaTargetAt(JAVA, at(JAVA, 'commented')), undefined);
		assert.strictEqual(javaTargetAt(JAVA, at(JAVA, 'Param')), undefined);
		assert.strictEqual(javaTargetAt(JAVA, at(JAVA, 'selectList(null')), undefined, 'default 메서드 본문 안 호출');
	});

	test('XML: 문 id·namespace 값 위만. 주석·CDATA 안은 아님', () => {
		assert.deepStrictEqual(xmlTargetAt(XML, at(XML, 'selectList')), { fqcn: 'com.example.user.UserMapper', id: 'selectList' });
		assert.deepStrictEqual(xmlTargetAt(XML, at(XML, 'com.example')), { fqcn: 'com.example.user.UserMapper' });
		assert.strictEqual(xmlTargetAt(XML, at(XML, 'commented')), undefined);
		assert.strictEqual(xmlTargetAt(XML, at(XML, 'inCdata')), undefined);
		assert.strictEqual(xmlTargetAt(XML, at(XML, 'resultType')), undefined);
	});
});
