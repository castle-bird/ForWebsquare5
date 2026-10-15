import { java, javaLanguage } from '@codemirror/lang-java';
import { docComments } from './docComment';
import { foldEffect, foldService, getIndentUnit, indentService, LanguageSupport, syntaxTree } from '@codemirror/language';
import { styleTags, tags as t } from '@lezer/highlight';
import { countColumn, type EditorState } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';

/**
 * Enter·`}` 입력 때 들여쓰기(VS Code의 Java 규칙처럼): 윗줄(빈 줄은 건너뜀)을 따르고, 윗줄이 { ( [ 로 끝나면 한 단계 더,
 * 이 줄이 } ) ] 로 시작하면 한 단계 덜. 문법 해석 결과(모르는 문법·해석 중인 큰 파일)에 따라 들여쓰기가 튀지 않게 한다
 */
const javaIndent = indentService.of((context, pos) => {
	const unit = getIndentUnit(context.state), current = context.lineAt(pos, 1);
	let previous = current.from > 0 ? context.lineAt(current.from - 1, -1) : undefined;
	while (previous && !previous.text.trim() && previous.from > 0) {
		previous = context.lineAt(previous.from - 1, -1);
	}
	if (!previous) {
		return 0;
	}
	const code = previous.text.replace(/\/\/.*$/, '').trimEnd();
	const indent = countColumn(/^\s*/.exec(previous.text)![0], context.state.tabSize)
		+ (/[{([]$/.test(code) ? unit : 0) - (/^\s*[})\]]/.test(current.text) ? unit : 0);
	return Math.max(0, indent);
});

/**
 * import 묶음 접기(IntelliJ·VS Code처럼): 이어진 import 줄(사이 빈 줄 허용)을 `import ` 뒤부터 마지막 import 줄 끝까지 접는다.
 * 두 줄 이상일 때만, 묶음의 첫 줄에서
 */
const IMPORT = /^(\s*import\s+)\S/;
function importRange(state: EditorState, lineStart: number): { from: number; to: number } | undefined {
	const { doc } = state, first = doc.lineAt(lineStart), head = IMPORT.exec(first.text);
	if (!head) {
		return undefined;
	}
	// 앞쪽(빈 줄 건너뜀)도 import면 묶음 중간이다
	for (let n = first.number - 1; n >= 1; n--) {
		const text = doc.line(n).text;
		if (text.trim()) {
			if (IMPORT.test(text)) { return undefined; }
			break;
		}
	}
	let last = first;
	for (let n = first.number + 1; n <= doc.lines; n++) {
		const line = doc.line(n);
		if (IMPORT.test(line.text)) { last = line; } else if (line.text.trim()) { break; }
	}
	return last.number > first.number ? { from: first.from + head[1].length, to: last.to } : undefined;
}
const importFold = foldService.of((state, lineStart) => importRange(state, lineStart) ?? null);

/** 파일을 열면 첫 import 묶음은 접힌 채로(IntelliJ처럼). 편집기를 만든 직후 한 번만 */
const foldImportsOnOpen = ViewPlugin.define(view => {
	queueMicrotask(() => {
		for (let n = 1; n <= view.state.doc.lines; n++) {
			const range = importRange(view.state, view.state.doc.line(n).from);
			if (range) {
				view.dispatch({ effects: foldEffect.of(range) });
				break;
			}
		}
	});
	return {};
});

const base = java();
// @lezer/java는 어노테이션(@Override)에 색 태그가 없어 이름이 변수 색으로 칠해진다 → @와 이름을 annotation으로(테마의 어노테이션 색)
const language = javaLanguage.configure({ props: [styleTags({ 'MarkerAnnotation Annotation': t.annotation, 'MarkerAnnotation/Identifier Annotation/Identifier': t.annotation })] });
export const javaSupport = new LanguageSupport(language, [base.support, javaIndent, docComments('java'), importFold, foldImportsOnOpen]);

const KEYWORDS: Completion[] = ('abstract assert boolean break byte case catch char class continue default do double else enum extends final finally float for '
	+ 'if implements import instanceof int interface long native new package private protected public record return sealed short static super switch '
	+ 'synchronized this throw throws transient try var void volatile while yield true false null').split(' ').map(label => ({ label, type: 'keyword' }));

const NOT_CODE = new Set(['LineComment', 'BlockComment', 'StringLiteral', 'TextBlock', 'CharacterLiteral']);

const DEFINES: Record<string, string> = {
	ClassDeclaration: 'class', RecordDeclaration: 'class', InterfaceDeclaration: 'interface', AnnotationTypeDeclaration: 'interface', EnumDeclaration: 'enum',
	MethodDeclaration: 'method', ConstructorDeclaration: 'method', EnumConstant: 'constant',
};

const MEMBER_TYPES = new Set(['method', 'field', 'constant']);

/** Java 키워드 + 이 파일 안의 이름(선언한 클래스·메서드·필드·변수, 쓰인 타입·import·어노테이션). 점 뒤에서는 이 파일의 메서드·필드·호출한 메서드 */
export function javaCompletions(context: CompletionContext): CompletionResult | null {
	const word = context.matchBefore(/[\w$]*/)!;
	const member = context.state.sliceDoc(word.from - 1, word.from) === '.';
	if (NOT_CODE.has(syntaxTree(context.state).resolveInner(context.pos, -1).name) || (word.from === word.to && !member && !context.explicit)) {
		return null;
	}
	const options = new Map<string, Completion>();
	const add = (label: string, type: string) => {
		if (label && (!member || MEMBER_TYPES.has(type)) && !options.has(label)) {
			options.set(label, { label, type });
		}
	};
	syntaxTree(context.state).iterate({
		enter: n => {
			if (n.from === word.from && n.to === word.to) {
				return;
			}
			const text = context.state.sliceDoc(n.from, n.to), parent = n.node.parent;
			if (n.name === 'Definition') {
				add(text, DEFINES[parent?.name ?? ''] ?? (parent?.name === 'VariableDeclarator' && parent.parent?.name === 'FieldDeclaration' ? 'field' : 'variable'));
			} else if (n.name === 'TypeName') {
				add(text, 'class');
			} else if (n.name === 'Identifier' && /Annotation$/.test(parent?.name ?? '')) {
				add(text, 'class');
			} else if (n.name === 'Identifier' && parent?.name === 'MethodName') {
				add(text, 'method');
			} else if (n.name === 'ImportDeclaration') {
				add(/([\w$]+)\s*;?\s*$/.exec(text)?.[1] ?? '', 'class');
				return false;
			}
		},
	});
	return { from: word.from, options: [...member ? [] : KEYWORDS, ...options.values()], validFor: /^[\w$]*$/ };
}
