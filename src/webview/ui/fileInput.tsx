// 경로 입력칸 + 파일 검색(VS Code Ctrl+E처럼): 입력하면 프로젝트 파일을 파일 이름·경로로 퍼지 검색(fuzzysort)해 아래에 보여 준다
import { useMemo, useState, type KeyboardEvent } from 'react';
import { clsx } from 'clsx';
import fuzzysort from 'fuzzysort';

const LIMIT = 15;

export function FileInput({ files, value, onChange, onChoose, onFocus, placeholder, label }: {
	/** 검색 대상(아직 안 받았으면 undefined) */
	files?: string[];
	value: string; onChange(value: string): void;
	/** 목록에서 고름(클릭·Enter) */
	onChoose(file: string): void;
	onFocus?(): void;
	placeholder?: string; label: string;
}) {
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const targets = useMemo(() => files?.map(file => ({ file, name: file.split(/[\\/]/).pop() ?? file })), [files]);
	const results = useMemo(() => value.trim() && targets
		? fuzzysort.go(value.trim(), targets, { keys: ['name', 'file'], limit: LIMIT, threshold: 0.2 }).map(r => r.obj) : [], [value, targets]);
	const shown = open && results.length > 0;
	const choose = (file: string) => {
		setOpen(false);
		onChoose(file);
	};
	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		// 한글 조합 중 Enter·화살표는 조합을 끝내는 키라 목록에 쓰지 않는다
		if (!shown || e.nativeEvent.isComposing) {
			return;
		}
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			setActive(i => (i + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			choose(results[Math.min(active, results.length - 1)].file);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			setOpen(false);
		}
	};
	return <div className="file-input">
		<input value={value} placeholder={placeholder} aria-label={label} spellCheck={false} role="combobox" aria-expanded={shown} aria-autocomplete="list"
			onChange={e => { onChange(e.target.value); setOpen(true); setActive(0); }}
			onFocus={() => { onFocus?.(); setOpen(true); }} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
		{shown && <ul className="file-suggest" role="listbox">
			{results.map((r, i) => <li key={r.file} role="option" aria-selected={i === active} className={clsx({ active: i === active })} title={r.file}
				// blur(목록 닫힘)보다 먼저 고르도록 mousedown
				onMouseDown={e => { e.preventDefault(); choose(r.file); }} onMouseEnter={() => setActive(i)}>
				<span className="file-name">{r.name}</span><span className="file-dir">{r.file.slice(0, r.file.length - r.name.length).replace(/[\\/]$/, '')}</span>
			</li>)}
		</ul>}
	</div>;
}
