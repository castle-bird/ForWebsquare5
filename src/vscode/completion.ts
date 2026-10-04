// 연결 탭 자동완성: VS Code에 설치된 언어 확장(Java 언어 서버·XML 등)의 자동완성 결과를 웹뷰 편집기 모양으로 바꾼다
import * as vscode from 'vscode';
import type { CodeChange, RemoteCompletions, SignatureInfo } from '../core/protocol';

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
export const RESOLVE = 20;

const toChange = (e: vscode.TextEdit): CodeChange => ({ fromLine: e.range.start.line, fromCh: e.range.start.character, toLine: e.range.end.line, toCh: e.range.end.character, insert: e.newText });
const labelOf = (item: vscode.CompletionItem) => typeof item.label === 'string' ? item.label : item.label.label;
const text = (doc: string | vscode.MarkdownString | undefined) => typeof doc === 'string' ? doc : doc?.value;

/** 마우스 올림 설명: 언어 확장들의 hover 결과를 마크다운 하나로(여럿이면 구분선) */
export async function remoteHover(document: vscode.TextDocument, line: number, ch: number): Promise<string | undefined> {
	const hovers = await vscode.commands.executeCommand<vscode.Hover[] | undefined>('vscode.executeHoverProvider', document.uri, new vscode.Position(line, ch));
	const parts = hovers?.flatMap(h => h.contents.map(c => typeof c === 'string' ? c : 'language' in c ? `\`\`\`${c.language}\n${c.value}\n\`\`\`` : c.value)).filter(t => t.trim()) ?? [];
	return parts.length ? parts.join('\n\n---\n\n') : undefined;
}

/**
 * 파라미터 힌트: 언어 확장의 Signature Help에서 지금 고른 것 하나. 파라미터 이름이 글자로 오면 label 안 자리로 바꾼다.
 * 지금 파라미터는 그 함수 것(activeParameter)이 있으면 그것, 없으면 전체 것
 */
export async function remoteSignature(document: vscode.TextDocument, line: number, ch: number, trigger?: string): Promise<SignatureInfo | undefined> {
	const help = await vscode.commands.executeCommand<vscode.SignatureHelp | undefined>('vscode.executeSignatureHelpProvider', document.uri, new vscode.Position(line, ch), trigger);
	const index = Math.min(help?.activeSignature ?? 0, (help?.signatures.length ?? 1) - 1), sig = help?.signatures[index];
	if (!sig) {
		return undefined;
	}
	let from = 0;
	const params = sig.parameters.map((p): [number, number] => {
		if (typeof p.label !== 'string') {
			return p.label;
		}
		const at = sig.label.indexOf(p.label, from);
		from = at < 0 ? from : at + p.label.length;
		return at < 0 ? [0, 0] : [at, at + p.label.length];
	});
	const active = sig.activeParameter ?? help.activeParameter;
	return {
		label: sig.label, params, index: index + 1, count: help.signatures.length,
		...active !== undefined && active < params.length && { active, paramDoc: text(sig.parameters[active].documentation) },
		doc: text(sig.documentation),
	};
}

/** 정의로 이동(Ctrl+클릭·F12): 언어 확장이 준 첫 정의 위치. 링크 형식이면 이름 자리(targetSelectionRange)로 */
export async function remoteDefinition(document: vscode.TextDocument, line: number, ch: number): Promise<{ uri: vscode.Uri; range: vscode.Range } | undefined> {
	const found = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[] | vscode.Location | undefined>('vscode.executeDefinitionProvider',
		document.uri, new vscode.Position(line, ch));
	const first = Array.isArray(found) ? found[0] : found;
	if (!first) {
		return undefined;
	}
	return 'targetUri' in first ? { uri: first.targetUri, range: first.targetSelectionRange ?? first.targetRange } : { uri: first.uri, range: first.range };
}

export async function remoteCompletions(document: vscode.TextDocument, line: number, ch: number, trigger?: string, resolve = RESOLVE): Promise<RemoteCompletions | undefined> {
	const list = await vscode.commands.executeCommand<vscode.CompletionList | undefined>('vscode.executeCompletionItemProvider',
		document.uri, new vscode.Position(line, ch), trigger, resolve);
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
