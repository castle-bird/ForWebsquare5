// 연결 탭 자동완성: 확장에 물어 VS Code에 설치된 언어 확장(Java 언어 서버·XML 등)의 결과를 쓴다. 결과가 없으면(확장 없음·준비 중·버전 다름) 기본 자동완성
import { snippet, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { highlightingFor, language } from '@codemirror/language';
import { highlightTree } from '@lezer/highlight';
import type { CodeChange, CodeTarget, RemoteCompletion, RemoteCompletionDetail, SignatureInfo, ToExtension, ToWebview } from '../../core/protocol';
import { posAt } from './lint';
import { renderMarkdown } from './markdown';
import { colorDoc } from './themes';
import type { DocRenderer, SignatureSource } from './signatureHelp';

type Reply = Extract<ToWebview, { type: 'completions' }>;
type Details = Promise<RemoteCompletionDetail[] | undefined>;

const pending = new Map<number, (reply: Reply | undefined) => void>();
const pendingDetails = new Map<number, (items: RemoteCompletionDetail[] | undefined) => void>();
const pendingHovers = new Map<number, (text: string | undefined) => void>();
const pendingSignatures = new Map<number, (signature: SignatureInfo | undefined) => void>();
let nextId = 0;
window.addEventListener('message', ({ data }: MessageEvent<ToWebview>) => {
	if (data?.type === 'completions') {
		pending.get(data.id)?.(data);
	} else if (data?.type === 'completionDetails') {
		pendingDetails.get(data.id)?.(data.items);
	} else if (data?.type === 'hoverResult') {
		pendingHovers.get(data.id)?.(data.text);
	} else if (data?.type === 'signatureResult') {
		pendingSignatures.get(data.id)?.(data.signature);
	}
});

/** 연결 탭 마우스 올림 설명: VS Code 언어 확장(Java 언어 서버의 Javadoc 등). 확장 문서와 내용이 같을 때(synced)만 묻는다 */
export function remoteHover(target: CodeTarget, post: (msg: ToExtension) => void, synced: () => number | undefined) {
	return async (view: EditorView, pos: number) => {
		const version = synced();
		const word = view.state.wordAt(pos);
		if (version === undefined || !word) { return null; }
		const line = view.state.doc.lineAt(pos), id = ++nextId;
		const text = await new Promise<string | undefined>(resolve => {
			const done = (t: string | undefined) => { pendingHovers.delete(id); clearTimeout(timer); resolve(t); };
			const timer = setTimeout(() => done(undefined), TIMEOUT);
			pendingHovers.set(id, done);
			post({ type: 'hover', target, id, version, line: line.number - 1, ch: pos - line.from });
		});
		if (!text) { return null; }
		const dom = colorDoc(renderMarkdown(text, codeHighlighter(view.state)), view.state);
		dom.classList.add('ws-hover');
		return { pos: word.from, end: word.to, above: true, create: () => ({ dom }) };
	};
}

/**
 * 연결 탭 파라미터 힌트: VS Code 언어 확장의 Signature Help. 방금 입력한 편집이 확장 문서에 반영된 뒤(whenSynced) 묻는다
 */
export function remoteSignature(target: CodeTarget, post: (msg: ToExtension) => void, whenSynced: () => Promise<number | undefined>): SignatureSource {
	return async (view, pos, trigger) => {
		const version = await whenSynced();
		if (version === undefined) { return undefined; }
		const line = view.state.doc.lineAt(pos), id = ++nextId;
		return new Promise<SignatureInfo | undefined>(resolve => {
			const done = (s: SignatureInfo | undefined) => { pendingSignatures.delete(id); clearTimeout(timer); resolve(s); };
			const timer = setTimeout(() => done(undefined), TIMEOUT);
			pendingSignatures.set(id, done);
			post({ type: 'signature', target, id, version, line: line.number - 1, ch: pos - line.from, trigger });
		});
	};
}

/** 언어 확장 설명(마크다운): 코드 블록·라벨에 편집기 언어·테마 색 */
export const markdownDoc: DocRenderer = (view, text) => colorDoc(renderMarkdown(text, codeHighlighter(view.state)), view.state);

/** 언어 서버 첫 응답(시작 직후)은 느릴 수 있다 */
const TIMEOUT = 5000;
/** 항목을 푼 결과는 목록보다 늦다(Java 1초쯤). 고른 뒤 이만큼까지 기다려 자동 import를 넣는다 */
const DETAILS_TIMEOUT = 15000;
/** 언어 서버가 '.'·'<'·'@' 뒤에서 여는 자동완성(trigger character) */
const TRIGGERS = ['.', '<', '@'];

/**
 * VS Code 스니펫 → CodeMirror 스니펫. 둘 다 `${1:이름}`·`${0}`(마지막 자리)을 쓰고, 다른 점만 바꾼다:
 * `$1` → `${1}`, 선택지 `${1|a,b|}` → 첫 값, VS Code 이스케이프(`\$`·`\\`), CodeMirror가 자리로 읽는 `#{`
 */
export const toSnippet = (vs: string) => vs.replace(/\\([$}\\])|\$\{(\d+)\|([^,|}]*)[^}]*\|\}|\$(\d+)|#\{/g,
	(_m, escaped?: string, choice?: string, first?: string, tabstop?: string) =>
		escaped ? (escaped === '}' ? '\\}' : escaped) : choice ? `\${${choice}:${first}}` : tabstop ? `\${${tabstop}}` : '#\\{');

const at = (view: EditorView, line: number, ch: number) => posAt(view.state.doc, line, ch);

/** 설명의 코드 블록(시그니처 등)에 편집기와 같은 언어·테마 색: 편집기 언어로 읽고 지금 테마의 강조 class를 붙인다 */
const codeHighlighter = (state: EditorState) => (text: string): Node => {
	const lang = state.facet(language), out = document.createDocumentFragment();
	if (!lang) { return document.createTextNode(text); }
	let at = 0;
	highlightTree(lang.parser.parse(text), { style: tags => highlightingFor(state, tags) }, (from, to, cls) => {
		out.append(text.slice(at, from), Object.assign(document.createElement('span'), { className: cls, textContent: text.slice(from, to) }));
		at = to;
	});
	out.append(text.slice(at));
	return out;
};

/** 같이 넣는 편집(자동 import 등). 보통 위쪽 줄이라 본문을 넣은 뒤 줄·글자 위치로 다시 찾는다 */
const extraEdits = (view: EditorView, edits: CodeChange[] | undefined) => edits?.length && view.dispatch({
	changes: edits.map(e => ({ from: at(view, e.fromLine, e.fromCh), to: at(view, e.toLine, e.toCh), insert: e.insert })),
});

/** detail: 이 항목을 푼 결과(늦게 옴). 자동 import는 고른 뒤 오면 그때 넣고, 설명은 펼칠 때 기다린다 */
function toCompletion(item: RemoteCompletion, rank: number, detail: Promise<RemoteCompletionDetail | undefined>, state: EditorState): Completion {
	const md = (text: string) => colorDoc(renderMarkdown(text, codeHighlighter(state)), state);
	// 자리(`$1`·`${…}`) 없는 스니펫(Java `getHour()` 등)은 글자로 넣는다: CodeMirror snippet은 자리가 없으면 커서를 안 옮겨 '.' 뒤에 남는다
	const fields = item.snippet && /(^|[^\\])\$(\d|\{)/.test(item.insert);
	const apply = fields ? snippet(toSnippet(item.insert)) : undefined;
	const text = item.snippet ? item.insert.replace(/\\([$}\\])/g, '$1') : item.insert;
	return {
		label: item.label,
		displayLabel: item.display,
		type: item.type,
		detail: item.detail,
		// 언어 서버 설명은 마크다운(VS Code MarkdownString)
		info: item.info !== undefined ? () => md(item.info!) : () => detail.then(d => d?.info ? md(d.info) : null),
		// 언어 서버가 정한 순서(sortText)를 지킨다
		boost: -rank / 1000,
		apply: (view, completion, from, to) => {
			if (apply) {
				apply(view, completion, from, to);
			} else {
				view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input.complete' });
			}
			if (item.edits) {
				extraEdits(view, item.edits);
			} else {
				void detail.then(d => extraEdits(view, d?.edits));
			}
		},
	};
}

function request(post: (msg: ToExtension) => void, msg: Omit<Extract<ToExtension, { type: 'complete' }>, 'type' | 'id'>, context: CompletionContext): [Promise<Reply | undefined>, Details] {
	const id = ++nextId;
	const details: Details = new Promise(resolve => {
		const done = (items: RemoteCompletionDetail[] | undefined) => {
			pendingDetails.delete(id);
			clearTimeout(timer);
			resolve(items);
		};
		const timer = setTimeout(() => done(undefined), DETAILS_TIMEOUT);
		pendingDetails.set(id, done);
	});
	return [new Promise(resolve => {
		const done = (reply: Reply | undefined) => {
			pending.delete(id);
			clearTimeout(timer);
			resolve(reply);
		};
		const timer = setTimeout(() => done(undefined), TIMEOUT);
		pending.set(id, done);
		context.addEventListener('abort', () => done(undefined));
		post({ type: 'complete', id, ...msg });
	}), details];
}

/**
 * synced: 보낸 편집이 모두 반영됐을 때 그 버전(아니면 undefined). 확장 문서와 웹뷰 내용이 같을 때만 물어야 위치가 맞다
 */
export function remoteCompletion(target: CodeTarget, post: (msg: ToExtension) => void, synced: (context: CompletionContext) => Promise<number | undefined>,
	fallback: CompletionSource): CompletionSource {
	return async context => {
		const word = context.matchBefore(/[\w$]*/)!, before = context.state.sliceDoc(word.from - 1, word.from);
		const trigger = TRIGGERS.includes(before) ? before : undefined;
		if (word.from === word.to && !trigger && !context.explicit) {
			return fallback(context);
		}
		const version = await synced(context);
		if (version === undefined || context.aborted) {
			return context.aborted ? null : fallback(context);
		}
		const line = context.state.doc.lineAt(context.pos);
		const [replied, details] = request(post, { target, version, line: line.number - 1, ch: context.pos - line.from, trigger: word.from === word.to ? trigger : undefined }, context);
		const reply = await replied;
		if (!reply?.items?.length) {
			return context.aborted ? null : fallback(context);
		}
		// 바꿀 범위 시작은 언어 서버가 준 곳(같은 줄, 커서 앞일 때만)
		const given = reply.from && reply.from.line === line.number - 1 ? line.from + reply.from.ch : undefined;
		const from = given !== undefined && given <= context.pos ? given : word.from;
		// 푼 결과는 확장이 준 순서(앞쪽 몇 개)라 정렬 전 자리로 찾는다
		const detailOf = (i: number, label: string) => details.then(list => list?.[i]?.label === label ? list[i] : undefined);
		const sorted = reply.items.map((item, i) => ({ item, detail: detailOf(i, item.label) }))
			.sort((a, b) => (a.item.sort ?? a.item.label).localeCompare(b.item.sort ?? b.item.label));
		const result: CompletionResult = { from, options: sorted.map(({ item, detail }, rank) => toCompletion(item, rank, detail, context.state)) };
		// 결과가 완전하면 이어 치는 동안 다시 묻지 않고 걸러 쓴다
		return reply.incomplete ? result : { ...result, validFor: /^[\w$]*$/ };
	};
}
