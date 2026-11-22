import * as assert from 'assert';
import { isLikelyJavaMapper, javaHitAt, javaTargetAt, lineColAt, xmlHitAt, xmlTargetAt } from '../core/mapperLink';

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

	test('Hit 범위와 줄·칸 계산(CRLF 포함)', () => {
		const hit = javaHitAt(JAVA, at(JAVA, 'selectList(@'))!;
		assert.strictEqual(JAVA.slice(hit.origin.at, hit.origin.at + hit.origin.name.length), 'selectList');
		const xmlHit = xmlHitAt(XML, at(XML, 'com.example'))!;
		assert.strictEqual(XML.slice(xmlHit.origin.at, xmlHit.origin.at + xmlHit.origin.name.length), 'com.example.user.UserMapper');
		const crlf = 'line0\r\n  selectList';
		assert.deepStrictEqual(lineColAt(crlf, crlf.indexOf('selectList')), { line: 1, ch: 2 });
	});

	test('자동 아이콘 탐색 대상 Java 인터페이스 판별', () => {
		assert.strictEqual(isLikelyJavaMapper(JAVA, 'UserMapper.java'), true);
		assert.strictEqual(isLikelyJavaMapper('public interface UserDao { void run(); }'), true);
		assert.strictEqual(isLikelyJavaMapper('@org.apache.ibatis.annotations.Mapper\npublic interface CustomSql { void run(); }', 'CustomSql.java'), true);
		assert.strictEqual(isLikelyJavaMapper('public interface UserService { void run(); }', 'UserService.java'), false);
		assert.strictEqual(isLikelyJavaMapper('// @Mapper\npublic interface UserService { void run(); }', 'UserService.java'), false);
		assert.strictEqual(isLikelyJavaMapper('public class UserMapper { void run() {} }', 'UserMapper.java'), false);
	});
});
