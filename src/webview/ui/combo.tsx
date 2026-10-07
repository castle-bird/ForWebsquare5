// 입력칸 + 고를 값 목록. 열면 전체 목록(지금 값 표시), 타이핑하면 그 글자를 포함하는 것만.
// 브라우저 datalist는 입력칸의 지금 값으로 목록을 걸러서, 값이 있으면 다른 값이 안 보인다
import { useCallback, useState, type InputHTMLAttributes, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { useFloating } from './floating';

export function ComboInput({ value, options, onValue, onPick, onKeyDown, onFocus, onBlur, inputRef, portal, ...rest }: {
	value: string; options: string[]; onValue(v: string): void;
	/** 목록에서 고름(클릭·↑↓ 뒤 Enter) */
	onPick(v: string): void;
	/** 입력칸 요소도 받을 ref */
	inputRef?: RefObject<HTMLInputElement | null>;
	/** 목록을 body에 그린다: 확대·이동(transform)된 조상 안이면 fixed 자리가 어긋나서 */
	portal?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
	const [input, setInput] = useState<HTMLInputElement | null>(null);
	const attach = useCallback((el: HTMLInputElement | null) => { setInput(el); if (inputRef) { inputRef.current = el; } }, [inputRef]);
	const [focused, setFocused] = useState(false);
	const [typed, setTyped] = useState(false);
	const [active, setActive] = useState(-1);
	// 목록에서 고른 뒤 닫힘(포커스는 입력칸에 그대로). 다시 누르거나 타이핑·↓로 열림
	const [closed, setClosed] = useState(false);
	const query = typed ? value.toLowerCase() : '';
	const shown = query ? options.filter(o => o.toLowerCase().includes(query)) : options;
	const open = focused && !closed && shown.length > 0;
	const { ref, style } = useFloating<HTMLUListElement>(open ? input ?? undefined : undefined, 'bottom-start', 2);
	const pick = (v: string) => {
		setClosed(true);
		setTyped(false);
		setActive(-1);
		onPick(v);
	};
	const keys = (e: KeyboardEvent<HTMLInputElement>) => {
		if (closed && e.key === 'ArrowDown') {
			e.preventDefault();
			setClosed(false);
			return;
		}
		if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			e.preventDefault();
			setActive(a => e.key === 'ArrowDown' ? Math.min(shown.length - 1, a + 1) : Math.max(0, a - 1));
			return;
		}
		// Esc는 목록만 닫는다(VS Code 자동완성처럼). 안 막으면 팝업이 통째로 닫히거나 Property 입력이 취소된다
		if (open && e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			setClosed(true);
			return;
		}
		if (open && e.key === 'Enter' && shown[active] !== undefined && !e.nativeEvent.isComposing) {
			e.preventDefault();
			e.stopPropagation();
			pick(shown[active]);
			return;
		}
		onKeyDown?.(e);
	};
	const list = open && (
		<ul ref={ref} className="combo-list" role="listbox" style={{ ...style, minWidth: input?.offsetWidth }}>
			{shown.map((o, i) => (
				<li key={o} role="option" aria-selected={i === active} className={clsx({ current: o === value })}
					// 누르는 동안 입력칸 포커스를 잃지 않게(잃으면 닫히며 반영된다)
					onMouseDown={e => { e.preventDefault(); pick(o); }} onMouseEnter={() => setActive(i)}>{o}</li>
			))}
		</ul>
	);
	return <>
		<input ref={attach} {...rest} value={value} role="combobox" aria-expanded={open} autoComplete="off"
			onChange={e => { setTyped(true); setClosed(false); setActive(-1); onValue(e.target.value); }}
			onMouseDown={() => setClosed(false)}
			onFocus={e => { setFocused(true); setClosed(false); onFocus?.(e); }}
			onBlur={e => { setFocused(false); onBlur?.(e); }}
			onKeyDown={keys} />
		{list && portal ? createPortal(list, document.body) : list}
	</>;
}
