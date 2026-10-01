// 연결 탭 자동완성: VS Code에 설치된 언어 확장(Java 언어 서버·XML 등)의 자동완성 결과를 웹뷰 편집기 모양으로 바꾼다
import * as vscode from 'vscode';
import type { CodeChange, RemoteCompletions } from '../core/protocol';

const K = vscode.CompletionItemKind;
// CodeMirror 아이콘 종류(type)로. 없는 종류는 기본 아이콘
const TYPES = new Map<vscode.CompletionItemKind, string>([
	[K.Method, 'method'], [K.Function, 'function'], [K.Constructor, 'method'], [K.Field, 'field'], [K.Property, 'property'],
	[K.Variable, 'variable'], [K.Class, 'class'], [K.Struct, 'class'], [K.Interface, 'interface'], [K.Module, 'namespace'],
	[K.Enum, 'enum'], [K.EnumMember, 'constant'], [K.Constant, 'constant'], [K.Keyword, 'keyword'], [K.TypeParameter, 'type'],
	[K.Snippet, 'snippet'], [K.Text, 'text'], [K.Value, 'constant'], [K.Unit, 'constant'],
]);

/** 결과가 아주 많아도 웹뷰로는 이만큼만(언어 서버가 정한 순서대로) */
const MAX_ITEMS = 500;
/** 앞쪽 항목은 VS Code가 미리 풀어 둔다(설명·자동 import 같은 추가 편집) */
const RESOLVE = 20;

const toChange = (e: vscode.TextEdit): CodeChange => ({ fromLine: e.range.start.line, fromCh: e.range.start.character, toLine: e.range.end.line, toCh: e.range.end.character, insert: e.newText });
const labelOf = (item: vscode.CompletionItem) => typeof item.label === 'string' ? item.label : item.label.label;
const text = (doc: string | vscode.MarkdownString | undefined) => typeof doc === 'string' ? doc : doc?.value;

export async function remoteCompletions(document: vscode.TextDocument, line: number, ch: number, trigger?: string): Promise<RemoteCompletions | undefined> {
	const list = await vscode.commands.executeCommand<vscode.CompletionList | undefined>('vscode.executeCompletionItemProvider',
		document.uri, new vscode.Position(line, ch), trigger, RESOLVE);
	const own = document.getText();
	// VS Code 단어 자동완성(editor.wordBasedSuggestions, 종류 Text)은 같은 언어로 열린 다른 문서의 단어도 준다
	// (화면 XML의 dataList가 MyBatis 탭에 뜸). 이 파일에 있는 단어만 남긴다
	const items = list?.items.filter(item => item.kind !== K.Text || own.includes(labelOf(item))) ?? [];
	if (!list || !items.length) {
		return undefined;
	}
	const first = items[0].range, start = first && ('inserting' in first ? first.inserting : first).start;
	return {
		from: start && { line: start.line, ch: start.character },
		incomplete: list.isIncomplete,
		items: items.slice(0, MAX_ITEMS).map(item => {
			const label = labelOf(item);
			const details = typeof item.label === 'string' ? undefined : item.label;
			const insert = item.insertText ?? label;
			return {
				label: item.filterText ?? label,
				display: label + (details?.detail ?? ''),
				type: item.kind === undefined ? undefined : TYPES.get(item.kind),
				detail: details?.description ?? item.detail,
				info: text(item.documentation),
				insert: typeof insert === 'string' ? insert : insert.value,
				snippet: typeof insert !== 'string',
				sort: item.sortText,
				edits: item.additionalTextEdits?.map(toChange),
			};
		}),
	};
}
