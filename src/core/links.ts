// 화면 XML에 연결하는 서버 쪽 파일 탭. 탭 목록은 모든 화면 공통(추가·삭제 가능), 연결한 파일은 화면마다
export interface LinkTab {
	/** 연결 정보·메시지에 쓰는 고정 값. 탭 이름(label)은 화면에 보이는 이름 */
	id: string;
	label: string;
}

/** 모든 연결 탭이 받는 파일 기본값(설정 websquare5-editor.linkFileExtensions). 편집기 언어는 확장자로 고른다(webview/editor/linkLanguages.ts) */
export const DEFAULT_LINK_EXTS = ['.java', '.xml', '.html', '.htm', '.css', '.js', '.sql'];

/** 설정값 → `.확장자` 소문자 목록(점 없이 적어도 됨, 중복·빈 값 제거). 쓸 값이 없으면 기본값 */
export function readLinkExts(value: unknown): string[] {
	const exts = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string')
		.map(v => v.trim().toLowerCase().replace(/^\*?\.?/, '.')).filter(v => /^\.[\w.-]+$/.test(v)) : [];
	return exts.length ? [...new Set(exts)] : DEFAULT_LINK_EXTS;
}

/** 지울 수 없는 탭 */
export const FIXED_TABS = ['Design', 'Info', 'Script', 'Source'];

export const DEFAULT_LINK_TABS: LinkTab[] = [
	{ id: 'controller', label: 'Controller' },
	{ id: 'service', label: 'Service' },
	{ id: 'mapper', label: 'Mapper' },
	{ id: 'mybatis', label: 'Mybatis' },
];

/** 편집기 메시지의 연결 파일 대상. source·script(화면 XML)와 겹치지 않게 접두사를 붙인다 */
export type LinkTarget = `link:${string}`;
export const linkTarget = (id: string): LinkTarget => `link:${id}`;
export const linkIdOf = (target: string) => target.startsWith('link:') ? target.slice(5) : undefined;

const isLinkTab = (value: unknown): value is LinkTab => {
	const tab = value as LinkTab;
	return !!tab && typeof tab.id === 'string' && typeof tab.label === 'string';
};

/** 저장된 탭 목록(예전 판이 같이 저장한 탭별 확장자 등은 버림). 없거나 모양이 틀리면 기본 4개 */
export const readLinkTabs = (stored: unknown): LinkTab[] =>
	Array.isArray(stored) && stored.every(isLinkTab) ? stored.map(({ id, label }) => ({ id, label })) : DEFAULT_LINK_TABS;

/** 입력한 경로의 앞뒤 공백·따옴표 제거 (Windows "경로로 복사"는 따옴표를 붙인다) */
export const cleanPath = (input: string) => input.trim().replace(/^(["'])(.*)\1$/, '$2').trim();

/** 연결할 수 없는 파일이면 이유, 되면 undefined */
export function linkProblem(file: string, inWorkspace: boolean, exts: string[]): string | undefined {
	if (!exts.some(ext => file.toLowerCase().endsWith(ext))) {
		return `${exts.join('·')} 파일만 연결할 수 있습니다. (설정: websquare5-editor.linkFileExtensions)`;
	}
	return inWorkspace ? undefined : '작업 폴더 안의 파일만 연결할 수 있습니다.';
}

/** 새 탭 이름으로 쓸 수 없으면 이유 (대소문자 무시하고 겹치면 안 됨) */
export function tabNameProblem(input: string, tabs: LinkTab[]): string | undefined {
	const name = input.trim(), same = (other: string) => other.toLowerCase() === name.toLowerCase();
	if (!name) {
		return '탭 이름을 입력해 주세요.';
	}
	if (name.length > 30) {
		return '탭 이름은 30자까지입니다.';
	}
	return FIXED_TABS.some(same) || tabs.some(t => same(t.label)) ? `이미 있는 탭 이름입니다: ${name}` : undefined;
}

/** 지금 탭들과 겹치지 않는 새 id */
export function newTabId(tabs: LinkTab[]): string {
	let n = 1;
	while (tabs.some(t => t.id === `tab${n}`)) {
		n++;
	}
	return `tab${n}`;
}

/** 저장해 둔 탭 순서대로. 순서에 없는 탭(새로 생긴 고정 탭·새 연결 탭)은 원래 바로 앞 탭 뒤에, 맨 앞 탭이면 맨 뒤에 */
export function orderTabs(names: string[], order: readonly string[] = []): string[] {
	const rank = (n: string): number => {
		const i = order.indexOf(n), at = names.indexOf(n);
		return i >= 0 ? i : at > 0 ? rank(names[at - 1]) + 1 / (names.length + 1) : order.length + at;
	};
	return [...names].sort((a, b) => rank(a) - rank(b));
}

/** dragged를 target 앞(after면 뒤)으로 옮긴 순서 */
export function moveTab(names: readonly string[], dragged: string, target: string, after: boolean): string[] {
	if (dragged === target || !names.includes(dragged) || !names.includes(target)) {
		return [...names];
	}
	const rest = names.filter(n => n !== dragged);
	rest.splice(rest.indexOf(target) + (after ? 1 : 0), 0, dragged);
	return rest;
}
