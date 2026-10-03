import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Placement } from '@floating-ui/dom';
import { pointAt, useFloating } from './floating';

/**
 * 우클릭 메뉴: (x, y)에서 열고 화면 밖이면 뒤집거나 밀어 넣는다. 첫 항목에 포커스, 바깥 클릭·Esc로 닫힘.
 * anchor(버튼)가 있으면 그 요소에 붙는다(아래 공간이 없으면 버튼 위로, 버튼을 덮지 않게)
 */
export function Menu({ x = 0, y = 0, anchor, placement = 'bottom-start', onClose, children }: { x?: number; y?: number; anchor?: Element; placement?: Placement; onClose(): void; children: ReactNode }) {
	const { ref, style, placed } = useFloating<HTMLDivElement>(useMemo(() => anchor ?? pointAt(x, y), [anchor, x, y]), placement, anchor ? 2 : 0);
	const close = useRef(onClose);
	close.current = onClose;
	useEffect(() => {
		if (placed) {
			ref.current?.querySelector('button')?.focus();
		}
	}, [placed]);
	useEffect(() => {
		const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) { close.current(); } };
		const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { close.current(); } };
		document.addEventListener('pointerdown', outside);
		document.addEventListener('keydown', escape);
		return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
	}, []);
	return <div ref={ref} className="context-menu" role="menu" style={style}>{children}</div>;
}
