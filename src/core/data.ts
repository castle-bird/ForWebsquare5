import { insertNode } from './paste';
import { parseXml, prefixOf, uniqueId, usedIds, VALID_ID, WEBSQUARE_NS, type XmlNode } from './xmlModel';
import { applyEdits, eolOf, escapeText, INVALID_XML_CHAR, leadOf, setAttribute, setText, sourceChange, startTagEnd, type TextEdit } from './edit';

export const DATA_KINDS = ['dataList', 'dataMap', 'linkedDataList', 'aliasDataList', 'aliasDataMap'] as const;
export type DataKind = typeof DATA_KINDS[number];
export const DATA_TYPES = ['text', 'number', 'bigDecimal', 'date', 'time'];
export interface DataField { sourceIndex?: number; id: string; name: string; dataType: string; length: string; encYN: boolean; value?: string }

export function addDataNode(text: string, root: XmlNode, collection: XmlNode, kind: DataKind): TextEdit {
	if (collection.ns !== WEBSQUARE_NS || !collection.tag.endsWith(':dataCollection') || !DATA_KINDS.includes(kind)) {
		throw new Error('DataCollection에 추가할 수 없는 항목입니다.');
	}
	const prefix = collection.tag.slice(0, -'dataCollection'.length);
	const attrs = `id="${uniqueId(usedIds(root), kind)}"`;
	const xml = kind === 'dataMap' ? `<${prefix}${kind} ${attrs} baseNode="map"><${prefix}keyInfo/></${prefix}${kind}>`
		: kind === 'dataList' ? `<${prefix}${kind} ${attrs} baseNode="vector" repeatNode="map" valueAttribute=""><${prefix}columnInfo/></${prefix}${kind}>`
			: kind === 'linkedDataList' ? `<${prefix}${kind} ${attrs} baseNode="vector" repeatNode="map" valueAttribute="" bind=""/>`
				: `<${prefix}${kind} ${attrs} scope=""/>`;
	return insertNode(text, collection, 'inside', xml);
}

export function editDataFields(text: string, root: XmlNode, node: XmlNode, fields: DataField[], id?: string): TextEdit | undefined {
	const map = node.ns === WEBSQUARE_NS && node.tag.endsWith(':dataMap');
	const list = node.ns === WEBSQUARE_NS && node.tag.endsWith(':dataList');
	if (!map && !list) { throw new Error('DataMap 또는 DataList만 편집할 수 있습니다.'); }
	const prefix = prefixOf(node.tag);
	const infoTag = prefix + (map ? 'keyInfo' : 'columnInfo');
	const rowTag = prefix + (map ? 'key' : 'column');
	const info = node.children.find(c => c.tag === infoTag);
	if (!info) { throw new Error(`${infoTag}가 없습니다. Source 탭에서 확인해 주세요.`); }
	const originals = new Map(info.children.filter(c => c.tag === rowTag).map(c => [c.index, c]));
	const ids = new Set<string>();
	for (const field of fields) {
		if ([field.name, field.value ?? ''].some(value => INVALID_XML_CHAR.test(value))) { throw new Error('XML에 사용할 수 없는 문자가 있습니다.'); }
		if (!VALID_ID.test(field.id) || ids.has(field.id)) { throw new Error(`ID가 비어 있거나 중복되었거나 XML 이름으로 사용할 수 없습니다: ${field.id}`); }
		if (!DATA_TYPES.includes(field.dataType)) { throw new Error(`지원하지 않는 dataType: ${field.dataType}`); }
		if (field.length && !/^\d+$/.test(field.length)) { throw new Error('length는 0 이상의 정수여야 합니다.'); }
		ids.add(field.id);
		if (field.sourceIndex !== undefined && !originals.has(field.sourceIndex)) { throw new Error('원본 행이 변경되었습니다. 다시 열어 주세요.'); }
	}
	let idEdit: TextEdit | undefined;
	if (id !== undefined && id !== node.attrs.id) {
		if (!VALID_ID.test(id)) { throw new Error(`올바른 ID를 입력해 주세요: ${id}`); }
		if (usedIds(root, node).has(id)) { throw new Error(`이미 사용 중인 ID입니다: ${id}`); }
		idEdit = setAttribute(text, node, 'id', id);
	}
	const openEnd = startTagEnd(text, info.start);
	const selfClosing = text[openEnd - 1] === '/';
	const innerEnd = selfClosing ? openEnd + 1 : text.lastIndexOf('</', info.end - 1);
	let rest = text.slice(openEnd + 1, innerEnd);
	for (const child of [...info.children].reverse()) { rest = rest.slice(0, child.start - openEnd - 1) + rest.slice(child.end - openEnd - 1); }
	if (rest.trim()) { throw new Error('keyInfo/columnInfo 안에 다른 내용이 있어 Source 탭에서 편집해야 합니다.'); }
	const indent = leadOf(text, info.start) ?? '';
	const eol = eolOf(text);
	const rowXml = fields.map(field => {
		const original = field.sourceIndex === undefined ? undefined : originals.get(field.sourceIndex);
		let raw = original ? text.slice(original.start, original.end) : `<${rowTag}/>`;
		for (const [attr, value] of Object.entries({ id: field.id, name: field.name, dataType: field.dataType, length: field.length || undefined, encYN: field.encYN ? 'true' : undefined })) {
			raw = applyEdits(raw, [setAttribute(raw, parseXml(raw)!, attr, value)]);
		}
		return raw;
	});
	const infoOpen = text.slice(info.start, openEnd + 1).replace(/\s*\/?>$/, '>');
	const infoXml = rowXml.length
		? `${infoOpen}${eol}${rowXml.map(raw => `${indent}\t${raw}`).join(eol)}${eol}${indent}</${infoTag}>`
		: selfClosing ? text.slice(info.start, info.end) : `${infoOpen}</${infoTag}>`;
	const replacements = [{ start: info.start, end: info.end, replacement: infoXml }, ...idEdit ? [idEdit] : []];
	const data = map ? node.children.find(c => c.tag === `${prefix}data`) : undefined;
	const values = new Map(data?.children.map(c => [c.tag, c]) ?? []);
	const previousIds = new Set([...originals.values()].map(c => c.attrs.id));
	const changedValue = fields.some(f => f.value !== undefined && f.value !== (values.get(f.id)?.text ?? ''));
	const removedValue = [...previousIds].some(pid => !ids.has(pid) && values.has(pid));
	if (map && (changedValue || removedValue)) {
		const dataTagEnd = data ? startTagEnd(text, data.start) : -1;
		const dataSelfClosing = data ? text[dataTagEnd - 1] === '/' : false;
		if (data) {
			const from = dataTagEnd + 1;
			const to = dataSelfClosing ? from : text.lastIndexOf('</', data.end - 1);
			let remaining = text.slice(from, to);
			for (const child of [...data.children].reverse()) { remaining = remaining.slice(0, child.start - from) + remaining.slice(child.end - from); }
			if (remaining.trim()) { throw new Error('w2:data 안에 다른 내용이 있어 Source 탭에서 편집해야 합니다.'); }
		}
		const valueRows = fields.filter(f => f.value || values.has(f.id)).map(f => {
			const old = values.get(f.id);
			if (old) {
				if (old.children.length && f.value !== undefined && f.value !== (old.text ?? '')) { throw new Error(`${f.id} 값에 하위 노드가 있어 Source 탭에서 편집해야 합니다.`); }
				const change = f.value === undefined ? undefined : setText(text, old, f.value);
				return change ? text.slice(old.start, change.start) + change.replacement + text.slice(change.end, old.end) : text.slice(old.start, old.end);
			}
			return `<${f.id}>${escapeText(f.value ?? '')}</${f.id}>`;
		});
		for (const child of data?.children ?? []) {
			if (!previousIds.has(child.tag) && !ids.has(child.tag)) { valueRows.push(text.slice(child.start, child.end)); }
		}
		const dataOpen = data ? text.slice(data.start, dataTagEnd + 1).replace(/\s*\/?>$/, '>') : `<${prefix}data use="true">`;
		const dataXml = `${dataOpen}${valueRows.length ? `${eol}${valueRows.map(raw => `${indent}\t${raw}`).join(eol)}${eol}${indent}` : ''}</${prefix}data>`;
		if (data) { replacements.push({ start: data.start, end: data.end, replacement: dataXml }); }
		else {
			const insertAt = node.end - `</${node.tag}>`.length;
			replacements.push({ start: insertAt, end: insertAt, replacement: `${eol}${indent}\t${dataXml}${eol}${indent}` });
		}
	}
	const updated = applyEdits(text.slice(node.start, node.end), replacements.map(r => ({ ...r, start: r.start - node.start, end: r.end - node.start })));
	const change = sourceChange(text.slice(node.start, node.end), updated);
	return change && { ...change, start: change.start + node.start, end: change.end + node.start };
}

/** 컬럼·키를 직접 갖는 데이터(dataMap·dataList) */
export const isDataNode = (n: XmlNode) => /:(dataMap|dataList)$/.test(n.tag);

/** 데이터 노드(dataList·dataMap·linkedDataList·alias…) */
export const isDataKind = (node: XmlNode) => node.ns === WEBSQUARE_NS && DATA_KINDS.some(kind => node.tag.endsWith(':' + kind));

/** 데이터 노드 id(from → to, 그대로면 같은 값)와 그 안 컬럼·키 id(옛 → 새) 바꾸기 */
export interface DataRename { from: string; to: string; columns?: Map<string, string> }

// id에 올 수 있는 글자: 영문·숫자·_·.·-(VALID_ID)
const idPattern = (id: string) => id.replace(/[.-]/g, '\\$&');

/**
 * 데이터 id·컬럼 id를 바꿀 때 가리키는 곳도 바꾸는 편집. Script 안 참조(dlt_a.getRowCount())는 그대로
 * - "data:"로 시작하는 속성 값(ref·nodeset·dataList·target, `data:json,["dlt_a"]`·`{"id":"dlt_a"}` 포함)의 데이터 id와 `data:dlt_a.col`의 컬럼
 * - linkedDataList의 bind
 * - 그 dataList에 바인딩된 gridView 본문(gBody) column id, 그 데이터에 바인딩된 itemset의 label·value ref(컬럼 이름)
 * 더 긴 이름(dlt_a2·col2)은 안 건드린다
 */
export function renameDataRefs(text: string, root: XmlNode, { from, to, columns }: DataRename): TextEdit[] {
	const token = new RegExp(String.raw`(?<![\w.-])` + idPattern(from) + String.raw`(?![\w-])`, 'g');
	const column = columns?.size ? new RegExp(String.raw`(?<![\w.-])` + idPattern(from) + String.raw`\.(` + [...columns.keys()].map(idPattern).join('|') + String.raw`)(?![\w.-])`, 'g') : undefined;
	const bound = `data:${from}`;
	const edits: TextEdit[] = [];
	/** scope: 이 데이터에 바인딩된 그리드 안·그 본문 안·itemset 안 */
	const walk = (node: XmlNode, ancestors: XmlNode[], scope?: 'grid' | 'gridBody' | 'itemset') => {
		const local = (name: string, value: string) => columns && (scope === 'gridBody' && name === 'id' && node.tag.endsWith(':column')
			|| scope === 'itemset' && name === 'ref') ? columns.get(value) : undefined;
		for (const [name, value] of Object.entries(node.attrs)) {
			const next = value.startsWith('data:') ? (column ? value.replace(column, (_m, c: string) => `${from}.${columns!.get(c)}`) : value).replace(token, () => to)
				: name === 'bind' && value === from && isDataKind(node) ? to : local(name, value) ?? value;
			const edit = next !== value ? setAttribute(text, node, name, next, ancestors) : undefined;
			if (edit) { edits.push(edit); }
		}
		const inner = node.tag.endsWith(':gridView') ? (node.attrs.dataList === bound ? 'grid' : undefined)
			: node.tag.endsWith(':itemset') ? (node.attrs.nodeset === bound ? 'itemset' : undefined)
			: scope === 'grid' && node.tag.endsWith(':gBody') ? 'gridBody' : scope;
		node.children.forEach(c => walk(c, [...ancestors, node], inner));
	};
	walk(root, []);
	return edits;
}
