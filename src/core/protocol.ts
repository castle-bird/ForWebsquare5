import type { XmlNode } from './xmlModel';
import type { DataField, DataKind } from './data';
import type { SubmissionFields } from './submission';
import type { GridBindMode, GridExtras, GridPart } from './grid';
import type { ChoicesFields } from './choices';
import type { DropPosition } from './paste';
import type { LinkTab, LinkTarget } from './links';
import type { CodeThemeId } from './codeTheme';
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
	| { type: 'linkTabs'; tabs: LinkTab[]; exts: string[]; select?: string } // select: 이 탭으로 넘어간다(방금 추가한 탭). exts: 연결할 수 있는 확장자
	| { type: 'xmlSchema'; kind: string; elements?: XmlElementSpec[]; source?: string } // 연결한 XML의 DTD 스키마(없으면 기본 MyBatis 목록)
	| { type: 'codeTheme'; theme: CodeThemeId }
	| ({ type: 'codeOptions' } & CodeOptions) // 줄바꿈(VS Code editor.wordWrap)·SQL 방언(설정)
	| { type: 'gitBase'; target: CodeTarget; text?: string } // 변경 표시 기준(Git 스테이지 내용). 없으면 표시 안 함
	| ({ type: 'completions'; id: number } & Partial<RemoteCompletions>)
	| { type: 'files'; kind: string; files: string[] }; // 연결할 수 있는 파일(작업 폴더 기준 경로)

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

/** 연결 파일 상태(kind = 탭 id). path 없음 = 연결 안 됨, text 없음 = 파일을 찾지 못함 */
export interface LinkState { type: 'linked'; kind: string; path?: string; text?: string; version?: number; dirty?: boolean }

/** 자동완성용 XML 요소(lang-xml ElementSpec과 같은 모양) */
export interface XmlElementSpec { name: string; top?: boolean; children?: string[]; attributes?: ({ name: string; values?: string[] })[] }

export interface ScriptInfo { text: string; note?: string }

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

export type ToExtension =
	| { type: 'ready' }
	| { type: 'warn'; message: string }
	| { type: 'selection'; version: number; index?: number }
	| { type: 'setCode'; target: CodeTarget; version: number; changes: CodeChange[] }
	| { type: 'format'; target: CodeTarget; version: number }
	// more: 함께 바꿀 다른 노드(여러 개 선택)와 그 노드에 넣을 값
	| { type: 'setAttr'; version: number; index: number; name: string; value?: string; more?: { index: number; value?: string }[] }
	| { type: 'setText'; version: number; index: number; value: string }
	| { type: 'paste'; version: number; index: number; xml: string | string[] }
	| { type: 'delete'; version: number; index: number; more?: number[] }
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
	| { type: 'setTabOrder'; order: string[] };

export interface PropertyDef { name: string; category: string; order: number; description: string; options?: string[] }
export interface EventDef { name: string; signature: string; description: string }
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
