import * as assert from 'assert';
import { screenDomain, siblingLinks, suggestLinks } from '../core/linkSuggest';
import { DEFAULT_LINK_TABS } from '../core/links';

const tab = (id: string) => DEFAULT_LINK_TABS.find(t => t.id === id) ?? { id, label: id };
const FILES = [
	'src/main/java/all/UserListController.java', 'src/main/java/all/UserListService.java', 'src/main/java/all/UserListServiceImpl.java',
	'src/main/java/all/UserListMapper.java', 'src/main/java/all/UserListValidator.java', 'src/main/java/all/UserListVO.java',
	'src/main/resources/mapper/userList_mapper.xml', 'src/main/webapp/ui/userList01.xml', 'src/main/webapp/ui/userList02.xml',
	'src/main/java/all/UserListsController.java', 'src/main/java/all/OtherController.java', 'target/classes/mapper/userList_mapper.xml',
];
const names = (kind: string, files = FILES, screen = 'userList01') => suggestLinks(screen, tab(kind), files).map(s => s.name);

suite('연결 탭 추천', () => {
	test('화면 이름 끝의 번호·구분 글자를 떼어 도메인으로 쓴다', () => {
		assert.deepStrictEqual(['userList01', 'all_impv_02', 'userList', '01'].map(screenDomain), ['userList', 'all_impv', 'userList', '']);
	});

	test('같은 도메인 파일만, 옆 화면·화면 자신·다른 도메인·빌드 산출물은 뺀다', () => {
		const all = names('controller');
		assert.ok(!all.includes('userList01.xml') && !all.includes('userList02.xml'), '화면 파일');
		assert.ok(!all.includes('UserListsController.java') && !all.includes('OtherController.java'), '도메인 경계');
		assert.strictEqual(suggestLinks('userList01', tab('controller'), FILES).filter(s => s.file.startsWith('target/')).length, 0, '빌드 폴더');
		assert.strictEqual(all.length, 7);
	});

	test('탭에 맞는 역할이 먼저 오고 맞음 표시가 붙는다', () => {
		const pick = (kind: string) => suggestLinks('userList01', tab(kind), FILES).slice(0, 2).map(s => `${s.name}:${s.role}:${s.fit}`);
		assert.deepStrictEqual(pick('controller'), ['UserListController.java:Controller:true', 'UserListService.java:Service:false']);
		assert.deepStrictEqual(pick('service'), ['UserListService.java:Service:true', 'UserListServiceImpl.java:ServiceImpl:true']);
		assert.deepStrictEqual(pick('mapper'), ['UserListMapper.java:Mapper:true', 'userList_mapper.xml:MyBatis:true']);
		assert.deepStrictEqual(pick('mybatis'), ['userList_mapper.xml:MyBatis:true', 'UserListController.java:Controller:false']);
	});

	test('ServiceImpl 탭·사용자가 만든 탭', () => {
		assert.strictEqual(suggestLinks('userList01', { id: 'tab1', label: 'ServiceImpl' }, FILES)[0].name, 'UserListServiceImpl.java');
		const custom = suggestLinks('userList01', { id: 'tab2', label: '메모' }, FILES);
		assert.ok(custom.length && custom.every(s => !s.fit), '맞는 역할을 모르면 순서만');
		assert.strictEqual(custom[0].name, 'UserListController.java');
	});

	test('최대 10개, 도메인이 없거나 맞는 파일이 없으면 빈 목록', () => {
		const many = Array.from({ length: 30 }, (_, i) => `x/UserList${i < 10 ? 'Controller' : 'Extra'}${i}.java`);
		assert.strictEqual(suggestLinks('userList', tab('controller'), many).length, 10);
		assert.deepStrictEqual(suggestLinks('01', tab('controller'), FILES), []);
		assert.deepStrictEqual(suggestLinks('zzz', tab('controller'), FILES), []);
	});

	test('구분 글자·대소문자가 달라도 읽는다', () => {
		const files = ['a/UserList_service_impl.java', 'a/UserList_SQL.xml', 'a/userListDao.java'];
		assert.deepStrictEqual(suggestLinks('userList01', tab('service'), files).map(s => s.role), ['ServiceImpl', 'Mapper', 'MyBatis']);
	});

	test('같은 폴더 다른 화면이 연결한 파일을 많이 쓴 순으로', () => {
		const entries = [
			['/p/ui/all01.xml', 'a/AllController.java'], ['/p/ui/all02.xml', 'a/AllController.java'], ['/p/ui/all03.xml', 'a/Other.java'],
			['/p/ui/all04.xml', undefined], ['/p/other/x.xml', 'a/Far.java'], ['/p/ui/self.xml', 'a/Mine.java'],
		] as const;
		assert.deepStrictEqual(siblingLinks('/p/ui/self.xml', entries), [{ file: 'a/AllController.java', count: 2 }, { file: 'a/Other.java', count: 1 }]);
		assert.deepStrictEqual(siblingLinks('C:\\p\\ui\\self.xml', [['C:\\p\\ui\\a.xml', 'x.java'], ['C:\\p\\o\\b.xml', 'y.java']]), [{ file: 'x.java', count: 1 }], 'Windows 경로');
	});
});
