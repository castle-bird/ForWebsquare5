import type { XmlNode } from './xmlModel';
import type { DataField, DataKind } from './data';
import type { SubmissionFields } from './submission';
import type { GridBindMode, GridCellEdit, GridExtras, GridPart } from './grid';
import type { ChoicesFields } from './choices';
import type { HistoryRow } from './info';
import type { UsedTables } from './tables';
import type { Blame } from './blame';
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
	| { type: 'minimap'; on: boolean } // 코드 편집기 미니맵 켜기·끄기(모든 화면 공통)
	| { type: 'codeBlame'; on: boolean } // 코드 편집기 Git blame 켜기·끄기(모든 화면 공통)
	| { type: 'blame'; target: CodeTarget; version: number; data?: Blame } // 그 문서 버전의 줄별 blame. 없으면 표시 안 함(Git 밖 등)
	| { type: 'linkTabs'; tabs: LinkTab[]; exts: string[]; select?: string } // select: 이 탭으로 넘어간다(방금 추가한 탭). exts: 연결할 수 있는 확장자
	| { type: 'xmlSchema'; kind: string; elements?: XmlElementSpec[]; source?: string } // 연결한 XML의 DTD 스키마(없으면 기본 MyBatis 목록)
	| ({ type: 'codeTheme' } & CodeThemeState)
	| ({ type: 'codeOptions' } & CodeOptions) // 줄바꿈·합자(VS Code editor.wordWrap·fontLigatures)·SQL 방언(설정)
	| { type: 'diagnostics'; target: CodeTarget; version: number; items: RemoteDiagnostic[] } // VS Code가 그 파일에 낸 문제(문제 탭과 같은 것). version: 연결 파일 버전
	| { type: 'gitBase'; target: CodeTarget; text?: string } // 변경 표시 기준(Git 스테이지 내용). 없으면 표시 안 함
	| ({ type: 'completions'; id: number } & Partial<RemoteCompletions>)
	| { type: 'completionDetails'; id: number; items: RemoteCompletionDetail[] } // 같은 요청의 앞쪽 항목을 푼 결과(늦게 옴)
	| { type: 'signatureResult'; id: number; signature?: SignatureInfo } // 파라미터 힌트(없으면 닫음)
	| { type: 'hoverResult'; id: number; text?: string } // 연결 탭 마우스 올림 설명(언어 확장의 마크다운, 없으면 text 없음)
	| { type: 'reveal'; target: CodeTarget; line: number; ch: number; endLine?: number; endCh?: number } // 그 편집기 탭을 보이고 그 범위를 선택·스크롤(정의로 이동, 끝이 없으면 그 자리 단어)
	| { type: 'files'; kind: string; files: string[] } // 연결할 수 있는 파일(작업 폴더 기준 경로)
	| { type: 'linkProblem'; kind: string; message: string } // 연결하지 못한 이유(알림을 꺼 둬도 경로 입력 화면에 보인다)
	| { type: 'toast'; message: string } // 편집기 오른쪽 아래 잠깐 뜨는 알림(VS Code 알림을 꺼 둬도 보임)
	| { type: 'usedTables'; folder?: string; file?: string; data?: UsedTables; error?: string }; // ERD 사용 테이블. folder 없음 = 저장 폴더를 아직 안 고름

/**
 * 파라미터 힌트(VS Code Signature Help 한 개): label은 함수 모양 글자, params는 그 안 각 파라미터 자리(글자 범위),
 * active는 지금 쓰는 파라미터(없으면 undefined). doc·paramDoc은 마크다운. index/count: 겹쳐 정의된 것 중 몇 번째(1부터)
 */
export interface SignatureInfo {
	label: string;
	params: [number, number][];
	active?: number;
	doc?: string;
	paramDoc?: string;
	index: number;
	count: number;
}

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
	| { type: 'paste'; version: number; index: number; xml: string | string[]; position?: 'before' | 'after' } // position: 우클릭 붙여 넣기 > 앞·뒤
	| { type: 'delete'; version: number; index: number; more?: number[] }
	| { type: 'mergeCells'; version: number; index: number; more: number[] } // 고른 셀(index 포함)을 하나로 병합
	| { type: 'unmergeCells'; version: number; index: number; more: number[] } // 고른 셀 중 병합된 셀을 원래 칸 수로 나눔
	| { type: 'gridColumns'; version: number; index: number; cells: number[]; op: 'delete' | 'left' | 'right' } // 그리드(index)에서 칸들의 열 지우기, 또는 첫 칸의 열을 왼쪽·오른쪽으로 옮기기
	| { type: 'move'; version: number; dragged: number; target: number; position: DropPosition; more?: number[] }
	| { type: 'addData'; version: number; index: number; kind: DataKind }
	| { type: 'editDataFields'; version: number; index: number; popup: string; fields: DataField[]; id?: string }
	| { type: 'addSubmission'; version: number; index: number; popup: string; fields: SubmissionFields }
	| { type: 'editSubmission'; version: number; index: number; popup: string; fields: SubmissionFields }
	| { type: 'editChoices'; version: number; index: number; popup: string; fields: ChoicesFields }
	| { type: 'editHistory'; version: number; index: number; rows: HistoryRow[] } // head(index)의 개정 이력(Info 탭)
	| { type: 'editGridCells'; version: number; index: number; popup: string; cells: GridCellEdit[] } // 그리드(index) 칸 속성 표 팝업
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
	| { type: 'hover'; target: CodeTarget; id: number; version: number; line: number; ch: number }
	| { type: 'signature'; target: CodeTarget; id: number; version: number; line: number; ch: number; trigger?: string } // 파라미터 힌트(괄호·쉼표 입력 등)
	| { type: 'definition'; target: CodeTarget; version: number; line: number; ch: number } // 정의로 이동(Ctrl+클릭·F12)
	| { type: 'openModule'; path: string; line: number; ch: number; endLine: number; endCh: number } // Script 정의로 이동: 공통 JS(config.xml engine module 웹 경로)를 VS Code로 열고 그 범위 선택
	| { type: 'removeTab'; kind: string }
	| { type: 'renameTab'; kind: string }
	| { type: 'setTabOrder'; order: string[] }
	| { type: 'reorderPaletteFavorites'; keys: string[] }
	| { type: 'setPaletteFavorite'; component: Pick<ComponentDef, 'id' | 'ns' | 'realType'>; favorite: boolean }
	| { type: 'setTabPosition'; position: TabPosition }
	| { type: 'setMinimap'; on: boolean }
	| { type: 'setCodeBlame'; on: boolean }
	| { type: 'navigate'; back: boolean } // 마우스 뒤로·앞으로 버튼: VS Code 이동 기록(Go Back·Go Forward). 웹뷰 위에서 누른 버튼은 VS Code에 안 가서 넘겨준다
	| { type: 'loadUsedTables' }
	| { type: 'saveUsedTables'; data: UsedTables }
	| { type: 'chooseTablesFolder'; pick: boolean } // pick: 폴더 고르기 창, 아니면 기본 위치(확장 저장 폴더)
	| { type: 'saveTablesImage'; dataUrl: string }; // ERD 그림 PNG(data URL): 저장 위치를 물어 저장

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
