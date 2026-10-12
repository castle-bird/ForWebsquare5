import type { SelectHTMLAttributes } from 'react';

export function ChoiceSelect({ value, options, label = v => v, ...rest }: {
	value: string; options: string[]; label?(value: string): string;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value'>) {
	const list = options.includes(value) ? options : [value, ...options];
	return <select value={value} {...rest}>{list.map(v => <option key={v} value={v}>{label(v)}</option>)}</select>;
}
