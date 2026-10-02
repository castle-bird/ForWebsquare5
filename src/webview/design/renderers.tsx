import { createElement, useState, type CSSProperties, type ReactNode } from 'react';
import { clsx } from 'clsx';
import styleToJs from 'style-to-js';
import imageIcon from '@vscode/codicons/src/icons/file-media.svg';
import linkIcon from '@vscode/codicons/src/icons/link.svg';
import operatorIcon from '@vscode/codicons/src/icons/symbol-operator.svg';
import noteIcon from '@vscode/codicons/src/icons/note.svg';
import treeIcon from '@vscode/codicons/src/icons/list-tree.svg';
import lockIcon from '@vscode/codicons/src/icons/lock.svg';
import miscIcon from '@vscode/codicons/src/icons/symbol-misc.svg';
import unfoldIcon from '@vscode/codicons/src/icons/unfold.svg';
import checklistIcon from '@vscode/codicons/src/icons/checklist.svg';
import searchIcon from '@vscode/codicons/src/icons/search.svg';
import upIcon from '@vscode/codicons/src/icons/chevron-up.svg';
import downIcon from '@vscode/codicons/src/icons/chevron-down.svg';
import leftIcon from '@vscode/codicons/src/icons/chevron-left.svg';
import rightIcon from '@vscode/codicons/src/icons/chevron-right.svg';
import uploadIcon from '@vscode/codicons/src/icons/cloud-upload.svg';
import type { ComponentDef } from '../../core/protocol';
import { defOf, kid, kids, localName, WEBSQUARE_NS, XFORMS_NS, type XmlNode } from '../../core/xmlModel';
import { columnLayout } from '../../core/grid';
import { COMPONENT_ICONS } from '../../core/icons';

const CLASS: Record<string, string> = { gridView: 'grid', tabControl: 'tabcontrol', anchor: 'anchor2' };
const CONTAINERS = new Set(['group', 'section', 'article', 'nav', 'aside']);
const ATTR: Record<string, string> = { colspan: 'colSpan', rowspan: 'rowSpan', for: 'htmlFor', value: 'defaultValue', readonly: 'readOnly', maxlength: 'maxLength' };
export const XHTML = 'http://www.w3.org/1999/xhtml';
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

type Renderer = (node: XmlNode, className: string, defs: ComponentDef[]) => ReactNode;

const text = (tag: string): Renderer => (n, c) => el(n, tag, c, labelOf(n));

const RENDERERS: Record<string, Renderer> = {
	body: (n, c, d) => el(n, 'div', c, children(n, d)),
	trigger: (n, c) => el(n, 'input', c, undefined, { type: 'button', value: labelOf(n) ?? '', readOnly: true, tabIndex: -1 }),
	input: (n, c) => el(n, 'input', c, undefined, { type: 'text', value: n.attrs.value ?? '', readOnly: true, tabIndex: -1 }),
	secret: (n, c) => el(n, 'input', c, undefined, { type: 'password', value: '', readOnly: true, tabIndex: -1 }),
	textarea: (n, c) => el(n, 'textarea', c, undefined, { value: '', readOnly: true, tabIndex: -1 }),
	span: text('span'),
	label: text('span'),
	anchor: text('a'),
	textbox: (n, c) => el(n, tagname(n), c, labelOf(n), attributes(n)),
	selectbox: (n, c) => combo(n, c, 'w2selectbox'),
	autoComplete: (n, c) => combo(n, c, 'w2autoComplete'),
	checkcombobox: (n, c) => combo(n, c, 'w2checkcombobox'),
	// 아래는 엔진 DOM을 따르지 않은 자체 모양(wse-*): 크기·자리만 맞춘다
	multiselect: (n, c) => el(n, 'div', clsx(c, 'wse-listbox'), items(n).map((item, i) => <div key={i}>{item.label}</div>)),
	spinner: (n, c) => el(n, 'div', clsx(c, 'wse-spinner'), <>
		<input value={n.attrs.value ?? ''} readOnly tabIndex={-1} />
		<span><img src={upIcon} alt="" /><img src={downIcon} alt="" /></span>
	</>),
	searchbox: (n, c) => el(n, 'div', clsx(c, 'wse-searchbox'), <><input readOnly tabIndex={-1} /><img src={searchIcon} alt="" /></>),
	output: text('span'),
	calendar: monthCalendar,
	multiupload: (n, c) => el(n, 'div', clsx(c, 'wse-image-empty wse-multiupload'), <span><img src={uploadIcon} alt="" />Multiupload</span>),
	radio: (n, c) => choices(n, c, 'radio'),
	checkbox: (n, c) => choices(n, c, 'checkbox'),
	inputCalendar: calendar,
	pageList,
	gridView: grid,
	wframe: (n, c, d) => el(n, 'div', clsx(c, { 'wse-todo': !n.frame }), n.frame && children(n.frame, d), {
		'data-wse-frame': '',
		'data-tag': n.frame ? undefined : `${n.tag} ${n.attrs.src ?? ''}${n.frameError ? ' — ' + n.frameError : ''}`,
	}),
	tabControl: (n, c, d) => <TabControl key={n.index} node={n} className={c} defs={d} />,
	image: (n, c) => n.url ? el(n, 'img', c, undefined, { src: n.url, alt: n.attrs.alt })
		: el(n, 'div', clsx(c, 'wse-image-empty'), <span><img src={imageIcon} alt="" />Image</span>),
	generator: (n, _c, d) => el(n, tagname(n), n.attrs.class ?? '', children(n, d)),
	upload,
	treeview: (n, c) => el(n, 'div', c, treeNodes(kids(n, 'node'), 1)),
	accordion: (n, c, d) => <Accordion key={n.index} node={n} className={c} defs={d} />,
};

export function render(node: XmlNode, defs: ComponentDef[]): ReactNode {
	const def = defOf(node, defs);
	if (!def && node.ns === XHTML) {
		return el(node, localName(node.tag).toLowerCase(), node.attrs.class ?? '', children(node, defs));
	}
	if (!def) {
		return engineIgnores(node, defs) ? null : el(node, 'div', 'wse-unknown', children(node, defs), { 'data-tag': node.tag });
	}
	const type = def.realType;
	const className = clsx(`w2${CLASS[type] ?? type}`, node.attrs.class);
	const renderer = RENDERERS[type];
	if (renderer) {
		return renderer(node, className, defs);
	}
	if (CONTAINERS.has(type)) {
		const kids = children(node, defs);
		return el(node, tagname(node), className, node.text ? [node.text, ...kids ?? []] : kids, attributes(node));
	}
	return el(node, 'div', clsx(className, 'wse-todo'), undefined, { 'data-tag': node.tag + (node.attrs.src ? ' ' + node.attrs.src : '') });
}

function combo(n: XmlNode, className: string, p: string) {
	return el(n, 'div', className, (
		<table className={`${p}_table_main`}><tbody>
			<tr className={`${p}_row ${p}_row_main`}>
				<td className={`${p}_col_label`}><div className={`${p}_label`}>{comboLabel(n)}</div></td>
				<td className={`${p}_col_button`} />
			</tr>
		</tbody></table>
	));
}

function comboLabel(n: XmlNode) {
	if (n.attrs.chooseOption === 'true') {
		return n.attrs.chooseOptionLabel || '-선택-';
	}
	return n.attrs.allOption === 'true' ? '-전체-' : items(n)[0]?.label ?? '';
}

function choices(n: XmlNode, className: string, kind: 'radio' | 'checkbox') {
	return el(n, 'div', className, items(n).map((item, i) => (
		<div key={i} className={`w2${kind}_item w2${kind}_item_${i}`}>
			<input className={`w2${kind}_input`} type={kind} checked={false} readOnly tabIndex={-1} />
			<label className={`w2${kind}_label`}>{item.label}</label>
		</div>
	)));
}

function calendar(n: XmlNode) {
	const className = clsx('w2inputCalendar_div', `w2inputCalendar_type_${n.attrs.calendarValueType || 'yearMonthDate'}`, n.attrs.class);
	return el(n, 'div', className, <>
		<div className="w2inputCalendar_div_input" style={{ width: 'calc(100% - 26px)', height: '100%' }}>
			<input className="w2inputCalendar_divInput" style={{ width: 'calc(100% - 2px)', height: 'calc(100% - 2px)' }} value="" readOnly tabIndex={-1} />
		</div>
		<div className="w2inputCalendar_div_img"><button className="w2inputCalendar_button" type="button" tabIndex={-1}>달력에서 선택</button></div>
	</>);
}

/** 펼쳐진 달력: 이번 달, 앞뒤 달 날짜는 흐리게 */
function monthCalendar(n: XmlNode, className: string) {
	const now = new Date(), y = now.getFullYear(), m = now.getMonth();
	const first = new Date(y, m, 1).getDay(), last = new Date(y, m + 1, 0).getDate();
	const week = (w: number) => Array.from({ length: 7 }, (_, i) => w * 7 + i - first + 1);
	return el(n, 'div', clsx(className, 'wse-calendar'), <>
		<div className="wse-calendar-head"><img src={leftIcon} alt="" /><span>{y}.{String(m + 1).padStart(2, '0')}</span><img src={rightIcon} alt="" /></div>
		<table>
			<thead><tr>{[...'일월화수목금토'].map(d => <th key={d}>{d}</th>)}</tr></thead>
			<tbody>{[0, 1, 2, 3, 4, 5].map(w => <tr key={w}>{week(w).map(d => (
				<td key={d} className={clsx({ out: d < 1 || d > last, today: d === now.getDate() })}>{new Date(y, m, d).getDate()}</td>
			))}</tr>)}</tbody>
		</table>
	</>);
}

function pageList(n: XmlNode, className: string) {
	const pages = Array.from({ length: Number(n.attrs.pageSize) || 10 }, (_, i) => i + 1);
	return el(n, 'div', className, (
		<table className="w2pageList_table"><tbody><tr>
			<td className="w2pageList_control_pagePrev w2pageList_col_prevPage" />
			<td className="w2pageList_control_prev w2pageList_col_prev" />
			{pages.map(p => (
				<td key={p} className="w2pageList_col_label">
					<div className={clsx('w2pageList_control_label', p === 1 ? 'w2pageList_label_selected' : 'w2pageList_label')}>{p}</div>
				</td>
			))}
			<td className="w2pageList_control_next w2pageList_col_next" />
			<td className="w2pageList_control_pageNext w2pageList_col_nextPage" />
		</tr></tbody></table>
	));
}

function grid(n: XmlNode, className: string) {
	const headerRows = kids(kid(n, 'header'), 'row');
	const bodyRows = kids(kid(n, 'gBody'), 'row');
	const columnsOf = (r: XmlNode) => kids(r, 'column').filter(visible);
	const { cells } = columnLayout([headerRows, bodyRows], columnsOf);
	const widthCells: (XmlNode | undefined)[] = [];
	for (const col of [...headerRows, ...bodyRows].flatMap(columnsOf)) {
		const p = cells.get(col)!;
		if (p.span === 1) { widthCells[p.start] ??= col; }
	}
	const columnCount = Math.max(0, ...[...cells.values()].map(p => p.start + p.span));
	const rowNum = n.attrs.rowNumVisible === 'true';
	const rowStatus = n.attrs.rowStatusVisible === 'true';
	const fixed = (key: 'rowNumber' | 'rowStatus', tag: 'th' | 'td', rows: number, text: ReactNode) => createElement(tag, {
		key,
		'data-wse': kid(n, tag === 'th' ? 'header' : 'gBody')?.index,
		rowSpan: rows > 1 ? rows : undefined,
		className: tag === 'th' ? `gridHeaderTDDefault gridHeaderTDDefault_${key}` : `gridBodyDefault gridBodyDefault_${key}`,
	}, tag === 'th' ? <span className="w2grid_span">{text}</span> : text);
	const widths = [...rowNum ? [num(n.attrs.rowNumWidth, 40)] : [], ...rowStatus ? [num(n.attrs.rowStatusWidth, 40)] : [], ...Array.from({ length: columnCount }, (_, i) => num(widthCells[i]?.attrs.width, 70))];
	const total = widths.reduce((sum, w) => sum + w, 0);
	const fit = !!n.attrs.autoFit && n.attrs.autoFit !== 'none', fitLast = n.attrs.autoFit === 'lastColumn';
	const tableStyle = { tableLayout: 'fixed', borderCollapse: 'collapse', width: fit ? '100%' : total, minWidth: fitLast ? total : undefined } as const;
	const colgroup = <colgroup>
		{widths.map((w, i) => <col key={i} style={{ width: fitLast && i === widths.length - 1 ? undefined : w }} />)}
	</colgroup>;
	const resizeCol = (c: XmlNode) => {
		const p = cells.get(c);
		return p && widthCells[p.start] === c ? widths.length - columnCount + p.start : undefined;
	};
	const footer = kid(n, 'footer');
	return el(n, 'div', className, (<>
		<table className="gridHeaderTableDefault" style={tableStyle}>
			{colgroup}
			<thead className="gridHeaderTableDefault" data-wse={kid(n, 'header')?.index}>
				{headerRows.map((r, i) => (
					<tr key={r.index} data-wse={r.index} className={`gridHeaderStyle_${i}`}>
						{i === 0 && rowNum && fixed('rowNumber', 'th', headerRows.length, n.attrs.rowNumHeaderValue || 'No')}
						{i === 0 && rowStatus && fixed('rowStatus', 'th', headerRows.length, n.attrs.rowStatusHeaderValue || '상태')}
						{columnsOf(r).map(c => cell('th', c, 'gridHeaderTDDefault gridHeaderTDDefault_data', resizeCol(c)))}
					</tr>
				))}
			</thead>
			<tbody data-wse={kid(n, 'gBody')?.index}>
				{bodyRows.map((r, i) => (
					<tr key={r.index} data-wse={r.index} className="grid_body_row">
						{i === 0 && rowNum && fixed('rowNumber', 'td', bodyRows.length, 1)}
						{i === 0 && rowStatus && fixed('rowStatus', 'td', bodyRows.length, '')}
						{columnsOf(r).map(c => cell('td', c, 'gridBodyDefault gridBodyDefault_data', resizeCol(c)))}
					</tr>
				))}
				{kids(n, 'subTotal').flatMap(s => kids(s, 'row').map(r => extraRow(r, s.attrs.subtotalClass ?? 'gridSubtotalDefault', rowNum, rowStatus)))}
			</tbody>
		</table>
		{footer && <table className="gridFooterTableDefault" style={{ ...tableStyle, marginTop: 'auto', flex: 'none' }}>
			{colgroup}
			<tbody>{kids(footer, 'row').map(r => extraRow(r, 'gridFooterTDDefault', rowNum, rowStatus))}</tbody>
		</table>}
	</>), { style: { ...style(n.attrs.style), overflow: 'auto', ...footer && { display: 'flex', flexDirection: 'column', alignItems: 'flex-start' } } });
}

function extraRow(r: XmlNode, className: string, rowNum: boolean, rowStatus: boolean) {
	return <tr key={r.index} data-wse={r.index} className={className}>
		{rowNum && <td className={className} />}
		{rowStatus && <td className={className} />}
		{kids(r, 'column').filter(visible).map(c => cell('td', c, className))}
	</tr>;
}

const INPUT_ICONS: Record<string, string> = {
	link: linkIcon, image: imageIcon, textImage: imageIcon, expression: operatorIcon, textarea: noteIcon, drilldown: treeIcon,
	secret: lockIcon, custom: miscIcon, spinner: unfoldIcon, checkcombobox: checklistIcon, autoComplete: searchIcon,
};

function cell(tag: 'th' | 'td', col: XmlNode, className: string, resizeCol?: number) {
	const type = col.attrs.inputType;
	const icon = tag === 'td' && type ? INPUT_ICONS[type] : undefined;
	const content = type === 'checkbox' ? <><input type="checkbox" checked={false} readOnly tabIndex={-1} /><label className="w2checkbox_label">{col.attrs.checkboxLabel}</label></>
		: tag === 'td' && type === 'radio' ? <input type="radio" checked={false} readOnly tabIndex={-1} />
		: tag === 'td' && type === 'button' ? <button type="button" style={{ width: '100%', height: '100%' }} tabIndex={-1}>{col.attrs.value}</button>
			: icon ? <>{col.attrs.value && <span className="w2grid_span">{col.attrs.value}</span>}<img className="wse-input-icon" src={icon} alt="" title={type} /></>
			: <><span className="w2grid_span">{col.attrs.value ||' '}</span></>;
	return createElement(tag, {
		key: col.index,
		'data-wse': col.index,
		'data-wse-resize': resizeCol,
		className: clsx(className, tag === 'td' && type && type !== 'text' && `gridBodyDefault_${type}`, icon && 'wse-has-input-icon', col.attrs.class),
		style: style(col.attrs.style),
		colSpan: Number(col.attrs.colSpan) > 1 ? Number(col.attrs.colSpan) : undefined,
		rowSpan: Number(col.attrs.rowSpan) > 1 ? Number(col.attrs.rowSpan) : undefined,
	}, content);
}

function TabControl({ node, className, defs }: { node: XmlNode; className: string; defs: ComponentDef[] }) {
	const tabs = kids(node, 'tabs');
	const contents = kids(node, 'content');
	const [active, setActive] = useState(Number(node.attrs.selectedIndex) || 0);
	const content = contents[active];
	return el(node, 'div', className, <>
		<ul className="w2tabcontrol_tabhost">
			{tabs.map((t, i) => (
				<li key={t.index} data-wse={t.index} style={style(t.attrs.style)} onClick={() => setActive(i)}
					className={clsx('w2tabcontrol_li', `w2tabcontrol_li_${i + 1}`, { 'w2tabcontrol_active w2tabcontrol_selected': i === active }, t.attrs.class)}>
					<div className="w2tabcontrol_tab_center"><a>{t.attrs.label}</a></div>
					<div className="w2tabcontrol_tab_left" />
					<div className="w2tabcontrol_tab_right" />
				</li>
			))}
		</ul>
		<div className="w2tabcontrol_container">
			{content && (
				<div className="w2tabcontrol_contents" style={{ display: 'block', visibility: 'visible' }}>
					<div data-wse={content.index} style={style(content.attrs.style)} data-wse-frame={content.attrs.src ? '' : undefined}
						className={clsx('w2group w2tabcontrol_contents_wrapper w2tabcontrol_contents_wrapper_selected', { 'wse-todo': !!content.frameError }, content.attrs.class)}
						data-tag={content.frameError && `${content.tag} ${content.attrs.src} — ${content.frameError}`}>
						{content.frame ? children(content.frame, defs) : children(content, defs)}
					</div>
				</div>
			)}
		</div>
	</>);
}

function upload(n: XmlNode, className: string) {
	return el(n, 'div', className, (
		<form><fieldset>
			<input className="w2upload_input" type="text" readOnly tabIndex={-1} style={{ width: 'calc(100% - 49px)', ...style(n.attrs.inputStyle) }} />
			<span className="w2upload_image" style={style(n.attrs.imageStyle)}>
				<input className="w2upload_fakeInput" type="file" disabled tabIndex={-1} style={{ margin: 0, padding: 0, opacity: 0.01, width: 16 }} />
			</span>
		</fieldset></form>
	), { style: { position: 'relative', ...style(n.attrs.style) } });
}

function treeNodes(nodes: XmlNode[], depth: number): ReactNode {
	return nodes.map((node, i) => {
		const sub = kids(node, 'node'), leaf = !sub.length, last = i === nodes.length - 1;
		const label = kid(node, 'label')?.text ?? '';
		return (
			<div key={node.index} className="w2treeview_group" data-label={label}>
				<table className={clsx('w2treeview_node w2treeview_table_node', leaf ? 'w2treeview_leaf' : 'w2treeview_notleaf',
					{
						'w2treeview_last_leaf': leaf && last,
						'w2treeview_first_sibling': i === 0 && !last,
						'w2treeview_last_sibling': last,
					},
					'w2treeview_open_child')}><tbody>
					<tr className={`w2treeview_row_parent w2treeview_row_depth${depth}`}>
						<td className="w2treeview_col_icon_navi"><div className="w2treeview_icon_navi" /></td>
						<td className="w2treeview_none" />
						<td className="w2treeview_col_label"><span className="w2treeview_label">{label}</span></td>
					</tr>
					{!leaf && (
						<tr className="w2treeview_row_child">
							<td className={last ? `w2treeview_noguideline w2treeview_col_depth${depth}` : `w2treeview_guideline w2treeview_row_depth${depth}`} />
							<td colSpan={2}><div className="w2treeview_child">{treeNodes(sub, depth + 1)}</div></td>
						</tr>
					)}
				</tbody></table>
			</div>
		);
	});
}

function Accordion({ node, className, defs }: { node: XmlNode; className: string; defs: ComponentDef[] }) {
	const [open, setOpen] = useState(new Set([0]));
	const toggle = (i: number) => setOpen(s => {
		const next = new Set(s);
		if (!next.delete(i)) {
			next.add(i);
		}
		return next;
	});
	return el(node, 'div', className, (
		<div>
			{kids(node, 'panels').map((p, i) => {
				const title = kid(p, 'panelTitle'), content = kid(p, 'panelContent');
				return (
					<div key={p.index} data-wse={p.index} style={style(p.attrs.style)} className={clsx('w2panels', p.attrs.class)}>
						<div className="w2panels_title" role="button" aria-expanded={open.has(i)} onClick={() => toggle(i)}>
							<div className={clsx('w2panels_title_image', { 'w2panels_title_image_open': open.has(i) })} />
							{title && <span data-wse={title.index} style={style(title.attrs.style)} className={clsx('w2panel_title_text', title.attrs.class)}>{title.attrs.label}</span>}
						</div>
						{content && (
							<div data-wse={content.index} style={style(content.attrs.style)}
								className={clsx('w2group w2panels_content_closed', { 'w2panels_content_open': open.has(i) }, content.attrs.class)}>
								{children(content, defs)}
							</div>
						)}
					</div>
				);
			})}
		</div>
	));
}

function el(n: XmlNode, tag: string, className: string, content?: ReactNode, extra?: object) {
	return createElement(tag, { key: n.index, 'data-wse': n.index, id: n.attrs.id || undefined, style: style(n.attrs.style), className, ...extra }, VOID.has(tag) ? undefined : content);
}

/** 자식이 없으면 undefined: void 요소(`<col>` 등)에 빈 배열을 주면 React가 에러를 낸다 */
function children(n: XmlNode, defs: ComponentDef[]) {
	const list = n.children.filter(c => c.tag !== 'w2:attributes').map(c => render(c, defs));
	return list.length ? list : undefined;
}

function attributes(n: XmlNode) {
	return Object.fromEntries((kid(n, 'attributes')?.children ?? []).map(a => [ATTR[localName(a.tag)] ?? localName(a.tag), a.text ?? '']));
}

function items(n: XmlNode) {
	return kids(kid(n, 'choices'), 'item').map(i => ({ label: kid(i, 'label')?.text ?? '' }));
}

const labelOf = (n: XmlNode) => n.attrs.label ?? kid(n, 'label')?.text ?? n.text;
const tagname = (n: XmlNode) => n.attrs.tagname?.toLowerCase() || 'div';
const visible = (col: XmlNode) => col.attrs.hidden !== 'true';
const num = (v: string | undefined, fallback: number) => Number(v) || fallback;

function style(text?: string): CSSProperties | undefined {
	try {
		return text ? styleToJs(text) as CSSProperties : undefined;
	} catch {
		return undefined;
	}
}

export interface TextTarget { index: number; attr?: string; value?: string }

const LABELED = new Set(['textbox', 'span', 'anchor', 'tabs', 'output']);

export function textTarget(node: XmlNode, def?: ComponentDef): TextTarget | undefined {
	const type = def?.realType;
	if (node.attrs.label !== undefined) {
		return { index: node.index, attr: 'label', value: node.attrs.label };
	}
	const label = kid(node, 'label');
	if (type && label && !CONTAINERS.has(type)) {
		return { index: label.index, value: label.text };
	}
	if (type === 'column') {
		const input = node.attrs.inputType ?? 'text';
		return input === 'text' || input === 'button' ? { index: node.index, attr: 'value', value: node.attrs.value } : undefined;
	}
	if (type && LABELED.has(type)) {
		return { index: node.index, attr: 'label' };
	}
	const textual = type ? CONTAINERS.has(type) || type === 'label' : node.ns === XHTML;
	const onlyText = node.children.every(c => localName(c.tag) === 'attributes');
	return textual && (node.text !== undefined || onlyText) ? { index: node.index, value: node.text } : undefined;
}

export function outlineChildren(node: XmlNode, defs: ComponentDef[]): XmlNode[] {
	const type = defOf(node, defs)?.realType;
	const caption = type && !CONTAINERS.has(type) ? kid(node, 'label') : undefined;
	return node.children.filter(c => !['attributes', 'choices'].includes(localName(c.tag)) && c !== caption && !engineIgnores(c, defs));
}

const engineIgnores = (n: XmlNode, defs: ComponentDef[]) =>
	n.def === undefined && !n.udc && defs.length > 0 && (n.ns === WEBSQUARE_NS || n.ns === XFORMS_NS);

export function outlineIcon(node: XmlNode, defs: ComponentDef[]): string {
	const type = defOf(node, defs)?.realType;
	return (type && COMPONENT_ICONS[type]) || (node.ns === XHTML ? 'code' : 'symbol-misc');
}
