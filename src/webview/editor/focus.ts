import type { EditorView } from '@codemirror/view';
import type { EditorSelection, Text } from '@codemirror/state';

/**
 * VS Code가 웹뷰를 숨겼다 다시 보이거나(다른 편집기 탭) 다른 창에서 돌아오면, 포커스가 body로 가거나 커서가 엉뚱한 자리로 바뀐 채
 * 첫 키(Space 등)가 들어와 그 자리로 스크롤이 튈 수 있다. 떠날 때의 커서·스크롤·포커스를 기억했다가
 * 돌아온 뒤 클릭 없이 누른 첫 키 전에 되돌린다(클릭했으면 그 자리가 맞다). 보이는 편집기만.
 * 한 번 클릭으로 포커스가 안 들어온 경우도 여기서 넣는다
 */
export function restoreOnReturn(editor: EditorView): () => void {
	/** focused: 떠날 때 포커스가 있던 편집기 안 요소(본문 또는 Ctrl+F 검색창 입력칸) */
	let saved: { doc: Text; selection: EditorSelection; top: number; focused?: HTMLElement; wheeled?: boolean } | undefined;
	/** 포커스가 아무 데도 없음(검색창 등 다른 입력칸이 아님) */
	const nowhere = () => !document.activeElement || document.activeElement === document.body;
	const leave = () => {
		if (editor.dom.offsetParent) {
			const active = document.activeElement;
			const focused = active instanceof HTMLElement && editor.dom.contains(active) ? active : undefined;
			saved = { doc: editor.state.doc, selection: editor.state.selection, top: editor.scrollDOM.scrollTop, focused };
		}
	};
	// 검색창에 포커스를 둔 채 다른 창에서 복사해 오면 돌아와서 바로 붙여 넣을 수 있게 검색창으로 되돌린다(그사이 검색창을 닫았으면 그대로)
	const back = () => {
		const focused = saved?.focused;
		if (focused?.isConnected && editor.dom.offsetParent && nowhere()) {
			if (focused === editor.contentDOM) {
				editor.focus();
			} else {
				focused.focus();
			}
		}
	};
	const onVisibility = () => document.visibilityState === 'hidden' ? leave() : back();
	// 돌아와서 한 번 클릭했는데 포커스가 편집기에 안 들어갔으면(웹뷰 문서가 포커스를 못 받아 CodeMirror의 focus()가 무시됨 → body에 남음)
	// 클릭이 끝난 뒤 넣는다. 안 그러면 Space는 클릭한 곳의 스크롤 영역을 한 화면 내리고(입력 없이) Ctrl+F도 안 먹어 두 번 클릭해야 했다.
	// 검색창 등 다른 입력칸에 포커스가 갔으면 그대로 둔다
	const onPointer = (e: PointerEvent) => {
		saved = undefined;
		if (!editor.dom.contains(e.target as Node)) {
			return;
		}
		window.addEventListener('pointerup', () => {
			// 눌러 끄는 사이 blur(웹뷰가 포커스를 넘겨받는 중)가 오면 그때 커서(드래그 시작점)가 저장된다.
			// 끌기가 끝난 뒤 첫 키(Ctrl 등)가 그 커서로 되돌려 선택이 풀리므로, 클릭·끌기가 끝나면 버린다
			saved = undefined;
			requestAnimationFrame(() => {
				if (!editor.hasFocus && nowhere() && editor.dom.offsetParent) {
					window.focus();
					editor.focus();
				}
			});
		}, { once: true, capture: true, signal });
	};
	const onKey = () => {
		const s = saved;
		saved = undefined;
		if (!s || !editor.hasFocus) {
			return;
		}
		// 그사이 문서가 바뀌었으면(Design·VS Code 편집) 옛 커서 자리는 믿지 않는다
		if (s.doc === editor.state.doc && !editor.state.selection.eq(s.selection)) {
			editor.dispatch({ selection: s.selection });
		}
		if (!s.wheeled && editor.scrollDOM.scrollTop !== s.top) {
			editor.scrollDOM.scrollTop = s.top;
		}
	};
	// 돌아와서 휠로 스크롤했으면 그 스크롤이 맞다(첫 키에 떠날 때 자리로 되돌리지 않음). 커서는 그대로 되돌린다
	const onWheel = () => { if (saved) { saved.wheeled = true; } };
	const stop = new AbortController(), { signal } = stop;
	window.addEventListener('blur', leave, { signal });
	window.addEventListener('focus', back, { signal });
	document.addEventListener('visibilitychange', onVisibility, { signal });
	window.addEventListener('pointerdown', onPointer, { capture: true, signal });
	window.addEventListener('keydown', onKey, { capture: true, signal });
	window.addEventListener('wheel', onWheel, { capture: true, passive: true, signal });
	return () => stop.abort();
}
