// 문서 주석(JS·Java): `/**` 뒤 Enter → 아래 함수의 매개변수로 @param·@return 틀, 주석 안 Enter → 다음 줄에 `* `.
// 주석 안에서는 자동완성을 띄우지 않는다
import { syntaxTree } from '@codemirror/language';
import { Prec, type EditorState } from '@codemirror/state';
import { keymap, type Command } from '@codemirror/view';
import type { CompletionSource } from '@codemirror/autocomplete';

type Lang = 'java' | 'js';

const JAVA_MODIFIERS = new Set(['public', 'protected', 'private', 'static', 'final', 'abstract', 'synchronized', 'native', 'default', 'strictfp']);

/** a<b, c>, d 처럼 괄호·꺾쇠 안 쉼표는 나누지 않는다 */
function splitTop(text: string): string[] {
	const parts: string[] = [];
	let depth = 0, start = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if ('<([{'.includes(c)) {
			depth++;
		} else if ('>)]}'.includes(c)) {
			depth--;
		} else if (c === ',' && depth === 0) {
			parts.push(text.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(text.slice(start));
	return parts.map(p => p.trim()).filter(Boolean);
}

/** 주석 아래 선언(다음 `{`·`;`까지)에서 @param·@return 줄. 함수가 아니면 없음 */
export function docTags(after: string, lang: Lang): string[] {
	// 어노테이션(@RequestMapping("/a"))의 괄호를 함수 괄호로 읽지 않게 지운다
	const head = after.replace(/@[\w.]+(\s*\((?:[^()]|\([^()]*\))*\))?/g, ' ');
	// 괄호 밖의 `{`·`;`까지(매개변수 안 구조 분해 `{ id }`에서 자르지 않게)
	let end = 0;
	for (let depth = 0; end < head.length && (depth > 0 || !'{;'.includes(head[end])); end++) {
		depth += head[end] === '(' ? 1 : head[end] === ')' ? -1 : 0;
	}
	const declaration = head.slice(0, end);
	const m = /([\w$]+)\s*\(((?:[^()]|\([^()]*\))*)\)/.exec(declaration);
	if (!m) {
		return [];
	}
	const params = splitTop(m[2]).map(p => lang === 'java'
		? /([\w$]+)\s*(?:\[\s*\])*$/.exec(p)?.[1]
		: /^(?:\.\.\.)?([\w$]+)/.exec(p)?.[1]).filter((p): p is string => !!p);
	const tags = params.map(p => `@param ${p}`);
	if (lang === 'java') {
		// 이름 앞 낱말 중 수식어가 아닌 것이 반환 타입(없으면 생성자)
		const type = declaration.slice(0, m.index).replace(/<[^<>]*>/g, ' ').split(/\s+/).filter(w => w && !JAVA_MODIFIERS.has(w)).at(-1);
		if (type && type !== 'void' && !/^(new|return|if|for|while|switch|catch)$/.test(m[1])) {
			tags.push('@return');
		}
	}
	return tags;
}

const COMMENT = /Comment/;

/** pos가 주석(블록·줄) 안인지 */
export function inComment(state: EditorState, pos: number): boolean {
	const node = syntaxTree(state).resolveInner(pos, -1);
	return COMMENT.test(node.name) && pos > node.from;
}

/** 주석 안이면 자동완성 없음 */
export const notInComment = (source: CompletionSource): CompletionSource => context =>
	inComment(context.state, context.pos) ? null : source(context);

const enter = (lang: Lang): Command => view => {
	const { state } = view, sel = state.selection.main;
	if (!sel.empty || state.readOnly) {
		return false;
	}
	const line = state.doc.lineAt(sel.head), before = line.text.slice(0, sel.head - line.from), after = line.text.slice(sel.head - line.from);
	const indent = /^\s*/.exec(line.text)![0];
	const next = line.number < state.doc.lines ? state.doc.line(line.number + 1).text.trim() : '';
	const insert = (text: string, cursor: number) => {
		view.dispatch({ changes: { from: sel.head, to: sel.head + (after.length - after.trimStart().length), insert: text }, selection: { anchor: sel.head + cursor }, scrollIntoView: true, userEvent: 'input' });
		return true;
	};
	// 새 문서 주석: `/**`로 끝나고 뒤가 비었으며 아래 줄이 이미 주석(`*`)이 아님
	if (/\/\*\*\s*$/.test(before) && (!after.trim() || after.trim() === '*/') && !next.startsWith('*')) {
		const lead = `\n${indent} * `;
		const body = [lead, ...docTags(state.sliceDoc(line.to, line.to + 2000), lang).map(t => `\n${indent} * ${t}`), `\n${indent} */`].join('');
		view.dispatch({ changes: { from: sel.head, to: line.to, insert: body }, selection: { anchor: sel.head + lead.length }, scrollIntoView: true, userEvent: 'input' });
		return true;
	}
	// 블록 주석 안 줄(`/**`·`*`로 시작): 다음 줄도 `* `
	const node = syntaxTree(state).resolveInner(sel.head, -1);
	const trimmed = line.text.trimStart();
	if (node.name === 'BlockComment' && sel.head > node.from + 1 && (sel.head < node.to - 1 || !state.sliceDoc(node.to - 2, node.to).endsWith('*/'))
		&& (trimmed.startsWith('*') || trimmed.startsWith('/*')) && !trimmed.startsWith('*/')) {
		const star = trimmed.startsWith('/*') ? `${indent} * ` : `${indent}* `;
		return insert(`\n${star}`, star.length + 1);
	}
	return false;
};

/** 언어 지원에 넣는 문서 주석 키(Enter) */
export const docComments = (lang: Lang) => Prec.high(keymap.of([{ key: 'Enter', run: enter(lang) }]));
