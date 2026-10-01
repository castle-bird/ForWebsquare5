import type { ComponentDef } from './protocol';
import { eolOf, type TextEdit } from './edit';
import { insertNode, isContainer, type InsertPosition } from './paste';
import { gridColumnXml } from './grid';
import { setStyle } from './style';
import { localName, uniqueId, usedIds, XFORMS_NS, type XmlNode } from './xmlModel';

const isBody = (n: XmlNode) => localName(n.tag) === 'body';

const DATA_TYPE = /^(alias)?(linked)?data(map|list)$/i;

export const paletteDefs = (defs: ComponentDef[]) =>
	defs.filter(d => !d.hidden && d.category && d.display && !d.parents.length && d.realType !== 'body' && !DATA_TYPE.test(d.realType));

export function matchPalette(defs: ComponentDef[], query: string): ComponentDef[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return defs.filter(d => {
		const hay = `${d.display} ${d.id} ${d.realType} ${d.category}`.toLowerCase();
		return words.every(w => hay.includes(w));
	});
}

export function insertTarget(root: XmlNode, path: XmlNode[] | undefined): XmlNode | undefined {
	const body = root.children.find(isBody);
	if (!body || !path?.includes(body)) {
		return body;
	}
	return path.find(n => n.tag.endsWith(':gridView')) ?? path.at(-1);
}

export const insertPositions = (target: XmlNode): InsertPosition[] =>
	isBody(target) ? ['first', 'inside']
		: isContainer(target) ? ['first', 'inside', 'before', 'after'] : ['before', 'after'];

export function insertComponent(text: string, root: XmlNode, target: XmlNode, position: InsertPosition, def: ComponentDef, size?: Record<string, string>): { edit: TextEdit; id: string } {
	const prefix = (ns: string) => {
		if (root.attrs.xmlns === ns) { return ''; }
		const decl = Object.keys(root.attrs).find(k => k.startsWith('xmlns:') && root.attrs[k] === ns);
		if (!decl) { throw new Error(`화면에 ${ns} 네임스페이스 선언이 없어 넣을 수 없습니다.`); }
		return decl.slice(6) + ':';
	};
	const p = prefix(def.ns);
	const used = usedIds(root);
	const next = (base: string) => uniqueId(used, base);
	const id = next(def.realType);
	const eol = eolOf(text);
	const unit = /^([ \t]+)</m.exec(text)?.[1] ?? '\t';
	const style = size && Object.keys(size).length ? ` style="${setStyle(undefined, size)}"` : '';
	const x = () => prefix(XFORMS_NS);
	const choices = () => [`<${x()}choices></${x()}choices>`];
	const shape: Record<string, () => { attrs?: string; children?: string[] }> = {
		selectbox: () => ({ attrs: ' appearance="minimal"', children: choices() }),
		multiselect: () => ({ attrs: ' appearance="minimal"', children: choices() }),
		radio: () => ({ attrs: ' appearance="full"', children: choices() }),
		checkbox: () => ({ attrs: ' appearance="full"', children: choices() }),
		trigger: () => ({ children: [`<${x()}label><![CDATA[${def.display ?? def.realType}]]></${x()}label>`] }),
		anchor: () => ({ children: [`<${x()}label><![CDATA[${def.display ?? def.realType}]]></${x()}label>`] }),
		gridView: () => ({
			children: [['header', 'header'], ['gBody', 'gBody']].flatMap(([part, base]) => [
				`<${p}${part} id="${next(base)}">`,
				`${unit}<${p}row id="${next('row')}">`,
				`${unit}${unit}${gridColumnXml(p, `id="${next('column')}"`)}`,
				`${unit}</${p}row>`,
				`</${p}${part}>`,
			]),
		}),
		tabControl: () => ({ children: [`<${p}tabs id="${next('tabs')}" label="Tab1"></${p}tabs>`, `<${p}content id="${next('content')}"></${p}content>`] }),
	};
	const { attrs = '', children } = shape[def.realType]?.() ?? {};
	const open = `<${p}${def.id} id="${id}"${style}${attrs}`;
	const xml = children
		? [`${open}>`, ...children.map(line => unit + line), `</${p}${def.id}>`].join(eol)
		: `${open}/>`;
	return { edit: insertNode(text, target, position, xml), id };
}
