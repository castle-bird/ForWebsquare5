import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { clsx } from 'clsx';
import type { ComponentDef } from '../../core/protocol';
import { EV, type XmlNode } from '../../core/xmlModel';
import { EditBox } from './editBox';
import { Tabs } from './tabs';
import { useFloating } from './floating';
import { useEditorStore } from '../store';
import { capturePointer } from './pointerCapture';

/** suggestions: 고를 값 목록(정의의 정해진 값 포함). 목록이 길면 입력이 빠르므로 늘 직접 입력도(입력칸 + 목록) */
interface Row { name: string; attr: string; value?: string; description?: string; display?: string; suggestions?: string[] }
type Edit = (attr: string, value: string | undefined) => void;
interface RowGroup { category: string; order: number; rows: Row[] }

/** choices: 속성별로 고를 값 목록(정의의 정해진 값 대신, 직접 입력도 됨. 예: 바인딩된 그리드 셀의 id → dataList 컬럼 id) */
function propertyGroups(node: XmlNode, def?: ComponentDef, choices: Record<string, string[]> = {}): RowGroup[] {
	const groups = new Map<string, RowGroup>();
	const add = (category: string, order: number, row: Row) => {
		const g = groups.get(category) ?? { category, order, rows: [] };
		groups.set(category, g);
		g.rows.push(row);
	};
	const known = new Set(['style']);
	for (const p of def?.properties ?? []) {
		if (!known.has(p.name)) {
			known.add(p.name);
			add(p.category, p.order, { name: p.name, attr: p.name, value: node.attrs[p.name], description: p.description, suggestions: choices[p.name] ?? (p.options?.length ? p.options : undefined) });
		}
	}
	for (const [k, v] of Object.entries(node.attrs)) {
		if (!known.has(k) && k !== 'xmlns' && !k.startsWith('xmlns:') && !k.startsWith(EV)) {
			add('기타', 1000, { name: k, attr: k, value: v, suggestions: choices[k] });
		}
	}
	return sortGroups(groups);
}

function eventGroups(node: XmlNode, def?: ComponentDef): RowGroup[] {
	const rows = new Map<string, Row>();
	for (const e of def?.events ?? []) {
		rows.set(e.name, { name: e.name, attr: EV + e.name, value: node.attrs[EV + e.name], description: e.description, display: e.signature });
	}
	for (const [k, v] of Object.entries(node.attrs)) {
		if (k.startsWith(EV) && !rows.has(k.slice(EV.length))) {
			rows.set(k.slice(EV.length), { name: k.slice(EV.length), attr: k, value: v });
		}
	}
	return sortGroups(new Map([['Event', { category: 'Event', order: 0, rows: [...rows.values()] }]]));
}

const sortGroups = (groups: Map<string, RowGroup>) => [...groups.values()]
	.sort((a, b) => a.order - b.order)
	.map(g => ({ ...g, rows: g.rows.sort((a, b) => a.name.localeCompare(b.name)) }));

interface Help { title: string; text: string; anchor: HTMLElement }

interface Search { field: 'name' | 'value'; text: string }

function matcher(text: string): ((s?: string) => boolean) | undefined {
	const terms = text.split(/[\s,]+/).filter(Boolean).map(t => {
		try {
			return new RegExp(t, 'i');
		} catch {
			return new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
		}
	});
	return terms.length ? (s = '') => terms.some(r => r.test(s)) : undefined;
}

function SearchBar({ search, onChange }: { search: Search; onChange(s: Search): void }) {
	return (
		<div className="kv-search">
			<select value={search.field} onChange={e => onChange({ ...search, field: e.target.value as Search['field'] })}>
				<option value="name">Key</option>
				<option value="value">Value</option>
			</select>
			<input type="search" value={search.text} placeholder="공백·쉼표로 여러 개, 정규식 가능"
				onChange={e => onChange({ ...search, text: e.target.value })}
				onKeyDown={e => e.key === 'Escape' && onChange({ ...search, text: '' })} />
		</div>
	);
}

export function PropertyPane({ node, def, choices, warning, onEdit, onScript }: {
	node?: XmlNode; def?: ComponentDef; choices?: Record<string, string[]>; warning?: string; onEdit: Edit; onScript?(eventName: string): void;
}) {
	const tabOrder = useEditorStore(s => s.tabOrder);
	const setTabOrder = useEditorStore(s => s.setTabOrder);
	const [help, setHelp] = useState<Help>();
	const [keyWidth, setKeyWidth] = useState<number>();
	const [search, setSearch] = useState<Search>({ field: 'name', text: '' });
	const [fading, setFading] = useState(false);
	const fadeTimer = useRef<number>(undefined);
	// 누른 Key 칸 왼쪽(자리가 없으면 오른쪽), 위아래는 화면 안으로
	const { ref: popup, style: popupStyle } = useFloating<HTMLDivElement>(help?.anchor, 'left-start', 6);

	const hide = () => {
		window.clearTimeout(fadeTimer.current);
		setHelp(undefined);
		setFading(false);
	};
	const showHelp = (e: ReactMouseEvent<HTMLElement>, row: Row) => {
		if (!row.description) {
			return;
		}
		window.clearTimeout(fadeTimer.current);
		setFading(false);
		setHelp({ title: row.name, text: row.description, anchor: e.currentTarget });
	};

	useEffect(hide, [node?.index]); // 노드 객체는 문서가 바뀔 때마다 새로 오므로 번호로 비교
	useEffect(() => {
		if (!help) {
			return;
		}
		const onDown = (e: MouseEvent) => {
			const t = e.target as Element;
			if (!popup.current?.contains(t) && !t.closest?.('.kv .key')) {
				hide();
			}
		};
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
		document.addEventListener('mousedown', onDown);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onDown);
			document.removeEventListener('keydown', onKey);
		};
	}, [help]);

	return (
		<div className="pane"
			onMouseLeave={() => {
				if (help) {
					setFading(true);
					fadeTimer.current = window.setTimeout(hide, 300);
				}
			}}
			onMouseEnter={() => {
				window.clearTimeout(fadeTimer.current);
				setFading(false);
			}}>
			{warning && <p className="warning" title={warning}>{warning}</p>}
			<Tabs order={tabOrder} onReorder={setTabOrder} items={{
				Property: node && <PropertyTable groups={propertyGroups(node, def, choices)} search={search} onSearch={setSearch} keyWidth={keyWidth} onKeyWidth={setKeyWidth} onKeyClick={showHelp} onEdit={onEdit} />,
				Event: node && <PropertyTable groups={eventGroups(node, def)} search={search} onSearch={setSearch} keyWidth={keyWidth} onKeyWidth={setKeyWidth} onKeyClick={showHelp} onEdit={onEdit} isEvent onScript={onScript} />,
			}} />
			<div className="style-area">
				<span>Style</span>
				<Editable className="style-value" disabled={!node} value={node?.attrs.style} onCommit={v => onEdit('style', v)} />
			</div>
			{help && (
				<div ref={popup} className={clsx('help', { fading })} style={popupStyle}>
					<strong>{help.title}</strong>
					<div>{help.text}</div>
				</div>
			)}
		</div>
	);
}

function PropertyTable({ groups: all, search, onSearch, keyWidth, onKeyWidth, onKeyClick, onEdit, isEvent, onScript }: {
	groups: RowGroup[]; search: Search; onSearch(s: Search): void; keyWidth?: number; onKeyWidth(w: number): void; onKeyClick(e: ReactMouseEvent<HTMLElement>, row: Row): void; onEdit: Edit;
	isEvent?: boolean; onScript?(eventName: string): void;
}) {
	const match = matcher(search.text);
	const groups = match ? all.map(g => ({ ...g, rows: g.rows.filter(r => match(r[search.field])) })).filter(g => g.rows.length) : all;
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const toggle = (c: string) => setCollapsed(s => {
		const next = new Set(s);
		if (!next.delete(c)) {
			next.add(c);
		}
		return next;
	});
	const headers = all.length > 1;
	const open = (c: string) => !!match || !collapsed.has(c);
	return (<>
		<SearchBar search={search} onChange={onSearch} />
		{match && !groups.length && <p className="empty">검색 결과 없음</p>}
		<div className="kv-wrap" style={{ '--key-width': keyWidth && `${keyWidth}px` } as CSSProperties}>
			<table className="kv">
				<colgroup><col className="col-key" /><col /></colgroup>
				<thead><tr><th>Key</th><th>Value</th></tr></thead>
				{groups.map(g => (
					<tbody key={g.category}>
						{headers && (
							<tr className="category" onClick={() => toggle(g.category)}>
								<th colSpan={2}><span className={clsx('chevron', { open: open(g.category) })} />{g.category}</th>
							</tr>
						)}
						{open(g.category) && g.rows.map(r => (
							<tr key={r.name} className={clsx({ set: r.value !== undefined })}>
								<td className={clsx('key', { 'has-help': !!r.description })} onClick={e => onKeyClick(e, r)}>{r.display ?? r.name}</td>
								<td>
									{isEvent
										? <div className="value-cell">
											<Editable value={r.value} onCommit={v => onEdit(r.attr, v)} multiline={false} />
											<button type="button" className="icon script-btn codicon codicon-code" title="Script: 없으면 만들고, 있으면 그 코드로 이동" onClick={() => onScript?.(r.name)} />
										</div>
										: <Editable value={r.value} onCommit={v => onEdit(r.attr, v)} multiline={false} suggestions={r.suggestions} />}
								</td>
							</tr>
						))}
					</tbody>
				))}
			</table>
			<ColumnResizer onResize={onKeyWidth} />
		</div>
	</>);
}

function ColumnResizer({ onResize }: { onResize(width: number): void }) {
	const drag = useRef<{ x: number; width: number; max: number }>(undefined);
	return <div className="col-resizer"
		onPointerDown={e => {
			const table = e.currentTarget.parentElement!.querySelector('table')!;
			drag.current = { x: e.clientX, width: table.querySelector('th')!.offsetWidth, max: table.offsetWidth - 60 };
			capturePointer(e);
		}}
		onPointerMove={e => {
			const d = drag.current;
			if (d) {
				onResize(Math.min(d.max, Math.max(60, d.width + e.clientX - d.x)));
			}
		}}
		onPointerUp={() => drag.current = undefined} />;
}

function Editable({ value, onCommit, className, disabled, multiline, suggestions }: {
	value?: string; onCommit(v: string | undefined): void; className?: string; disabled?: boolean; multiline?: boolean; suggestions?: string[];
}) {
	const [editing, setEditing] = useState(false);
	const [initialHeight, setInitialHeight] = useState<number>();
	const divRef = useRef<HTMLDivElement>(null);

	const startEditing = () => {
		if (divRef.current) {
			setInitialHeight(divRef.current.offsetHeight);
		}
		setEditing(true);
	};

	if (editing) {
		return <EditBox value={value ?? ''} className={className} multiline={multiline} initialHeight={initialHeight} suggestions={suggestions} onCommit={v => onCommit(v === '' ? undefined : v)} onClose={() => setEditing(false)} />;
	}
	return <div ref={divRef} className={clsx('value', className, suggestions && 'has-list')} title={value}
		onClick={() => !disabled && startEditing()}>{value}</div>;
}

