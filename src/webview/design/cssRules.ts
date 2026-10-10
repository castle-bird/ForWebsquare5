import type { CssRuleSource } from '../../core/protocol';

export function matchingCssRules(element: Element, rules: CssRuleSource[]): number[] {
	// shortcut: 중첩 CSS·@container·@scope는 판정하지 않는다, 해당 문법을 쓰는 프로젝트에서 조건 추적을 확장한다.
	return rules.flatMap((rule, index) => {
		try {
			return rule.media.every(query => window.matchMedia(query).matches)
				&& rule.supports.every(condition => CSS.supports(condition))
				&& element.matches(rule.match) ? [index] : [];
		} catch {
			// 브라우저가 지원하지 않는 선택자는 적용되지 않는다.
			return [];
		}
	});
}
