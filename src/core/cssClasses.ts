import type { CssRuleSource } from './protocol';

/** 화면에 적용된 CSS 규칙의 선택자에서 클래스 이름을 모은다(class 값 자동완성 목록). 속성 선택자·문자열·`.5` 같은 숫자는 클래스가 아니다 */
export function cssClassNames(rules: readonly Pick<CssRuleSource, 'selector'>[]): string[] {
	const names = new Set<string>();
	for (const { selector } of rules) {
		const bare = selector.replace(/\[[^\]]*\]|"[^"]*"|'[^']*'/g, '');
		// 뒤에 이름 글자나 이스케이프(`.a\:b`)가 이어지면 이름이 잘린 것이라 건너뛴다
		for (const [, name] of bare.matchAll(/\.(-?[_a-zA-Z -￿][\w -￿-]*)(?![\\\w -￿-])/g)) {
			names.add(name);
		}
	}
	// 글자 코드 순: 언어 설정과 상관없이 같은 목록
	return [...names].sort();
}
