// 모든 화면 공통 보기 설정(globalState): 탭 줄 위치·우측 패널 글꼴·코드 미니맵·애니메이션·Git blame. 탭 목록·순서는 linkTabs.ts
import * as vscode from 'vscode';
import type { PanelFont, TabPosition } from '../core/protocol';

const TAB_POSITION = 'for-websquare5.tabPosition';
const PANEL_FONT = 'for-websquare5.panelFont';
const MINIMAP = 'for-websquare5.minimap';
const BLAME = 'for-websquare5.codeBlame';
const ANIMATION = 'for-websquare5.animation';

let globalState: vscode.Memento;
const blameToggled = new vscode.EventEmitter<boolean>();
/** Git blame을 켜고 끔(모든 화면이 켜지면 다시 구해 보낸다) */
export const onBlameToggled = blameToggled.event;

export function registerViewSettings(context: vscode.ExtensionContext): void {
	globalState = context.globalState;
	context.subscriptions.push(blameToggled);
}

/** 탭 줄 위치. 모든 화면 공통, 기본 위 */
export const tabPosition = (): TabPosition => globalState.get<TabPosition>(TAB_POSITION) ?? 'top';
export const saveTabPosition = (position: TabPosition) => globalState.update(TAB_POSITION, position);
/** 우측 패널 글꼴. 모든 화면 공통, 기본 VS Code 편집기 글꼴 */
export const panelFont = (): PanelFont => globalState.get(PANEL_FONT) === 'ui' ? 'ui' : 'editor';
export const savePanelFont = (font: PanelFont) => globalState.update(PANEL_FONT, font);
/** 코드 편집기 미니맵. 모든 화면 공통, 기본 켬 */
export const minimapOn = () => globalState.get<boolean>(MINIMAP) ?? true;
export const saveMinimap = (on: boolean) => globalState.update(MINIMAP, on);
/** 애니메이션(탭 배경 이동·메뉴·팝업 열림). 모든 화면 공통, 기본 켬 */
export const animationOn = () => globalState.get<boolean>(ANIMATION) ?? true;
export const saveAnimation = (on: boolean) => globalState.update(ANIMATION, on);
/** 코드 편집기 커서 줄 끝 Git blame. 모든 화면 공통, 기본 켬. 끄면 git blame을 돌리지 않는다 */
export const blameOn = () => globalState.get<boolean>(BLAME) ?? true;
export async function saveBlame(on: boolean): Promise<void> {
	await globalState.update(BLAME, on);
	blameToggled.fire(on);
}
