import { Prec, type EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, highlightingFor, syntaxHighlighting } from '@codemirror/language';
import { tags as t, type Tag } from '@lezer/highlight';
import { vsCodeDark } from '@fsegurai/codemirror-theme-vscode-dark';
import { vsCodeLight } from '@fsegurai/codemirror-theme-vscode-light';
import { amy, ayuLight, barf, bespin, birdsOfParadise, boysAndGirls, clouds, cobalt, coolGlow, dracula, espresso, noctisLilac, rosePineDawn, smoothy, solarizedLight, tomorrow } from 'thememirror';
import { layersOf, TOKEN_KINDS, type CodeThemeId, type CodeThemeState, type ColorKey, type ThemeOverlay, type TokenKind, type TokenStyle } from '../../core/codeTheme';

/** 목록(CODE_THEMES)의 id마다 thememirror 테마. 목록에 테마를 더하면 여기도 빠짐없이 있어야 컴파일된다 */
const THEMES: Record<Exclude<CodeThemeId, 'vscode'>, Extension> = {
	amy, ayuLight, barf, bespin, birdsOfParadise, boysAndGirls, clouds, cobalt, coolGlow, dracula, espresso, noctisLilac, rosePineDawn, smoothy, solarizedLight, tomorrow,
};

/**
 * 모든 CodeMirror 편집기 공통: VS Code 편집기 글꼴·크기, 그리고 CodeMirror가 넣는 <style>에 웹뷰 CSP nonce.
 * nonce가 없으면 그 편집기의 테마·문법 색 스타일이 막힌다(다른 편집기가 먼저 넣어 줬을 때만 칠해짐)
 */
export const editorBase = [
	EditorView.cspNonce.of(document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? ''),
	EditorView.theme({ '.cm-scroller': { fontFamily: 'var(--vscode-editor-font-family)', fontSize: 'var(--vscode-editor-font-size)' } }),
];

/** VS Code 테마를 따라가는지(밝음·어두움 전환을 따름, 팝업 색도 VS Code 변수) */
export const followsVsCode = (s: CodeThemeState) => s.theme === 'vscode' && s.dark === undefined;
/** 코드 편집기 바깥 클래스: 고른·가져온 테마면 custom-theme(선택·팝업 색을 테마에 맡김, style.css) */
export const editorClass = (s: CodeThemeState) => followsVsCode(s) ? 'code-editor' : 'code-editor custom-theme';

const vsTheme = () => document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast-light') ? vsCodeLight : vsCodeDark;

/** 문법 색 종류 → CodeMirror(Lezer) 태그. VS Code(TextMate)보다 덜 잘게 나뉘어 가져온 테마는 비슷하게 맞는다 */
const TAGS: Record<TokenKind, Tag[]> = {
	comment: [t.comment, t.lineComment, t.blockComment, t.docComment],
	string: [t.string, t.special(t.string), t.character],
	number: [t.number, t.integer, t.float],
	constant: [t.bool, t.null, t.atom],
	keyword: [t.keyword, t.controlKeyword, t.operatorKeyword, t.moduleKeyword],
	modifier: [t.modifier, t.definitionKeyword, t.self],
	type: [t.typeName, t.className, t.namespace],
	function: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))],
	variable: [t.variableName, t.definition(t.variableName), t.local(t.variableName)],
	property: [t.propertyName, t.definition(t.propertyName)],
	operator: [t.operator, t.arithmeticOperator, t.logicOperator, t.compareOperator],
	tag: [t.tagName],
	attribute: [t.attributeName],
	annotation: [t.annotation, t.meta],
};

const font = (style: string) => ({
	fontStyle: /italic/.test(style) ? 'italic' : 'normal',
	fontWeight: /bold/.test(style) ? 'bold' : 'normal',
	textDecoration: /underline/.test(style) ? 'underline' : 'none',
});

/** 덧칠 층 하나: 정한 것만 바탕 테마 위에(가장 높은 우선순위). 선택·현재 줄 색은 CSS 변수로(codeVars) */
function overlay({ colors: c = {}, tokens = {} }: ThemeOverlay): Extension {
	const spec: Record<string, Record<string, string>> = {};
	if (c.background || c.foreground) { spec['&'] = { ...c.background && { backgroundColor: c.background }, ...c.foreground && { color: c.foreground } }; }
	if (c.caret) {
		spec['.cm-content'] = { caretColor: c.caret };
		spec['.cm-cursor, .cm-dropCursor'] = { borderLeftColor: c.caret };
	}
	if (c.gutterBackground || c.gutterForeground) { spec['.cm-gutters'] = { ...c.gutterBackground && { backgroundColor: c.gutterBackground }, ...c.gutterForeground && { color: c.gutterForeground } }; }
	const styles = TOKEN_KINDS.flatMap(kind => {
		const s = tokens[kind];
		return s ? [{ tag: TAGS[kind], ...s.color && { color: s.color }, ...s.fontStyle !== undefined && font(s.fontStyle) }] : [];
	});
	return Prec.highest([EditorView.theme(spec), ...styles.length ? [syntaxHighlighting(HighlightStyle.define(styles))] : []]);
}

/** 바탕(VS Code 따라가기·thememirror·가져온 테마는 VS Code 기본 다크/라이트) + 덧칠 층들 */
export function themeOf(s: CodeThemeState): Extension {
	const base = s.dark !== undefined ? s.dark ? vsCodeDark : vsCodeLight : s.theme === 'vscode' ? vsTheme() : THEMES[s.theme];
	return [base, ...layersOf(s).map(overlay)];
}

/** 선택 영역·현재 줄 색(style.css에서 !important라 테마 확장으로는 못 덮음): 뒤 층이 이긴다 */
export function codeVars(s: CodeThemeState): Record<string, string> {
	const c = Object.assign({}, ...layersOf(s).map(o => o.colors ?? {})) as NonNullable<ThemeOverlay['colors']>;
	return { ...c.selection && { '--code-selection': c.selection }, ...c.lineHighlight && { '--code-line': c.lineHighlight } };
}

/** 덮어쓰기 팝업의 "테마 기본" 값: 색은 #rrggbb(반투명이면 #rrggbbaa), 글꼴 모양은 italic·bold·underline */
interface ThemeColors { colors: Partial<Record<ColorKey, string>>; tokens: Partial<Record<TokenKind, TokenStyle>> }

const toHex = (css: string) => {
	const [r, g, b, a = 1] = (css.match(/[\d.]+/g) ?? []).map(Number);
	if (b === undefined || a === 0) { return undefined; }
	return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}${a < 1 ? Math.round(a * 255).toString(16).padStart(2, '0') : ''}`;
};
const fontOf = (st: CSSStyleDeclaration) => [st.fontStyle === 'italic' && 'italic', Number(st.fontWeight) >= 600 && 'bold', st.textDecorationLine.includes('underline') && 'underline'].filter(Boolean).join(' ');

/** 이 테마가 실제로 칠하는 색: 화면 밖 편집기에 칠해 보고 계산된 스타일을 읽는다(style.css의 선택·현재 줄 규칙 포함) */
export function readThemeColors(s: CodeThemeState): ThemeColors {
	const host = document.body.appendChild(document.createElement('div'));
	host.className = editorClass(s);
	host.style.cssText = 'position: fixed; left: -9999px; top: 0; width: 200px; height: 80px;';
	for (const [name, value] of Object.entries(codeVars(s))) { host.style.setProperty(name, value); }
	const view = new EditorView({ parent: host, extensions: [editorBase, themeOf(s)] });
	try {
		const probe = (className: string) => getComputedStyle(Object.assign(view.dom.appendChild(document.createElement('div')), { className }));
		const root = getComputedStyle(view.dom), gutter = probe('cm-gutters');
		const caret = getComputedStyle(view.contentDOM).caretColor;
		const colors: ThemeColors['colors'] = {
			background: toHex(root.backgroundColor), foreground: toHex(root.color), caret: toHex(caret === 'auto' ? root.color : caret),
			selection: toHex(probe('cm-selectionBackground').backgroundColor), lineHighlight: toHex(probe('cm-activeLine').backgroundColor),
			gutterBackground: toHex(gutter.backgroundColor) ?? toHex(root.backgroundColor), gutterForeground: toHex(gutter.color),
		};
		const tokens = Object.fromEntries(TOKEN_KINDS.map(kind => {
			const st = probe(highlightingFor(view.state, TAGS[kind]) ?? '');
			return [kind, { color: toHex(st.color), fontStyle: fontOf(st) }];
		}));
		return { colors, tokens };
	} finally {
		view.destroy();
		host.remove();
	}
}

/**
 * 설명 팝업(언어 서버 마크다운·JSDoc)의 라벨에 지금 코드 테마의 문법 색: Parameters:·@태그 같은 라벨은 키워드 색,
 * 파라미터 이름은 변수 색, 타입은 타입 색. 테마를 따로 골라도 그 테마 색을 따른다(class라 글꼴 모양도 같이)
 */
export function colorDoc(dom: HTMLElement, state: EditorState): HTMLElement {
	const paint = (selector: string, kind: TokenKind) => {
		// 대표 태그 하나로(묶음째 넘기면 operatorKeyword 같은 다른 색이 섞인다)
		const cls = highlightingFor(state, [TAGS[kind][0]]);
		if (cls) {
			dom.querySelectorAll(selector).forEach(e => e.classList.add(...cls.split(' ')));
		}
	};
	paint(':scope ul ul > li > strong:first-child, .ws-doc-badge', 'variable');
	paint(':scope > ul > li > strong:first-child, :scope > p > strong:first-child, .ws-doc-section', 'keyword');
	paint('.ws-doc-type', 'type');
	return dom;
}

/**
 * VS Code 다크·라이트 테마는 찾기의 지금 일치 안 글자(`.cm-searchMatch-selected span`)를 한 색으로 칠해 문법 색을 지운다.
 * 일치 표시가 문법 색 span을 감싸서(우선순위가 검색 패키지 안에 고정) CSS로는 원래 색을 되돌릴 수 없어, 그 규칙의 글자색만 지운다.
 * 테마 스타일은 편집기를 만들거나 테마를 바꿀 때 붙으므로 그때마다 부른다(배경·여백은 style.css)
 */
export function keepSearchMatchColors(): void {
	for (const sheet of [...document.adoptedStyleSheets, ...document.styleSheets]) {
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			continue;
		}
		for (const rule of rules) {
			if (rule instanceof CSSStyleRule && /cm-searchMatch-selected\s+span\s*$/.test(rule.selectorText)) {
				rule.style.removeProperty('color');
			}
		}
	}
}
