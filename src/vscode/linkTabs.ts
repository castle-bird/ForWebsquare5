// 연결 탭 목록·순서(모든 화면 공통, globalState)와 추가·이름 변경·삭제. 연결한 파일은 links.ts가 다룬다
import * as vscode from 'vscode';
import { newTabId, readLinkExts, readLinkTabs, tabNameProblem, type LinkTab } from '../core/links';
import type { TabPosition } from '../core/protocol';

const TAB_ORDER = 'websquare5-editor.tabOrder';
const TAB_POSITION = 'websquare5-editor.tabPosition';
const LINK_TABS = 'websquare5-editor.linkTabs';

let globalState: vscode.Memento;
/** 탭 목록이 바뀜. from: 바꾼 디자이너(그 화면만 select 탭으로 넘어간다) */
const tabsChanged = new vscode.EventEmitter<{ tabs: LinkTab[]; from?: unknown; select?: string }>();
export const onTabsChanged = tabsChanged.event;

export function registerLinkTabs(context: vscode.ExtensionContext): void {
	globalState = context.globalState;
	context.subscriptions.push(tabsChanged);
}

/** Design·Script·Source·연결 탭 순서(탭 이름). 모든 화면 공통 */
export const tabOrder = () => globalState.get<string[]>(TAB_ORDER);
export const saveTabOrder = (order: string[]) => globalState.update(TAB_ORDER, order);
/** 탭 줄 위치. 모든 화면 공통, 기본 위 */
export const tabPosition = (): TabPosition => globalState.get<TabPosition>(TAB_POSITION) ?? 'top';
export const saveTabPosition = (position: TabPosition) => globalState.update(TAB_POSITION, position);

export const linkTabs = () => readLinkTabs(globalState.get(LINK_TABS));
/** 연결할 수 있는 확장자(설정 websquare5-editor.linkFileExtensions) */
export const linkExts = () => readLinkExts(vscode.workspace.getConfiguration('websquare5-editor').get('linkFileExtensions'));
export const LINK_EXTS_SETTING = 'websquare5-editor.linkFileExtensions';
export const linkTab = (id: string) => linkTabs().find(t => t.id === id);

export async function saveLinkTabs(tabs: LinkTab[], from?: unknown, select?: string): Promise<void> {
	await globalState.update(LINK_TABS, tabs);
	tabsChanged.fire({ tabs, from, select });
}

/** 이름 입력: 입력하는 동안 다른 화면에서 탭이 바뀌었을 수 있어, 확인 뒤 지금 목록으로 다시 검사한다 */
async function askName(options: vscode.InputBoxOptions, others: () => LinkTab[]): Promise<string | undefined> {
	const label = (await vscode.window.showInputBox({ ...options, validateInput: value => tabNameProblem(value, others()) }))?.trim();
	const problem = label && tabNameProblem(label, others());
	if (problem) {
		void vscode.window.showWarningMessage(problem);
	}
	return problem ? undefined : label;
}

/** + 버튼: 이름을 받아 모든 화면에 탭 추가, from 화면은 그 탭으로 */
export async function addLinkTab(from: unknown): Promise<void> {
	const label = await askName({ title: '연결 탭 추가', prompt: `탭 이름 (연결할 수 있는 파일: ${linkExts().join('·')})` }, linkTabs);
	if (label) {
		const tabs = linkTabs();
		await saveLinkTabs([...tabs, { id: newTabId(tabs), label }], from, label);
	}
}

/** 이름 변경: 모든 화면에서 바뀌고 탭 자리(순서는 이름으로 저장)와 연결은 그대로 */
export async function renameLinkTab(id: string): Promise<void> {
	const tab = linkTab(id);
	const others = () => linkTabs().filter(t => t.id !== id);
	const label = tab && await askName({ title: '탭 이름 변경', value: tab.label, valueSelection: [0, tab.label.length] }, others);
	const current = linkTab(id);
	if (!label || !current || label === current.label) {
		return;
	}
	const order = tabOrder();
	if (order) {
		await saveTabOrder(order.map(name => name === current.label ? label : name));
	}
	await saveLinkTabs(linkTabs().map(t => t.id === id ? { ...t, label } : t));
}

/** 삭제: 모든 화면에서 탭과 연결 정보가 없어진다(파일은 그대로) */
export async function removeLinkTab(id: string): Promise<void> {
	const tab = linkTab(id);
	const pick = tab && await vscode.window.showWarningMessage(`'${tab.label}' 탭을 삭제할까요?`,
		{ modal: true, detail: '모든 화면에서 이 탭과 연결 정보가 지워집니다. 연결했던 파일은 그대로입니다.' }, '삭제');
	if (pick === '삭제') {
		await saveLinkTabs(linkTabs().filter(t => t.id !== id));
	}
}
