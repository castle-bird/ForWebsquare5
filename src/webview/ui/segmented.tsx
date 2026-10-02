// 선택지가 몇 개뿐인 값: select 대신 버튼 묶음(한눈에 보이고 한 번에 고른다). ←→로도 옮긴다
import type { KeyboardEvent } from 'react';

export function Segmented({ value, options, onChange, ...rest }: {
	value: string; options: string[]; onChange(value: string): void; id?: string; 'aria-label'?: string;
}) {
	const keys = (e: KeyboardEvent) => {
		const by = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
		if (by) {
			e.preventDefault();
			onChange(options[(options.indexOf(value) + by + options.length) % options.length]);
		}
	};
	return (
		<div {...rest} className="segmented" role="radiogroup" data-value={value} onKeyDown={keys}>
			{options.map(o => (
				<button key={o} type="button" role="radio" aria-checked={o === value} tabIndex={o === value ? 0 : -1} onClick={() => onChange(o)}>{o}</button>
			))}
		</div>
	);
}
