import { encodeScript, eolOf, escape, lineIndent, startTagEnd, withAttrs, type TextEdit } from './edit';
import { kid, localName, pathTo, prefixOf, type XmlNode } from './xmlModel';

export interface ChoiceItem { label: string; value: string }
export interface ItemSet { nodeset: string; label: string; value: string }
export interface Choices { items: ChoiceItem[]; itemset?: ItemSet }
export interface ChoicesFields extends Choices { attrs: Record<string, string | undefined> }

const simple = (n: XmlNode, names: string[], attrs: string[] = []) =>
	n.children.every(c => names.includes(localName(c.tag))) && Object.keys(n.attrs).every(a => attrs.includes(a));

export function readChoices(node: XmlNode): Choices | { error: string } {
	const choices = kid(node, 'choices');
	if (!choices) { return { items: [] }; }
	const complex = { error: '선택 항목 구조가 복잡해서 이 팝업으로는 고칠 수 없어. Source 탭에서 고쳐 줘.' };
	const itemsets = choices.children.filter(c => localName(c.tag) === 'itemset');
	if (itemsets.length) {
		const set = itemsets[0], label = kid(set, 'label'), value = kid(set, 'value');
		if (itemsets.length > 1 || choices.children.length > 1 || !simple(set, ['label', 'value'], ['nodeset'])
			|| [label, value].some(n => n && (n.children.length || n.text || !simple(n, [], ['ref'])))) { return complex; }
		return { items: [], itemset: { nodeset: set.attrs.nodeset ?? '', label: label?.attrs.ref ?? '', value: value?.attrs.ref ?? '' } };
	}
	if (!choices.children.every(c => localName(c.tag) === 'item' && simple(c, ['label', 'value'])
		&& c.children.every(p => !p.children.length && !Object.keys(p.attrs).length))) { return complex; }
	return { items: choices.children.map(i => ({ label: kid(i, 'label')?.text ?? '', value: kid(i, 'value')?.text ?? '' })) };
}

export function editChoices(text: string, root: XmlNode, node: XmlNode, fields: ChoicesFields): TextEdit | undefined {
	if (!/^(select1?|column)$/.test(localName(node.tag))) { throw new Error('선택 항목은 selectbox·radio·checkbox·그리드 select 컬럼에서만 편집할 수 있어.'); }
	const current = readChoices(node);
	if ('error' in current) { throw new Error(current.error); }
	const choices = kid(node, 'choices');
	if (choices && /<!--/.test(text.slice(choices.start, choices.end))) { throw new Error('선택 항목에 주석이 있어 이 팝업으로는 고칠 수 없어. Source 탭에서 고쳐 줘.'); }
	if (fields.itemset && !fields.itemset.nodeset) { throw new Error('바인딩할 NodeSet을 골라 줘.'); }

	const eol = eolOf(text), p = prefixOf(node.tag);
	const tagEnd = startTagEnd(text, node.start) + 1;
	const tag = text.slice(node.start, tagEnd), selfClosing = tag.endsWith('/>');
	const attrs = Object.entries(fields.attrs).filter(([name, value]) => value !== node.attrs[name]);
	const empty = withAttrs(selfClosing ? tag : `${tag.slice(0, -1)}/>`, attrs, pathTo(root, node.index)?.slice(0, -1));
	const open = empty.replace(/\s*\/>$/, '>');
	const next: Choices = fields.itemset ? { items: [], itemset: fields.itemset } : { items: fields.items };
	const choicesChanged = JSON.stringify(next) !== JSON.stringify({ items: current.items, ...current.itemset && { itemset: current.itemset } });
	if (!choicesChanged) {
		return attrs.length ? { start: node.start, end: tagEnd, replacement: selfClosing ? empty : open } : undefined;
	}

	const indent = lineIndent(text, node.start);
	const unit = /^ +$/.test(indent) ? '    ' : '\t';
	const xml = (at: string) => choicesXml(next, p, at, unit, eol);
	if (choices) {
		return { start: node.start, end: choices.end, replacement: open + text.slice(tagEnd, choices.start) + xml(lineIndent(text, choices.start)) };
	}
	const inner = indent + unit;
	if (selfClosing) {
		return { start: node.start, end: tagEnd, replacement: `${open}${eol}${inner}${xml(inner)}${eol}${indent}</${node.tag}>` };
	}
	const close = text.lastIndexOf('</', node.end - 1);
	return node.children.length
		? { start: node.start, end: tagEnd, replacement: `${open}${eol}${inner}${xml(inner)}` }
		: { start: node.start, end: close, replacement: `${open}${eol}${inner}${xml(inner)}${eol}${indent}` };
}

function choicesXml({ items, itemset }: Choices, p: string, at: string, unit: string, eol: string): string {
	const i1 = at + unit, i2 = i1 + unit;
	const cdata = (v: string) => `<![CDATA[${encodeScript(v, true)}]]>`;
	const body = itemset
		? [`${i1}<${p}itemset nodeset="${escape(itemset.nodeset, '"')}">`,
			`${i2}<${p}label ref="${escape(itemset.label, '"')}"></${p}label>`,
			`${i2}<${p}value ref="${escape(itemset.value, '"')}"></${p}value>`,
			`${i1}</${p}itemset>`]
		: items.flatMap(it => [`${i1}<${p}item>`, `${i2}<${p}label>${cdata(it.label)}</${p}label>`, `${i2}<${p}value>${cdata(it.value)}</${p}value>`, `${i1}</${p}item>`]);
	return body.length ? [`<${p}choices>`, ...body, `${at}</${p}choices>`].join(eol) : `<${p}choices></${p}choices>`;
}
