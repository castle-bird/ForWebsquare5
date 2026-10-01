import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { pointAt, useFloating } from './floating';

/** 우클릭 메뉴: (x, y)에서 열고 화면 밖이면 뒤집거나 밀어 넣는다. 첫 항목에 포커스, 바깥 클릭·Esc로 닫힘 */
export function Menu({ x, y, onClose, children }: { x: number; y: number; onClose(): void; children: ReactNode }) {
	const { ref, style, placed } = useFloating<HTMLDivElement>(useMemo(() => pointAt(x, y), [x, y]), 'bottom-start');
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
