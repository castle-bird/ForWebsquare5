import { useMemo, useState } from 'react';
import type { ComponentDef, ToExtension } from '../../core/protocol';
import { insertPositions, insertTarget, INSERT_POSITION_LABELS, matchPalette, paletteDefs, paletteKey } from '../../core/palette';
import { pathTo } from '../../core/xmlModel';
import type { InsertPosition } from '../../core/paste';
import { Menu } from './menu';
import { COMPONENT_ICONS } from '../../core/icons';
import { post, useEditorStore } from '../store';
import { useRowDrag } from './rowDrag';
import { setDragGhost } from './tree';

const CATEGORY_ICONS: Record<string, string> = { Chart: 'graph', Container: 'folder', Forms: 'symbol-field', Frame: 'browser', Grid: 'table', HTML5: 'code', Navigation: 'compass', Others: 'symbol-misc' };

export const PALETTE_MIME = 'application/x-websquare5-component';
export type PaletteDrag = Pick<Extract<ToExtension, { type: 'insertComponent' }>, 'component' | 'version'>;

export function readPaletteDrag(data: DataTransfer): PaletteDrag | undefined {
	try {
		const value: PaletteDrag | null = JSON.parse(data.getData(PALETTE_MIME) || 'null');
		return value && Number.isInteger(value.version) && value.component
			&& ['id', 'ns', 'realType'].every(key => typeof value.component[key as keyof PaletteDrag['component']] === 'string') ? value : undefined;
	} catch { return undefined; }
}

export function PalettePane() {
	const doc = useEditorStore(s => s.doc);
	const definitions = useEditorStore(s => s.defs);
	const favoriteKeys = useEditorStore(s => s.paletteFavorites);
	const toggleFavorite = useEditorStore(s => s.togglePaletteFavorite);
	const reorderFavorites = useEditorStore(s => s.reorderPaletteFavorites);
	const { handleProps, rowProps, dropClass } = useRowDrag<{ uid: string }>(update => {
		const current = useEditorStore.getState().paletteFavorites.map(uid => ({ uid }));
		const next = typeof update === 'function' ? update(current) : update;
		if (next !== current) { reorderFavorites(next.map(row => row.uid)); }
	});
	const [menu, setMenu] = useState<{ anchor: Element; request: Extract<ToExtension, { type: 'insertComponent' }>; positions: InsertPosition[] }>();
	const [query, setQuery] = useState('');
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const defs = useMemo(() => matchPalette(paletteDefs(definitions?.defs ?? []), query), [definitions, query]);
	const groups = useMemo(() => [...new Set(defs.map(d => d.category!))].sort(), [defs]);
	const payload = (def: ComponentDef): PaletteDrag => ({ version: doc!.version, component: { id: def.id, ns: def.ns, realType: def.realType } });
	const favorites = favoriteKeys.flatMap(key => defs.find(def => paletteKey(def) === key) ?? []);
	const row = (def: ComponentDef, sortable = false) => {
		const favorite = favoriteKeys.includes(paletteKey(def));
		const icon = COMPONENT_ICONS[def.realType] ?? CATEGORY_ICONS[def.category!] ?? 'symbol-misc';
		return <div className={`palette-row${sortable ? ` palette-favorite-row ${dropClass(paletteKey(def))}` : ''}`} key={paletteKey(def)} {...(sortable ? rowProps(paletteKey(def)) : {})}>
			{sortable && <button className="palette-drag-handle" title="끌어서 즐겨찾기 순서 변경" aria-label={`${def.display} 즐겨찾기 순서 변경`} {...handleProps(paletteKey(def))}
				onKeyDown={e => {
					if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') { return; }
					e.preventDefault();
					// 보이는 바로 옆 즐겨찾기와 바꾼다(검색에 숨은 항목은 제자리)
					const shown = favorites.indexOf(def), other = favorites[shown + (e.key === 'ArrowUp' ? -1 : 1)];
					if (!other) { return; }
					const keys = [...favoriteKeys], at = keys.indexOf(paletteKey(def)), to = keys.indexOf(paletteKey(other));
					[keys[at], keys[to]] = [keys[to], keys[at]];
					reorderFavorites(keys);
				}}>⠿</button>}
			<button className="palette-component" data-component={def.realType} title={def.description ?? def.display}
				disabled={!doc?.root || !!doc.error} draggable={!!doc?.root && !doc.error}
				aria-haspopup="menu" aria-expanded={!!menu && paletteKey(menu.request.component) === paletteKey(def) && !!menu.anchor.closest('.palette-favorites') === sortable}
				onClick={e => {
					if (!doc?.root) { return; }
					const index = useEditorStore.getState().selected, path = index === undefined ? undefined : pathTo(doc.root, index);
					if (index !== undefined && !path) { return; }
					const target = insertTarget(doc.root, path);
					if (!target) { useEditorStore.setState({ toast: { message: 'body가 없는 화면이라 넣을 수 없습니다.', key: Date.now() } }); return; }
					setMenu({ anchor: e.currentTarget, request: { type: 'insertComponent', ...payload(def), index },
						positions: insertPositions(target) });
				}}
				onDragStart={e => { setMenu(undefined); if (!doc) { e.preventDefault(); return; } e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData(PALETTE_MIME, JSON.stringify(payload(def))); setDragGhost(e.dataTransfer, icon, def.display ?? def.id); }}>
				<span className={`codicon codicon-${icon}`} aria-hidden="true" /><span>{def.display}</span>
			</button>
			<button className="palette-star" draggable={false} aria-pressed={favorite} aria-label={`${def.display} 즐겨찾기 ${favorite ? '해제' : '추가'}`} title={favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'} onClick={() => toggleFavorite(def)}>
				<span className={`codicon codicon-star-${favorite ? 'full' : 'empty'}`} aria-hidden="true" />
			</button>
		</div>;
	};
	return <aside className="palette-pane" aria-label="팔레트">
		<header><span>Palette</span></header>
		<div className="palette-search"><input type="search" aria-label="컴포넌트 검색" placeholder="이름·태그·묶음 검색" value={query} onChange={e => setQuery(e.target.value)} /></div>
		<div className="palette-list">
			<section className="palette-favorites" aria-label="즐겨찾기">
				<h2>즐겨찾기</h2>
				{favorites.length ? favorites.map(def => row(def, true)) : <p className="empty">{query ? '검색 결과 없음' : '별을 눌러 추가'}</p>}
			</section>
			{definitions?.error && <p className="warning">{definitions.error}</p>}
			{!groups.length && <p className="empty">{query ? '검색 결과 없음' : '넣을 수 있는 컴포넌트 없음'}</p>}
			{groups.map(group => {
				const open = !!query.trim() || expanded.has(group);
				return <section key={group}>
					<button className="palette-category" aria-expanded={open} onClick={() => setExpanded(current => {
						const next = new Set(current); if (next.has(group)) { next.delete(group); } else { next.add(group); } return next;
					})}><span className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} aria-hidden="true" />{group}</button>
					<div hidden={!open}>{defs.filter(d => d.category === group).sort((a, b) => a.display!.localeCompare(b.display!)).map(def => row(def))}</div>
				</section>;
			})}
		</div>
		{menu && <Menu anchor={menu.anchor} placement="right-start" onClose={() => setMenu(undefined)}>
			{menu.positions.map(position => <button key={position} role="menuitem" onClick={() => {
				setMenu(undefined); post({ ...menu.request, position });
			}}>{INSERT_POSITION_LABELS[position]}</button>)}
		</Menu>}
	</aside>;
}
