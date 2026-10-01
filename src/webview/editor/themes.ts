import type { Extension } from '@codemirror/state';
import { amy, ayuLight, barf, bespin, birdsOfParadise, boysAndGirls, clouds, cobalt, coolGlow, dracula, espresso, noctisLilac, rosePineDawn, smoothy, solarizedLight, tomorrow } from 'thememirror';
import type { CodeThemeId } from '../../core/codeTheme';

/** 목록(CODE_THEMES)의 id마다 thememirror 테마. 목록에 테마를 더하면 여기도 빠짐없이 있어야 컴파일된다 */
export const THEMES: Record<Exclude<CodeThemeId, 'vscode'>, Extension> = {
	amy, ayuLight, barf, bespin, birdsOfParadise, boysAndGirls, clouds, cobalt, coolGlow, dracula, espresso, noctisLilac, rosePineDawn, smoothy, solarizedLight, tomorrow,
};
