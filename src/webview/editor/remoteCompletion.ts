// 연결 탭 자동완성: 확장에 물어 VS Code에 설치된 언어 확장(Java 언어 서버·XML 등)의 결과를 쓴다. 결과가 없으면(확장 없음·준비 중·버전 다름) 기본 자동완성
import { snippet, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import type { CodeChange, CodeTarget, RemoteCompletion, ToExtension, ToWebview } from '../../core/protocol';

type Reply = Extract<ToWebview, { type: 'completions' }>;

const pending = new Map<number, (reply: Reply | undefined) => void>();
let nextId = 0;
window.addEventListener('message', ({ data }: MessageEvent<ToWebview>) => {
	if (data?.type === 'completions') {
		pending.get(data.id)?.(data);
	}
});

/** 언어 서버 첫 응답(시작 직후)은 느릴 수 있다 */
const TIMEOUT = 5000;
/** 언어 서버가 '.'·'<'·'@' 뒤에서 여는 자동완성(trigger character) */
const TRIGGERS = ['.', '<', '@'];

/**
 * VS Code 스니펫 → CodeMirror 스니펫. 둘 다 `${1:이름}`·`${0}`(마지막 자리)을 쓰고, 다른 점만 바꾼다:
 * `$1` → `${1}`, 선택지 `${1|a,b|}` → 첫 값, VS Code 이스케이프(`\$`·`\\`), CodeMirror가 자리로 읽는 `#{`
 */
export const toSnippet = (vs: string) => vs.replace(/\\([$}\\])|\$\{(\d+)\|([^,|}]*)[^}]*\|\}|\$(\d+)|#\{/g,
	(_m, escaped?: string, choice?: string, first?: string, tabstop?: string) =>
		escaped ? (escaped === '}' ? '\\}' : escaped) : choice ? `\${${choice}:${first}}` : tabstop ? `\${${tabstop}}` : '#\\{');

const at = (view: EditorView, line: number, ch: number) => {
	const l = view.state.doc.line(Math.min(line + 1, view.state.doc.lines));
	return Math.min(l.from + ch, l.to);
};

/** 같이 넣는 편집(자동 import 등). 보통 위쪽 줄이라 본문을 넣은 뒤 줄·글자 위치로 다시 찾는다 */
const extraEdits = (view: EditorView, edits: CodeChange[] | undefined) => edits?.length && view.dispatch({
	changes: edits.map(e => ({ from: at(view, e.fromLine, e.fromCh), to: at(view, e.toLine, e.toCh), insert: e.insert })),
});

function toCompletion(item: RemoteCompletion, rank: number): Completion {
	const apply = item.snippet ? snippet(toSnippet(item.insert)) : undefined;
	return {
		label: item.label,
		displayLabel: item.display,
		type: item.type,
		detail: item.detail,
		info: item.info,
		// 언어 서버가 정한 순서(sortText)를 지킨다
		boost: -rank / 1000,
		apply: (view, completion, from, to) => {
			if (apply) {
				apply(view, completion, from, to);
			} else {
				view.dispatch({ changes: { from, to, insert: item.insert }, selection: { anchor: from + item.insert.length }, userEvent: 'input.complete' });
			}
			extraEdits(view, item.edits);
		},
	};
}

function request(post: (msg: ToExtension) => void, msg: Omit<Extract<ToExtension, { type: 'complete' }>, 'type' | 'id'>, context: CompletionContext): Promise<Reply | undefined> {
	const id = ++nextId;
	return new Promise(resolve => {
		const done = (reply: Reply | undefined) => {
			pending.delete(id);
			clearTimeout(timer);
			resolve(reply);
		};
		const timer = setTimeout(() => done(undefined), TIMEOUT);
		pending.set(id, done);
		context.addEventListener('abort', () => done(undefined));
		post({ type: 'complete', id, ...msg });
	});
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
		const reply = await request(post, { target, version, line: line.number - 1, ch: context.pos - line.from, trigger: word.from === word.to ? trigger : undefined }, context);
		if (!reply?.items?.length) {
			return context.aborted ? null : fallback(context);
		}
		// 바꿀 범위 시작은 언어 서버가 준 곳(같은 줄, 커서 앞일 때만)
		const given = reply.from && reply.from.line === line.number - 1 ? line.from + reply.from.ch : undefined;
		const from = given !== undefined && given <= context.pos ? given : word.from;
		const sorted = [...reply.items].sort((a, b) => (a.sort ?? a.label).localeCompare(b.sort ?? b.label));
		const result: CompletionResult = { from, options: sorted.map(toCompletion) };
		// 결과가 완전하면 이어 치는 동안 다시 묻지 않고 걸러 쓴다
		return reply.incomplete ? result : { ...result, validFor: /^[\w$]*$/ };
	};
}
