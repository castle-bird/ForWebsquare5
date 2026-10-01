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

/** 저장값이 목록에 없으면 VS Code 따라가기 */
export const readCodeTheme = (value: unknown): CodeThemeId => CODE_THEMES.find(t => t.id === value)?.id ?? 'vscode';
