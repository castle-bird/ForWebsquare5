// 코드 편집기(Script·Source·연결 탭) 테마: VS Code 테마 따라가기 + thememirror(MIT) 테마. 모든 화면 공통
export const CODE_THEMES = [
	{ id: 'vscode', label: 'VS Code 테마 따라가기 (기본)' },
	{ id: 'amy', label: 'Amy', dark: true },
	{ id: 'ayuLight', label: 'Ayu Light', dark: false },
	{ id: 'barf', label: 'Barf', dark: true },
	{ id: 'bespin', label: 'Bespin', dark: true },
	{ id: 'birdsOfParadise', label: 'Birds of Paradise', dark: true },
	{ id: 'boysAndGirls', label: 'Boys and Girls', dark: true },
	{ id: 'clouds', label: 'Clouds', dark: false },
	{ id: 'cobalt', label: 'Cobalt', dark: true },
	{ id: 'coolGlow', label: 'Cool Glow', dark: true },
	{ id: 'dracula', label: 'Dracula', dark: true },
	{ id: 'espresso', label: 'Espresso', dark: false },
	{ id: 'noctisLilac', label: 'Noctis Lilac', dark: false },
	{ id: 'rosePineDawn', label: 'Rosé Pine Dawn', dark: false },
	{ id: 'smoothy', label: 'Smoothy', dark: false },
	{ id: 'solarizedLight', label: 'Solarized Light', dark: false },
	{ id: 'tomorrow', label: 'Tomorrow', dark: false },
] as const;

export type CodeThemeId = typeof CODE_THEMES[number]['id'];

/*
 * 사용자 테마: 바탕 테마 위에 덧칠하는 층(ThemeOverlay).
 * - 덮어쓰기: 설정 websquare5-editor.codeThemeCustomizations → 고른 테마 위에 한 층
 * - 가져오기: VS Code 테마 .json → 변환한 층을 VS Code 기본 다크·라이트 위에(빠진 색은 바탕 그대로)
 */
const COLOR_KEYS = ['background', 'foreground', 'caret', 'selection', 'lineHighlight', 'gutterBackground', 'gutterForeground'] as const;
export type ColorKey = typeof COLOR_KEYS[number];

/** 문법 색 종류마다 VS Code 테마(TextMate scope)에서 찾을 scope, 앞의 것부터 */
const TOKEN_SCOPES = {
	comment: ['comment'],
	string: ['string'],
	number: ['constant.numeric'],
	constant: ['constant.language', 'constant'],
	keyword: ['keyword.control', 'keyword'],
	modifier: ['storage.modifier', 'storage', 'keyword'],
	type: ['entity.name.type', 'support.type', 'storage.type'],
	function: ['entity.name.function', 'support.function'],
	variable: ['variable.other', 'variable'],
	property: ['variable.other.property', 'support.type.property-name', 'variable.other'],
	operator: ['keyword.operator'],
	tag: ['entity.name.tag'],
	attribute: ['entity.other.attribute-name'],
	annotation: ['storage.type.annotation', 'meta.annotation', 'punctuation.definition.annotation'],
} as const;
export type TokenKind = keyof typeof TOKEN_SCOPES;
export const TOKEN_KINDS = Object.keys(TOKEN_SCOPES) as TokenKind[];

/** fontStyle: italic·bold·underline을 공백으로, 빈 글자는 기본(굵게·기울임 없음) */
export interface TokenStyle { color?: string; fontStyle?: string }
export interface ThemeOverlay { colors?: Partial<Record<ColorKey, string>>; tokens?: Partial<Record<TokenKind, TokenStyle>> }

/**
 * 웹뷰로 보내는 테마: 바탕(dark가 있으면 VS Code 기본 다크·라이트) 위에 가져온 색 → 공통 덮어쓰기 → 이 테마 덮어쓰기 순으로 칠한다.
 * id·label: 덮어쓰기 팝업의 제목과 설정 키("[label]")
 */
export interface CodeThemeState {
	theme: CodeThemeId; dark?: boolean; id?: string; label?: string;
	imported?: ThemeOverlay; common?: ThemeOverlay; own?: ThemeOverlay;
}

/** 칠하는 순서대로의 층 */
export const layersOf = (s: CodeThemeState) => [s.imported, s.common, s.own].filter((o): o is ThemeOverlay => !!o);

/** 가져온 테마(globalState) */
export interface ImportedTheme { id: string; label: string; dark: boolean; overlay: ThemeOverlay }

export const isColor = (v: unknown): v is string => typeof v === 'string' && /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.trim());

/** 설정에 적은 층 하나: 모르는 키·틀린 색은 버린다. 토큰은 "#색" 또는 { color, fontStyle } */
export function readOverlay(value: unknown): ThemeOverlay | undefined {
	if (!value || typeof value !== 'object') { return undefined; }
	const { colors, tokens } = value as { colors?: Record<string, unknown>; tokens?: Record<string, unknown> };
	const out: ThemeOverlay = {};
	for (const key of COLOR_KEYS) {
		if (isColor(colors?.[key])) { (out.colors ??= {})[key] = colors[key].trim(); }
	}
	for (const kind of TOKEN_KINDS) {
		const v = tokens?.[kind];
		const style: TokenStyle = isColor(v) ? { color: v.trim() } : v && typeof v === 'object' ? {
			...isColor((v as TokenStyle).color) && { color: (v as TokenStyle).color!.trim() },
			...typeof (v as TokenStyle).fontStyle === 'string' && { fontStyle: (v as TokenStyle).fontStyle },
		} : {};
		if (Object.keys(style).length) { (out.tokens ??= {})[kind] = style; }
	}
	return out.colors || out.tokens ? out : undefined;
}

/** 설정에서 이 테마 칸의 키: "[id]" 또는 "[이름]"(대소문자 무시) */
const ownKey = (s: Record<string, unknown>, id: string, label: string) =>
	Object.keys(s).find(k => k === `[${id}]` || k.toLowerCase() === `[${label.toLowerCase()}]`);

/** 덮어쓰기 설정에서 이 테마에 얹을 층: 공통(colors·tokens)과 "[id 또는 이름]" */
export function customizationsFor(setting: unknown, id: string, label: string): Pick<CodeThemeState, 'common' | 'own'> {
	if (!setting || typeof setting !== 'object') { return {}; }
	const s = setting as Record<string, unknown>, key = ownKey(s, id, label);
	const common = readOverlay(s), own = key ? readOverlay(s[key]) : undefined;
	return { ...common && { common }, ...own && { own } };
}

/** 팝업에서 고친 공통·이 테마 층을 설정 값에 반영(다른 테마 칸은 그대로, 빈 층은 지움) */
export function withCustomizations(setting: unknown, id: string, label: string, common: ThemeOverlay | undefined, own: ThemeOverlay | undefined): Record<string, unknown> {
	const s: Record<string, unknown> = setting && typeof setting === 'object' ? { ...setting as Record<string, unknown> } : {};
	const c = readOverlay(common);
	delete s.colors; delete s.tokens;
	if (c) { Object.assign(s, c); }
	const key = ownKey(s, id, label) ?? `[${label}]`, o = readOverlay(own);
	if (o) { s[key] = o; } else { delete s[key]; }
	return s;
}

/** VS Code 테마 JSON은 주석·끝 쉼표를 허용(JSONC). 문자열 밖의 것만 지운다 */
export function parseJsonc(text: string): unknown {
	const noComments = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, str: string | undefined) => str ?? '');
	return JSON.parse(noComments.replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/g, (_, str: string | undefined, close: string | undefined) => str ?? close!));
}

/** VS Code 테마 .json(include는 따라가 합친 뒤) */
export interface VsTheme { name?: string; type?: string; colors?: Record<string, string>; tokenColors?: unknown; include?: string }
interface TokenRule { scope?: string | string[]; settings?: { foreground?: string; background?: string; fontStyle?: string } }

/** VS Code 테마(include는 미리 합친 것) → 층. 문법 색은 TextMate 규칙처럼 scope 앞부분이 가장 길게 맞는 규칙 */
export function fromVsCodeTheme(theme: VsTheme): ThemeOverlay & { dark: boolean } {
	if (typeof theme.tokenColors === 'string') { throw new Error('tokenColors가 다른 파일(.tmTheme)을 가리키는 테마는 아직 못 가져와.'); }
	const rules = (Array.isArray(theme.tokenColors) ? theme.tokenColors : []) as TokenRule[];
	const c = theme.colors ?? {};
	const global = rules.find(r => !r.scope)?.settings;
	const pick = (...keys: (string | undefined)[]) => keys.find(isColor);
	const colors: ThemeOverlay['colors'] = {};
	const set = (key: ColorKey, value: string | undefined) => { if (value) { colors[key] = value; } };
	set('background', pick(c['editor.background'], global?.background));
	set('foreground', pick(c['editor.foreground'], global?.foreground));
	set('caret', pick(c['editorCursor.foreground']));
	set('selection', pick(c['editor.selectionBackground']));
	set('lineHighlight', pick(c['editor.lineHighlightBackground']));
	set('gutterBackground', pick(c['editorGutter.background'], c['editor.background']));
	set('gutterForeground', pick(c['editorLineNumber.foreground']));
	// 공백(자손 선택자) 있는 규칙은 특정 언어·문맥용이라 뺀다
	const selectors = rules.flatMap((r, order) => (Array.isArray(r.scope) ? r.scope : (r.scope ?? '').split(','))
		.map(s => s.trim()).filter(s => s && !/\s/.test(s)).map(scope => ({ scope, order, settings: r.settings ?? {} })));
	// 색과 글꼴 모양은 VS Code처럼 따로 찾는다(기울임만 정한 더 구체적인 규칙이 색을 지우지 않게)
	const best = (scope: string, has: (s: NonNullable<TokenRule['settings']>) => boolean) => selectors
		.filter(s => (scope === s.scope || scope.startsWith(s.scope + '.')) && has(s.settings))
		.sort((a, b) => b.scope.length - a.scope.length || b.order - a.order)[0]?.settings;
	const first = (kind: TokenKind, has: (s: NonNullable<TokenRule['settings']>) => boolean) => TOKEN_SCOPES[kind].map(scope => best(scope, has)).find(Boolean);
	const tokens: ThemeOverlay['tokens'] = {};
	for (const kind of TOKEN_KINDS) {
		const color = first(kind, s => isColor(s.foreground))?.foreground, fontStyle = first(kind, s => typeof s.fontStyle === 'string')?.fontStyle;
		if (color || fontStyle !== undefined) { tokens[kind] = { ...color && { color }, ...fontStyle !== undefined && { fontStyle } }; }
	}
	const type = theme.type?.toLowerCase();
	const dark = type ? !/light/.test(type) : luminance(colors.background ?? '#000') < 0.5;
	return { dark, ...Object.keys(colors).length && { colors }, ...Object.keys(tokens).length && { tokens } };
}

function luminance(hex: string): number {
	const h = hex.replace('#', ''), full = h.length <= 4 ? [...h.slice(0, 3)].map(x => x + x).join('') : h.slice(0, 6);
	const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
