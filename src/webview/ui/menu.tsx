import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

/** 부모 메뉴 안에 두어 바깥 클릭·Esc 닫기를 함께 처리한다. */
export function Submenu({ label, children }: { label: string; children: ReactNode }) {
	const trigger = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const keyboard = useRef(false);
	const { ref, style, placed } = useFloating<HTMLDivElement>(open ? trigger.current ?? undefined : undefined, 'right-start');
	useEffect(() => {
		if (placed && keyboard.current) { ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }
	}, [placed]);
	return <div onMouseEnter={() => { keyboard.current = false; setOpen(true); }} onMouseLeave={() => setOpen(false)} onKeyDown={e => {
		if (e.key === 'ArrowLeft') { e.preventDefault(); setOpen(false); trigger.current?.focus(); }
		if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			e.preventDefault();
			const buttons = [...ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []];
			const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
			buttons[at < 0 ? (e.key === 'ArrowDown' ? 0 : buttons.length - 1) : (at + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
		}
	}}>
		<button ref={trigger} role="menuitem" aria-haspopup="menu" aria-expanded={open} onClick={() => { keyboard.current = true; setOpen(true); ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }}
			onKeyDown={e => { if (e.key === 'ArrowRight') { e.preventDefault(); keyboard.current = true; setOpen(true); ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); } }}>
			{label}<span className="codicon codicon-chevron-right" aria-hidden="true" />
		</button>
		{open && <div ref={ref} className="context-menu" role="menu" aria-label={label} style={{ ...style, maxHeight: 'calc(100vh - 8px)', maxWidth: 'calc(100vw - 8px)', overflowY: 'auto', overflowWrap: 'anywhere' }}>{children}</div>}
	</div>;
}
