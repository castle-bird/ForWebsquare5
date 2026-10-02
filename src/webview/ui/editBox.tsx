import { useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { ComboInput } from './combo';

/**
 * footer: 글자 칸 아래에 붙일 입력(그리드 헤더 칸의 너비·높이 등). 있으면 포커스가 이 상자 안에서 옮겨 갈 때는 닫지 않는다.
 * changed: footer 값이 바뀜 → 글자가 그대로여도 닫을 때 onCommit
 * suggestions: 한 줄 입력에 고를 값 목록(직접 입력도 됨). 목록에서 고르면 바로 반영
 */
export function EditBox({ value, onCommit, onClose, className, style, multiline = true, enterNewline = false, initialHeight, footer, changed = false, suggestions }: {
	value: string; onCommit(v: string): void; onClose(): void; className?: string; style?: CSSProperties; multiline?: boolean; enterNewline?: boolean; initialHeight?: number;
	footer?: ReactNode; changed?: boolean; suggestions?: string[];
}) {
	const [draft, setDraft] = useState(value);
	// Enter로 닫힐 때 뒤따르는 blur가 한 번 더 반영하지 않게
	const closed = useRef(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const wrap = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		if (multiline && textareaRef.current) {
			const el = textareaRef.current;
			el.style.height = 'auto';
			el.style.height = `${Math.max(initialHeight ?? 52, el.scrollHeight)}px`;
		}
	}, [draft, multiline, initialHeight]);

	const close = (commit: boolean, next = draft) => {
		if (closed.current) {
			return;
		}
		closed.current = true;
		if (commit && (next !== value || changed)) {
			onCommit(next);
		}
		onClose();
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
		const newline = multiline && (enterNewline ? !(e.ctrlKey || e.metaKey) : e.shiftKey);
		if (e.key === 'Enter' && !newline && !e.nativeEvent.isComposing) {
			e.preventDefault();
			close(true);
		} else if (e.key === 'Escape') {
			e.stopPropagation();
			close(false);
		}
	};

	const common = {
		autoFocus: true,
		className: clsx('edit', className),
		style: multiline ? { ...style, minHeight: initialHeight ? `${initialHeight}px` : undefined } : style,
		value: draft,
		onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
		onBlur: () => close(true),
		onKeyDown,
		onFocus: (e: { currentTarget: HTMLTextAreaElement | HTMLInputElement }) => e.currentTarget.setSelectionRange(draft.length, draft.length),
	};

	if (suggestions && !multiline) {
		// 입력칸 + 목록(열자마자 전체 목록). 목록에서 고르면 바로 반영
		const { onChange: _, value: __, ...input } = common;
		return <ComboInput type="text" {...input} value={draft} options={suggestions} onValue={setDraft} onPick={v => { setDraft(v); close(true, v); }} />;
	}
	if (!footer) {
		return multiline ? <textarea ref={textareaRef} {...common} /> : <input type="text" {...common} />;
	}
	// 자리·너비는 바깥 상자에, 높이는 글자 칸에
	const { height, ...place } = style ?? {};
	const field = { ...common, className: 'edit', style: { height }, onBlur: undefined };
	return (
		<div ref={wrap} className={clsx('edit-wrap', className)} style={place}
			onBlur={(e: FocusEvent) => !wrap.current?.contains(e.relatedTarget as Node | null) && close(true)}
			// 상자 안의 입력칸이 아닌 곳(이름 글자·여백)을 눌러도 포커스를 잃지 않게(잃으면 닫힌다). 이름 글자는 그 입력칸으로 간다(label)
			onMouseDown={e => !(e.target as Element).closest('input, select, textarea, option') && e.preventDefault()}
			onKeyDown={e => e.target instanceof HTMLInputElement && onKeyDown(e as KeyboardEvent<HTMLInputElement>)}>
			{multiline ? <textarea ref={textareaRef} {...field} /> : <input type="text" {...field} />}
			<div className="edit-footer">{footer}</div>
		</div>
	);
}

