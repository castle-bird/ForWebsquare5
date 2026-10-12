import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { resizeBox, resizeEdges, type Box, type ResizeEdge } from './resizeBox';
import { isModKey } from '../keys';
import { capturePointer } from './pointerCapture';

let globalPopupZIndex = 100;

export function usePopupWindow(options: { initialOffset?: number; onClose?(): void } = {}) {
	const { initialOffset = 0, onClose } = options;
	const [box, setBox] = useState<Box>();
	const [zIndex, setZIndex] = useState(() => ++globalPopupZIndex);
	const dialog = useRef<HTMLDialogElement>(null);
	const windowDrag = useRef<{ x: number; y: number } | undefined>(undefined);
	const resizeDrag = useRef<{ edge: ResizeEdge; startX: number; startY: number; box: Box } | undefined>(undefined);

	const bringToFront = () => {
		setZIndex(++globalPopupZIndex);
	};

	useEffect(() => {
		const popup = dialog.current;
		if (popup && !popup.open) {
			popup.show?.();
		}
		// open 속성으로 열면 show()의 포커스 이동이 없어 ESC(onKeyDown)가 팝업을 한 번 클릭한 뒤에야 먹는다 → 열자마자 포커스
		popup?.focus();
		const canvas = document.querySelector('.canvas-frame')?.getBoundingClientRect();
		if (popup && canvas) {
			const rect = popup.getBoundingClientRect();
			const offset = (initialOffset % 8) * 24;
			setBox({
				x: Math.max(0, canvas.left + (canvas.width - rect.width) / 2 + offset),
				y: Math.max(0, canvas.top + (canvas.height - rect.height) / 2 + offset),
				width: rect.width,
				height: rect.height,
			});
		}
		// 처음 열 때만 배치: 다른 팝업이 닫혀 순번(initialOffset)이 바뀌어도 이 팝업이 가운데로 튀지 않게
	}, []);

	const titleProps = {
		onPointerDown: (e: PointerEvent<HTMLElement>) => {
			if (e.button !== 0 || !dialog.current) { return; }
			bringToFront();
			const rect = dialog.current.getBoundingClientRect();
			windowDrag.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
			capturePointer(e);
		},
		onPointerMove: (e: PointerEvent<HTMLElement>) => {
			const grab = windowDrag.current;
			if (!grab || !dialog.current) { return; }
			const { width, height } = dialog.current.getBoundingClientRect();
			// 값은 여기서 계산해 둔다: setBox 갱신 함수는 나중에 돌 수 있어서 그 사이 pointerup이 windowDrag를 비우면 터진다(앱 전체가 내려감)
			const x = Math.max(0, Math.min(innerWidth - width, e.clientX - grab.x));
			const y = Math.max(0, Math.min(innerHeight - height, e.clientY - grab.y));
			setBox(current => current && { ...current, x, y });
		},
		onPointerUp: () => windowDrag.current = undefined,
		onPointerCancel: () => windowDrag.current = undefined,
	};

	const resizeHandles = resizeEdges.map(edge => (
		<div key={edge} className={`popup-resize resize-${edge}`} aria-hidden="true"
			onPointerDown={e => {
				if (e.button !== 0 || !dialog.current) { return; }
				e.preventDefault();
				bringToFront();
				const rect = dialog.current.getBoundingClientRect();
				resizeDrag.current = { edge, startX: e.clientX, startY: e.clientY, box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } };
				capturePointer(e);
			}}
			onPointerMove={e => {
				const drag = resizeDrag.current;
				if (drag) { setBox(resizeBox(drag.box, drag.edge, e.clientX - drag.startX, e.clientY - drag.startY, innerWidth, innerHeight)); }
			}}
			onPointerUp={() => resizeDrag.current = undefined} onPointerCancel={() => resizeDrag.current = undefined} />
	));

	const onDialogKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
		if (e.key === 'Escape') {
			e.stopPropagation();
			onClose?.();
		} else if (isModKey(e.nativeEvent, 'z') || isModKey(e.nativeEvent, 'y')) {
			// 입력칸의 되돌리기만: VS Code 웹뷰는 이 키를 VS Code에도 넘겨 화면 XML 문서까지 되돌린다(팝업 열린 채 문서가 바뀜)
			e.stopPropagation();
		} else if (leavesOnEnter(e)) {
			// 입력을 마쳤다는 표시로 입력칸에서 나온다(blur로 반영하는 칸도 이때 반영). 팝업에 포커스를 둬서 Esc로 닫기는 그대로
			e.preventDefault();
			e.currentTarget.focus();
		}
	};

	const style: CSSProperties | undefined = box
		? { inset: 'auto', left: box.x, top: box.y, width: box.width, height: box.height, margin: 0, zIndex }
		: { zIndex };

	const popupProps = {
		ref: dialog,
		open: true,
		tabIndex: -1,
		style,
		onPointerDownCapture: bringToFront,
		onKeyDown: onDialogKeyDown,
	};

	return { dialog, style, titleProps, resizeHandles, bringToFront, popupProps };
}

/** 글자 입력칸의 Enter(한글 조합 중·조합키·목록에서 고른 것 빼고). form 안이어도 확인(submit) 대신 입력칸에서 나온다 — 확인은 버튼으로 */
function leavesOnEnter(e: KeyboardEvent<HTMLElement>) {
	const input = e.target;
	return e.key === 'Enter' && !e.defaultPrevented && !e.nativeEvent.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
		&& input instanceof HTMLInputElement && !['checkbox', 'radio', 'color', 'file', 'button', 'submit'].includes(input.type);
}

/** 팝업 아래 버튼 줄: 왼쪽 children(안내·추가 버튼) · 닫기 · 확인 */
export function PopupActions({ onClose, onApply, applyDisabled, children }: { onClose(): void; onApply(): void; applyDisabled?: boolean; children?: ReactNode }) {
	return <div className="data-editor-actions">
		{children}
		<button type="button" className="btn btn-secondary" onClick={onClose}>닫기</button>
		<button type="button" className="btn btn-primary" disabled={applyDisabled} onClick={onApply}>확인</button>
	</div>;
}

export function PopupTitle({ titleProps, badge, onClose, children }: {
	titleProps: ReturnType<typeof usePopupWindow>['titleProps']; badge: string; onClose(): void; children: ReactNode;
}) {
	return <div className="popup-title" {...titleProps}>
		<div className="popup-title-left">
			<span className="popup-badge">{badge}</span>
			{children}
		</div>
		<button type="button" className="icon popup-close codicon codicon-close" title="닫기" aria-label="닫기" onClick={onClose} onPointerDown={e => e.stopPropagation()} />
	</div>;
}
