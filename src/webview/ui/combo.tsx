// 입력칸 + 고를 값 목록. 열면 전체 목록(지금 값 표시), 타이핑하면 그 글자를 포함하는 것만.
// 브라우저 datalist는 입력칸의 지금 값으로 목록을 걸러서, 값이 있으면 다른 값이 안 보인다
import { useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { clsx } from 'clsx';
import { useFloating } from './floating';

export function ComboInput({ value, options, onValue, onPick, onKeyDown, onFocus, onBlur, ...rest }: {
	value: string; options: string[]; onValue(v: string): void;
	/** 목록에서 고름(클릭·↑↓ 뒤 Enter) */
	onPick(v: string): void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
	const [input, setInput] = useState<HTMLInputElement | null>(null);
	const [focused, setFocused] = useState(false);
	const [typed, setTyped] = useState(false);
	const [active, setActive] = useState(-1);
	const query = typed ? value.toLowerCase() : '';
	const shown = query ? options.filter(o => o.toLowerCase().includes(query)) : options;
	const open = focused && shown.length > 0;
	const { ref, style } = useFloating<HTMLUListElement>(open ? input ?? undefined : undefined, 'bottom-start', 2);
	const keys = (e: KeyboardEvent<HTMLInputElement>) => {
		if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			e.preventDefault();
			setActive(a => e.key === 'ArrowDown' ? Math.min(shown.length - 1, a + 1) : Math.max(0, a - 1));
			return;
		}
		if (open && e.key === 'Enter' && shown[active] !== undefined && !e.nativeEvent.isComposing) {
			e.preventDefault();
			e.stopPropagation();
			onPick(shown[active]);
			return;
		}
		onKeyDown?.(e);
	};
	return <>
		<input ref={setInput} {...rest} value={value} role="combobox" aria-expanded={open} autoComplete="off"
			onChange={e => { setTyped(true); setActive(-1); onValue(e.target.value); }}
			onFocus={e => { setFocused(true); onFocus?.(e); }}
			onBlur={e => { setFocused(false); onBlur?.(e); }}
			onKeyDown={keys} />
		{open && (
			<ul ref={ref} className="combo-list" role="listbox" style={{ ...style, minWidth: input?.offsetWidth }}>
				{shown.map((o, i) => (
					<li key={o} role="option" aria-selected={i === active} className={clsx({ current: o === value })}
						// 누르는 동안 입력칸 포커스를 잃지 않게(잃으면 닫히며 반영된다)
						onMouseDown={e => { e.preventDefault(); onPick(o); }} onMouseEnter={() => setActive(i)}>{o}</li>
				))}
			</ul>
		)}
	</>;
}
