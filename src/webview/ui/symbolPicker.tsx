// 코드 편집기 기호 빠른 이동 팝업(Ctrl+Shift+O): 현재 파일의 함수·메서드·SQL ID·태그를 퍼지 검색해 바로 점프한다
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { clsx } from 'clsx';
import fuzzysort from 'fuzzysort';
import type { CodeSymbol, SymbolKind } from '../../core/symbols';

const ICON: Record<SymbolKind, string> = {
	class: 'symbol-class',
	interface: 'symbol-interface',
	method: 'symbol-method',
	function: 'symbol-method',
	sql: 'database',
	tag: 'code',
};

const LIMIT = 100;

export function SymbolPicker({ symbols, onChoose, onClose }: {
	symbols: CodeSymbol[];
	onChoose(symbol: CodeSymbol): void;
	onClose(): void;
}) {
	const [query, setQuery] = useState('');
	const [active, setActive] = useState(0);
	const boxRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLUListElement>(null);

	const results = useMemo(() => {
		const q = query.trim();
		if (!q) { return symbols.slice(0, LIMIT); }
		return fuzzysort.go(q, symbols, { keys: ['name', 'detail'], limit: LIMIT, threshold: 0.2 }).map(r => r.obj);
	}, [query, symbols]);

	const index = results.length ? Math.min(active, results.length - 1) : 0;

	useEffect(() => {
		inputRef.current?.focus();
		const onOutside = (e: PointerEvent) => {
			if (!boxRef.current?.contains(e.target as Node)) {
				onClose();
			}
		};
		window.addEventListener('pointerdown', onOutside, true);
		return () => window.removeEventListener('pointerdown', onOutside, true);
	}, [onClose]);

	useEffect(() => {
		listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' });
	}, [index, results]);

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.nativeEvent.isComposing) { return; }
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onClose();
		} else if (e.key === 'ArrowDown' && results.length) {
			e.preventDefault();
			setActive((index + 1) % results.length);
		} else if (e.key === 'ArrowUp' && results.length) {
			e.preventDefault();
			setActive((index + results.length - 1) % results.length);
		} else if (e.key === 'Enter' && results.length) {
			e.preventDefault();
			onChoose(results[index]);
		}
	};

	return <div ref={boxRef} className="symbol-picker" role="dialog" aria-label="기호로 이동">
		<div className="symbol-picker-input">
			<span className="codicon codicon-symbol-misc" aria-hidden="true" />
			<input ref={inputRef} value={query} placeholder="기호 이름으로 검색…" aria-label="기호 이름 검색" spellCheck={false}
				onChange={e => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKeyDown} />
			<span className="symbol-picker-count">{results.length}/{symbols.length}</span>
		</div>
		{results.length ? <ul ref={listRef} className="symbol-picker-list" role="listbox">
			{results.map((s, i) => <li key={`${s.from}:${s.name}`} role="option" aria-selected={i === index} className={clsx({ active: i === index })}
				onMouseDown={e => { e.preventDefault(); onChoose(s); }} onMouseEnter={() => setActive(i)}>
				<span className={`codicon codicon-${ICON[s.kind]} symbol-kind-${s.kind}`} aria-hidden="true" />
				<span className="symbol-name">{s.name}</span>
				{s.detail && <span className="symbol-detail">{s.detail}</span>}
				<span className="symbol-line">:{s.line}</span>
			</li>)}
		</ul> : <div className="symbol-picker-empty">{symbols.length ? '일치하는 기호가 없습니다.' : '이동할 기호가 없습니다.'}</div>}
	</div>;
}
