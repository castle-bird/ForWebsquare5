import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { clsx } from 'clsx';

export function EditBox({ value, onCommit, onClose, className, style, multiline = true, enterNewline = false, initialHeight }: {
	value: string; onCommit(v: string): void; onClose(): void; className?: string; style?: CSSProperties; multiline?: boolean; enterNewline?: boolean; initialHeight?: number;
}) {
	const [draft, setDraft] = useState(value);
	// Enter로 닫힐 때 뒤따르는 blur가 한 번 더 반영하지 않게
	const closed = useRef(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useLayoutEffect(() => {
		if (multiline && textareaRef.current) {
			const el = textareaRef.current;
			el.style.height = 'auto';
			el.style.height = `${Math.max(initialHeight ?? 52, el.scrollHeight)}px`;
		}
	}, [draft, multiline, initialHeight]);

	const close = (commit: boolean) => {
		if (closed.current) {
			return;
		}
		closed.current = true;
		if (commit && draft !== value) {
			onCommit(draft);
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

	return multiline ? <textarea ref={textareaRef} {...common} /> : <input type="text" {...common} />;
}

