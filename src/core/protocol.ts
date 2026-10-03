import type { XmlNode } from './xmlModel';
import type { DataField, DataKind } from './data';
import type { SubmissionFields } from './submission';
import type { GridBindMode, GridExtras, GridPart } from './grid';
import type { ChoicesFields } from './choices';
import type { InsertPosition, DropPosition } from './paste';
import type { LinkTab, LinkTarget } from './links';
import type { CodeThemeState, ThemeOverlay } from './codeTheme';
import type { CodeOptions } from './codeOptions';

export type ToWebview =
	| { type: 'document'; version: number; text: string; script: ScriptInfo; root?: XmlNode; error?: string }
	| { type: 'popupAck'; popup: string; ok: boolean; error?: string }
	| { type: 'codeAck'; target: CodeTarget; ok: boolean; version: number }
	| { type: 'formatKey' }
	| { type: 'select'; id: string }
	| { type: 'formatted'; target: CodeTarget; text?: string }
	| { type: 'scriptApi'; api: ScriptApi; events: ScriptApi; error?: string }
	| { type: 'definitions'; defs: ComponentDef[]; error?: string }
	| { type: 'styles'; css: string[]; imports?: string[]; error?: string }
	| { type: 'modules'; files: { path: string; text: string }[]; error?: string }
	| LinkState
	| { type: 'tabOrder'; order: string[] }
	| { type: 'paletteFavorites'; keys: string[] }
	| { type: 'tabPosition'; position: TabPosition }
	| { type: 'linkTabs'; tabs: LinkTab[]; exts: string[]; select?: string } // select: 이 탭으로 넘어간다(방금 추가한 탭). exts: 연결할 수 있는 확장자
	| { type: 'xmlSchema'; kind: string; elements?: XmlElementSpec[]; source?: string } // 연결한 XML의 DTD 스키마(없으면 기본 MyBatis 목록)
	| ({ type: 'codeTheme' } & CodeThemeState)
	| ({ type: 'codeOptions' } & CodeOptions) // 줄바꿈(VS Code editor.wordWrap)·SQL 방언(설정)
	| { type: 'diagnostics'; target: CodeTarget; version: number; items: RemoteDiagnostic[] } // VS Code가 그 파일에 낸 문제(문제 탭과 같은 것). version: 연결 파일 버전
	| { type: 'gitBase'; target: CodeTarget; text?: string } // 변경 표시 기준(Git 스테이지 내용). 없으면 표시 안 함
	| ({ type: 'completions'; id: number } & Partial<RemoteCompletions>)
	| { type: 'completionDetails'; id: number; items: RemoteCompletionDetail[] } // 같은 요청의 앞쪽 항목을 푼 결과(늦게 옴)
	| { type: 'files'; kind: string; files: string[] } // 연결할 수 있는 파일(작업 폴더 기준 경로)
	| { type: 'linkProblem'; kind: string; message: string } // 연결하지 못한 이유(알림을 꺼 둬도 경로 입력 화면에 보인다)
	| { type: 'toast'; message: string }; // 편집기 오른쪽 아래 잠깐 뜨는 알림(VS Code 알림을 꺼 둬도 보임)

/** Design·Script·Source·연결 탭 줄 위치 */
export type TabPosition = 'top' | 'bottom';

/** VS Code 언어 확장의 자동완성(연결 탭). 위치는 0부터 줄·글자 */
export interface RemoteCompletions {
	from?: { line: number; ch: number };
	incomplete?: boolean;
	items: RemoteCompletion[];
}
export interface RemoteCompletion {
	/** 입력과 맞춰 볼 글자(filterText 또는 이름) */
	label: string;
	display?: string;
	type?: string;
	detail?: string;
	info?: string;
	/** snippet이면 VS Code 스니펫 문법 */
	insert: string;
	snippet?: boolean;
	sort?: string;
	/** 같이 넣는 편집(자동 import 등) */
	edits?: CodeChange[];
}

/** 언어 확장이 항목을 풀어야 주는 것(Java: 자동 import·설명) */
export type RemoteCompletionDetail = Pick<RemoteCompletion, 'label' | 'info' | 'edits'>;

/** VS Code 문제 하나. 위치는 0부터 줄·글자 */
export interface RemoteDiagnostic { fromLine: number; fromCh: number; toLine: number; toCh: number; severity: 'error' | 'warning' | 'info' | 'hint'; message: string; source?: string }

/** 연결 파일 상태(kind = 탭 id). path 없음 = 연결 안 됨, text 없음 = 파일을 찾지 못함 */
export interface LinkState { type: 'linked'; kind: string; path?: string; text?: string; version?: number; dirty?: boolean }

/** 자동완성용 XML 요소(lang-xml ElementSpec과 같은 모양) */
export interface XmlElementSpec { name: string; top?: boolean; children?: string[]; attributes?: ({ name: string; values?: string[] })[] }

interface ScriptInfo { text: string; note?: string }

export interface ApiParam {
	name: string;
	type: string;
	required: string;
	description: string;
}

export interface ApiReturn {
	type: string;
	description: string;
}

export interface ScriptApiMethod {
	name: string;
	signature: string;
	description: string;
	params?: ApiParam[];
	returns?: ApiReturn[];
	sample?: string;
}

export type ScriptApi = Record<string, ScriptApiMethod[]>;

// source·script는 화면 XML, link:{탭 id}는 연결 파일 전체
export type CodeTarget = 'source' | 'script' | LinkTarget;
export interface CodeChange { fromLine: number; fromCh: number; toLine: number; toCh: number; insert: string }

/** 탭 줄 톱니바퀴 메뉴 항목(확장이 정해진 VS Code 명령으로 바꿔 실행) */
export type SettingsMenuItem = 'codeTheme' | 'importCodeTheme' | 'themeColors' | 'sqlDialect' | 'setup' | 'settings';

export type ToExtension =
	| { type: 'ready' }
	| { type: 'warn'; message: string }
	| { type: 'settingsMenu'; item: SettingsMenuItem }
	// 테마 색 덮어쓰기 팝업의 확인: 지금 테마에 대한 공통·이 테마 층
	| { type: 'saveThemeCustomizations'; common?: ThemeOverlay; own?: ThemeOverlay }
	| { type: 'insertComponent'; version: number; index?: number; component: Pick<ComponentDef, 'id' | 'ns' | 'realType'>; position?: InsertPosition }
	| { type: 'setCode'; target: CodeTarget; version: number; changes: CodeChange[] }
	| { type: 'format'; target: CodeTarget; version: number }
	// more: 함께 바꿀 다른 노드(여러 개 선택)와 그 노드에 넣을 값
	// also: 같은 노드의 다른 속성도 함께(한 번에 반영해야 버전이 엇갈리지 않는다)
	| { type: 'setAttr'; version: number; index: number; name: string; value?: string; more?: { index: number; value?: string }[]; also?: { name: string; value?: string }[] }
	| { type: 'setText'; version: number; index: number; value: string }
	| { type: 'paste'; version: number; index: number; xml: string | string[] }
	| { type: 'delete'; version: number; index: number; more?: number[] }
	| { type: 'mergeCells'; version: number; index: number; more: number[] } // 고른 셀(index 포함)을 하나로 병합
	| { type: 'move'; version: number; dragged: number; target: number; position: DropPosition; more?: number[] }
	| { type: 'addData'; version: number; index: number; kind: DataKind }
	| { type: 'editDataFields'; version: number; index: number; popup: string; fields: DataField[]; id?: string }
	| { type: 'addSubmission'; version: number; index: number; popup: string; fields: SubmissionFields }
	| { type: 'editSubmission'; version: number; index: number; popup: string; fields: SubmissionFields }
	| { type: 'editChoices'; version: number; index: number; popup: string; fields: ChoicesFields }
	| { type: 'bindGrid'; version: number; index: number; list: number; mode: GridBindMode; extras: GridExtras }
	| { type: 'addGridPart'; version: number; index: number; part: GridPart | 'column' | 'columnLeft' | 'row'; at?: number }
	| { type: 'openFrame'; index: number }
	| { type: 'link'; kind: string; path?: string } // path 없으면 파일 선택 창
	| { type: 'unlink'; kind: string }
	| { type: 'openLink'; kind: string }
	| { type: 'saveLink'; kind: string }
	| { type: 'addTab' }
	| { type: 'findFiles'; kind: string } // 연결 탭 경로 입력의 파일 검색 목록
	| { type: 'complete'; target: CodeTarget; id: number; version: number; line: number; ch: number; trigger?: string }
	| { type: 'removeTab'; kind: string }
	| { type: 'renameTab'; kind: string }
	| { type: 'setTabOrder'; order: string[] }
	| { type: 'reorderPaletteFavorites'; keys: string[] }
	| { type: 'setPaletteFavorite'; component: Pick<ComponentDef, 'id' | 'ns' | 'realType'>; favorite: boolean }
	| { type: 'setTabPosition'; position: TabPosition };

interface PropertyDef { name: string; category: string; order: number; description: string; options?: string[] }
interface EventDef { name: string; signature: string; description: string }
export interface ComponentDef {
	id: string;
	ns: string;
	realType: string;
	display?: string;
	category?: string;
	hidden?: boolean;
	description?: string;
	parents: string[];
	bases: string[];
	properties: PropertyDef[];
	events: EventDef[];
}
