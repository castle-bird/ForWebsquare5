// XML·HTML 편집기(Source·MyBatis·연결한 HTML) 공통: lang-xml·lang-html의 태그 자동 닫기 + 이미 붙은 닫는 태그 건너뛰기
import { xml } from '@codemirror/lang-xml';
import { ensureSyntaxTree, LanguageSupport, syntaxTree } from '@codemirror/language';
import { Prec, type EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

/** pos를 내용으로 감싼 가장 안쪽 요소(시작 태그가 pos 앞에서 끝나고 아직 닫히지 않음). lezer-xml·lezer-html 모두 Element·OpenTag·CloseTag */
function openElementAt(state: EditorState, pos: number): SyntaxNode | undefined {
	const tree = ensureSyntaxTree(state, pos, 50) ?? syntaxTree(state);
	for (let n: SyntaxNode | null = tree.resolveInner(pos, -1); n; n = n.parent) {
		const open = n.firstChild, close = n.lastChild;
		if (n.name === 'Element' && open?.name === 'OpenTag' && open.to <= pos && !(close?.name === 'CloseTag' && close.to <= pos)) {
			return n;
		}
	}
	return undefined;
}

/**
 * `</` 입력: `>`를 칠 때 닫는 태그가 이미 붙어 있으면(`<update>|</update>`) 자동 닫기는 닫혔다고 보고 아무것도 안 해 `</</update>`가 된다.
 * 커서를 감싼 요소의 닫는 태그가 바로 뒤에 있으면 새로 만들지 않고 친 `<`를 지운 뒤 그 태그 뒤로 간다(VS Code가 닫는 괄호를 건너뛰듯).
 * 바로 뒤가 바깥 요소의 닫는 태그면(`<if><where>a|</if>`) 그대로 둬서 자동 닫기가 안쪽 요소를 닫는다
 */
export const skipExistingCloseTag = Prec.high(EditorView.inputHandler.of((view, from, to, text) => {
	const { state } = view;
	if (text !== '/' || from !== to || view.composing || state.readOnly || state.sliceDoc(from - 1, from) !== '<') {
		return false;
	}
	// 방금 친 `<`가 없던 모양으로 읽는다
	const pos = from - 1, before = state.update({ changes: { from: pos, to: from } }).state;
	const close = openElementAt(before, pos)?.lastChild;
	if (close?.name !== 'CloseTag' || close.from !== pos) {
		return false;
	}
	view.dispatch({ changes: { from: pos, to: from }, selection: { anchor: close.to }, userEvent: 'input.type' });
	return true;
}));

export function xmlSupport(): LanguageSupport {
	const base = xml();
	return new LanguageSupport(base.language, [base.support, skipExistingCloseTag]);
}
