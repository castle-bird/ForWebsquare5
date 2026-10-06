// 날짜 입력칸 + 달력. 저장·표시 모양은 yyyy-MM-dd. 숫자만 쳐도 하이픈이 자동으로 붙고(20201212 → 2020-12-12),
// 누르면 달력이 열려 날을 고른다(↑↓←→ 이동, PageUp·PageDown 달, Enter 고름, Esc 닫음).
// 칸에서 나올 때 올바른 날짜(또는 빈 값)면 반영, 아니면 원래 값으로. 다른 모양(yyyyMMdd·yyyy.MM.dd)으로 저장된 값도 읽는다
import { useEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { clsx } from 'clsx';
import { useFloating } from './floating';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');
/** 날짜 → yyyy-MM-dd(이 PC 시간대). sep로 구분자를 바꾼다 */
export const formatDate = (d: Date, sep = '-') => [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join(sep);
/** yyyy-MM-dd·yyyyMMdd·yyyy.MM.dd·yyyy/MM/dd → 날짜(없는 날이면 undefined) */
export function parseDate(text: string): Date | undefined {
	const m = /^(\d{4})([./-]?)(\d{2})\2(\d{2})$/.exec(text.trim());
	if (!m) { return undefined; }
	const d = new Date(+m[1], +m[3] - 1, +m[4]);
	return formatDate(d, '') === m[1] + m[3] + m[4] ? d : undefined;
}
/** 친 글자 → 숫자만 남겨 yyyy-MM-dd 모양으로(치는 중이면 있는 데까지) */
const typed = (text: string) => {
	const n = text.replace(/\D/g, '').slice(0, 8);
	return [n.slice(0, 4), n.slice(4, 6), n.slice(6)].filter(Boolean).join('-');
};
/** 보여 줄 모양: 올바른 날짜면 yyyy-MM-dd, 아니면 그대로 */
const shown = (value: string) => { const d = parseDate(value); return d ? formatDate(d) : value; };
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => {
	const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
	return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last));
};

export function DateInput({ value, onCommit, className, ...rest }: { value: string; onCommit(v: string): void }
	& Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown'>) {
	const [draft, setDraft] = useState(() => shown(value));
	const [input, setInput] = useState<HTMLInputElement | null>(null);
	const [open, setOpen] = useState(false);
	// 달력에서 가리키는 날(보이는 달도 이 날의 달)
	const [cursor, setCursor] = useState(() => parseDate(value) ?? new Date());
	// 마지막으로 보낸 값(원문 그대로): 고른 뒤 문서가 돌아오기 전에 칸에서 나와도 두 번 보내지 않게
	const sent = useRef(value);
	useEffect(() => { setDraft(shown(value)); sent.current = value; }, [value]);
	const { ref, style } = useFloating<HTMLDivElement>(open ? input ?? undefined : undefined, 'bottom-start', 2);

	/** v(yyyy-MM-dd 또는 빈 값)를 반영. 원문과 같은 날이면(모양만 다르면) 안 보낸다: 열고 닫기만 해도 파일이 바뀌지 않게 */
	const commit = (v: string) => {
		setDraft(v);
		if (v === shown(sent.current)) { return; }
		sent.current = v;
		onCommit(v);
	};
	const show = () => { setCursor(parseDate(draft) ?? new Date()); setOpen(true); };
	const pick = (d: Date) => { setOpen(false); commit(formatDate(d)); };
	const leave = () => {
		setOpen(false);
		const d = parseDate(draft);
		if (draft !== '' && !d) { setDraft(shown(sent.current)); return; }
		commit(d ? formatDate(d) : '');
	};
	const keys = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.nativeEvent.isComposing) { return; }
		if (!open) {
			if (e.key === 'ArrowDown' && e.altKey || e.key === 'F4') { e.preventDefault(); show(); }
			else if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
			return;
		}
		const move = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
		if (move !== undefined) { e.preventDefault(); setCursor(c => addDays(c, move)); }
		else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); setCursor(c => addMonths(c, e.key === 'PageUp' ? -1 : 1)); }
		// 친 날짜가 덜 됐거나 없는 날이면 칸에서 나가며 원래 값으로(달력이 가리키던 날로 덮지 않게)
		else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (draft !== '' && !parseDate(draft)) { e.currentTarget.blur(); } else { pick(cursor); } }
		// Esc는 달력만 닫는다(팝업·패널까지 닫지 않게)
		else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
	};

	const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
	const start = addDays(first, -first.getDay());
	const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
	const parsed = parseDate(draft), selected = parsed && formatDate(parsed, ''), today = formatDate(new Date(), '');
	return <>
		<span className={clsx('date-input', className)}>
			<input ref={setInput} {...rest} value={draft} inputMode="numeric" maxLength={10} placeholder="yyyy-MM-dd" autoComplete="off"
				role="combobox" aria-expanded={open} aria-invalid={draft !== '' && !parsed}
				onChange={e => {
					const next = typed(e.target.value), d = parseDate(next);
					setDraft(next);
					// 다 친 날짜면 달력도 그 날로(Enter로 바로 고름)
					if (d) { setCursor(d); }
				}}
				onMouseDown={() => { if (!open) { show(); } }}
				onBlur={leave} onKeyDown={keys} />
			<span className="date-input-icon codicon codicon-calendar" aria-hidden="true"
				onMouseDown={e => { e.preventDefault(); input?.focus(); if (open) { setOpen(false); } else { show(); } }} />
		</span>
		{open && <div ref={ref} className="date-picker" role="dialog" aria-label="날짜 고르기" style={style}
			// 누르는 동안 입력칸 포커스를 잃지 않게(잃으면 닫히며 반영된다)
			onMouseDown={e => e.preventDefault()}>
			<div className="date-picker-head">
				<button type="button" className="codicon codicon-chevron-left" aria-label="이전 달" tabIndex={-1} onClick={() => setCursor(c => addMonths(c, -1))} />
				<span className="date-picker-title">{cursor.getFullYear()}년 {cursor.getMonth() + 1}월</span>
				<button type="button" className="codicon codicon-chevron-right" aria-label="다음 달" tabIndex={-1} onClick={() => setCursor(c => addMonths(c, 1))} />
			</div>
			<div className="date-picker-grid" role="grid">
				{WEEKDAYS.map((w, i) => <span key={w} className={clsx('date-picker-weekday', { sun: i === 0, sat: i === 6 })}>{w}</span>)}
				{days.map(d => {
					const v = formatDate(d, '');
					return <button key={v} type="button" tabIndex={-1} aria-label={v} aria-selected={v === selected}
						className={clsx('date-picker-day', { outside: d.getMonth() !== cursor.getMonth(), today: v === today, cursor: v === formatDate(cursor, ''), sun: d.getDay() === 0, sat: d.getDay() === 6 })}
						onClick={() => pick(d)}>{d.getDate()}</button>;
				})}
			</div>
			<div className="date-picker-foot">
				<button type="button" tabIndex={-1} onClick={() => pick(new Date())}>오늘</button>
			</div>
		</div>}
	</>;
}
