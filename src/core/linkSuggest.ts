// 연결 탭 추천: 화면 파일 이름(userList01.xml)에서 도메인(userList)을 뽑아, 같은 도메인으로 시작하는 파일을 역할(Controller·Service…)별로 골라 준다
import type { LinkTab } from './links';

export interface LinkSuggestion {
	/** 연결할 경로(작업 폴더 기준, 검색 목록과 같은 모양) */
	file: string;
	name: string;
	/** 도메인 뒤 이름으로 읽은 역할(Controller·Service·ServiceImpl·Mapper·MyBatis·Validator·VO). 모르면 확장자 */
	role: string;
	/** 이 탭 이름에 맞는 역할 */
	fit: boolean;
}

/** 이름 기준 추천 개수 */
const SUGGEST_LIMIT = 10;
/** 같은 폴더 화면 기준 추천 개수 */
export const SIBLING_LIMIT = 5;

/** 같은 폴더의 다른 화면이 같은 탭에 연결해 둔 파일과 그 화면 수 */
export interface SiblingLink { file: string; count: number }

/**
 * entries(화면 경로, 그 화면이 이 탭에 연결한 파일)에서 self와 같은 폴더의 다른 화면들이 연결한 파일을 많이 쓴 순으로.
 * 화면 XML에는 연결 정보가 없어서(개인 저장소) 이 PC에서 연결해 둔 것만 알 수 있다
 */
export function siblingLinks(self: string, entries: readonly (readonly [owner: string, file: string | undefined])[]): SiblingLink[] {
	const dir = (file: string) => file.replace(/[\\/][^\\/]*$/, '');
	const counts = new Map<string, number>();
	for (const [owner, file] of entries) {
		if (file && owner !== self && dir(owner) === dir(self)) { counts.set(file, (counts.get(file) ?? 0) + 1); }
	}
	return [...counts].map(([file, count]) => ({ file, count })).sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}

/** 도메인 뒤 이름(구분 글자 뺀 소문자) → 역할. 흔한 이름 규칙(`UserListServiceImpl`, `userList_mapper.xml`, eGovFrame·Spring 관례) */
const ROLE_OF: Record<string, string> = {
	controller: 'Controller', service: 'Service', serviceimpl: 'ServiceImpl', impl: 'ServiceImpl',
	mapper: 'Mapper', dao: 'Mapper', repository: 'Mapper', mapperxml: 'MyBatis', sql: 'MyBatis', sqlmap: 'MyBatis',
	validator: 'Validator', vo: 'VO', dto: 'VO', model: 'VO', entity: 'VO',
};
/** 같은 순위일 때 보여 줄 역할 순서 */
const ROLE_ORDER = ['Controller', 'Service', 'ServiceImpl', 'Mapper', 'MyBatis', 'Validator', 'VO'];

/** 빌드 산출물 폴더의 복사본은 제외 */
const BUILD_DIR = /(^|[\\/])(target|build|bin|out|node_modules)[\\/]/i;

/** 화면 이름 → 도메인: 끝의 번호·구분 글자를 뗀다(userList01 → userList) */
export const screenDomain = (screen: string) => screen.replace(/[\d_-]+$/, '');

/** 탭 이름(id·label)이 원하는 역할, 먼저 적힌 것이 더 맞음. 모르는 탭(사용자가 만든 이름)은 없음 */
function wantedRoles(tab: LinkTab): string[] {
	const text = `${tab.id} ${tab.label}`.toLowerCase();
	if (text.includes('impl')) { return ['ServiceImpl', 'Service']; }
	if (text.includes('controller')) { return ['Controller']; }
	if (/mybatis|sql|xml/.test(text)) { return ['MyBatis']; }
	if (text.includes('service')) { return ['Service', 'ServiceImpl']; }
	if (/mapper|dao/.test(text)) { return ['Mapper', 'MyBatis']; }
	if (text.includes('valid')) { return ['Validator']; }
	if (/vo|dto/.test(text)) { return ['VO']; }
	return [];
}

/**
 * files(작업 폴더 기준 경로 목록)에서 screen(화면 파일 이름, 확장자 없이)의 도메인으로 시작하는 파일을 고른다.
 * 도메인 바로 뒤는 대문자·`_`·`-`여야 한다(userList ↔ UserListController 맞음, userLists 아님). 번호가 이어지는 userList02 같은 옆 화면은 뺀다.
 * 이 탭에 맞는 역할이 먼저, 그다음 흔한 역할 순서
 */
export function suggestLinks(screen: string, tab: LinkTab, files: readonly string[], limit = SUGGEST_LIMIT): LinkSuggestion[] {
	const domain = screenDomain(screen);
	if (!domain) { return []; }
	const prefixes = [...new Set([screen, domain])];
	const wanted = wantedRoles(tab);
	const found: { suggestion: LinkSuggestion; rank: number }[] = [];
	for (const file of files) {
		if (BUILD_DIR.test(file)) { continue; }
		const name = file.split(/[\\/]/).pop() ?? file;
		const dot = name.lastIndexOf('.');
		const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
		let rest: string | undefined;
		for (const prefix of prefixes) {
			if (!base.toLowerCase().startsWith(prefix.toLowerCase())) { continue; }
			const tail = base.slice(prefix.length);
			if (tail && /[a-z]/.test(tail[0])) { continue; }
			// 도메인만으로 맞았는데 번호가 이어지면 다른 화면(userList02)
			if (prefix === domain && prefix !== screen && /^\d/.test(tail)) { continue; }
			rest = tail;
			break;
		}
		if (rest === undefined || (rest === '' && ext === '.xml' && base.toLowerCase() === screen.toLowerCase())) { continue; }
		let role = ROLE_OF[rest.toLowerCase().replace(/[_\-.\s]/g, '')] ?? (ext.slice(1).toUpperCase() || '파일');
		if (ext === '.xml' && role === 'Mapper') { role = 'MyBatis'; }
		const fit = wanted.indexOf(role);
		const order = ROLE_ORDER.indexOf(role);
		found.push({ suggestion: { file, name, role, fit: fit >= 0 }, rank: (fit >= 0 ? fit : 100) * 1000 + (order >= 0 ? order : 99) * 10 + (ext === '.java' ? 0 : 1) });
	}
	return found.sort((a, b) => a.rank - b.rank || a.suggestion.file.localeCompare(b.suggestion.file)).slice(0, limit).map(f => f.suggestion);
}
