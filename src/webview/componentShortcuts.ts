import { useEffect } from 'react';
import { lastPressedIn } from './keys';
import { useEditorStore } from './store';

export function useComponentShortcuts() {
	useEffect(() => {
		// 캔버스에 그린 컴포넌트 안의 input·select(미리보기 모양)는 클릭하면 포커스를 가져가지만 실제 입력칸이 아니다 → 제외.
		// 이걸 입력칸으로 보면 input류 컴포넌트를 고른 뒤 Delete·복붙이 간헐적으로 안 먹는다
		const inEditable = (e: Event) => {
			const el = e.composedPath()[0] as HTMLElement;
			// 팝업 안에 포커스가 있으면 이벤트가 body로 와도(VS Code 복사·붙여넣기는 글자 선택이 없으면 body로 보낸다) 팝업 것
			// ERD 탭(사용 테이블 그림)이 보이면 Design 단축키는 쉰다: 그림의 Delete·복붙은 그림 것(포커스가 body여도). 숨은 ERD는 상관없음
			return !!el.closest?.('input, textarea, select, dialog, [contenteditable], .code-editor, .used-tables') && !el.closest('[data-wse]') || !!document.activeElement?.closest('dialog')
				|| !!document.querySelector('.used-tables')?.getClientRects().length;
		};
		const onClip = (e: ClipboardEvent) => {
			if (inEditable(e) || String(window.getSelection() ?? '')) {
				return;
			}
			const { copy, cut, paste } = useEditorStore.getState();
			const done = e.type === 'copy' ? copy(e.clipboardData) : e.type === 'cut' ? cut(e.clipboardData) : paste(e.clipboardData);
			if (done) {
				e.preventDefault();
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Delete' && !inEditable(e) && useEditorStore.getState().del()) {
				e.preventDefault();
			}
			// F2(이클립스처럼): 화면에서 컴포넌트를 고른 뒤면 부모 컴포넌트로. Outline에서 고른 뒤의 F2는 id 바꾸기(tree.tsx)
			if (e.key === 'F2' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !inEditable(e) && lastPressedIn('.canvas-host') && useEditorStore.getState().selectParent()) {
				e.preventDefault();
			}
			// 포커스가 아무 데도 없을 때(VS Code가 웹뷰로 돌아오며 body에 둔 경우) Space·PageUp/Down으로 브라우저가 스크롤하지 않게
			if (e.target === document.body && [' ', 'PageDown', 'PageUp'].includes(e.key) && !e.defaultPrevented) {
				e.preventDefault();
			}
		};
		// 캡처 단계에서 본다: 코드 편집기는 cut을 처리하며 잘린 줄 DOM을 다시 그려, 버블 단계에선 이벤트 대상이 문서에서 떨어져
		// 편집기 안인지 못 알아본다(→ 고른 컴포넌트를 잘라 클립보드를 XML로 덮어썼다)
		document.addEventListener('copy', onClip, true);
		document.addEventListener('cut', onClip, true);
		document.addEventListener('paste', onClip, true);
		window.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('copy', onClip, true);
			document.removeEventListener('cut', onClip, true);
			document.removeEventListener('paste', onClip, true);
			window.removeEventListener('keydown', onKey);
		};
	}, []);
}
