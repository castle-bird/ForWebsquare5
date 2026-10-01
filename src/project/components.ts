import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { parseDocument } from 'htmlparser2';
import type { Element } from 'domhandler';
import { localName, type XmlNode } from '../core/xmlModel';
import type { ComponentDef } from '../core/protocol';
import { childTags } from './config';
import { cached, findDirs, numeric } from './paths';

export type { ComponentDef };

export function parseComponents(xml: string): ComponentDef[] {
	const doc = parseDocument(xml, { xmlMode: true });
	const list = (n: Element | undefined, name: string) => {
		const c = n && childTags(n).find(e => e.name === name);
		return c ? childTags(c) : [];
	};
	const root = childTags(doc).find(c => c.name === 'WebSquare');
	if (!root) {
		throw new Error('<WebSquare> 정의 파일이 아닙니다.');
	}
	return list(root, 'components').filter(c => c.name === 'component').map(c => ({
		id: c.attribs.id,
		ns: c.attribs.namespaceURI ?? '',
		realType: c.attribs.realType ?? '',
		display: c.attribs.display && c.attribs.display !== 'NULL' ? c.attribs.display : undefined,
		category: c.attribs.category || undefined,
		hidden: c.attribs.visible === 'false' || undefined,
		description: c.attribs.componentDesc || undefined,
		parents: list(c, 'parents').map(p => p.attribs.id),
		bases: list(c, 'baseComponents').map(p => p.attribs.id),
		properties: list(c, 'properties').map(p => {
			const order = Number(p.attribs.maincategoryorder);
			const options = [...new Set(childTags(p).filter(o => o.name === 'option').map(o => o.attribs.value ?? o.attribs.name).filter(Boolean))];
			return {
				name: p.attribs.name,
				category: p.attribs.maincategory || 'Basic & ETC',
				order: p.attribs.maincategoryorder && Number.isFinite(order) ? order : 99,
				description: p.attribs.description ?? '',
				options: options.length ? options : /^boolean$|^\[true, ?false\]$/i.test(p.attribs.type ?? '') ? ['true', 'false'] : undefined,
			};
		}),
		events: list(c, 'events').map(e => {
			const signature = e.attribs.name;
			const name = signature.replace(/\(.*$/, '');
			return { name, signature, description: signature === name ? e.attribs.description ?? '' : `${signature}\n${e.attribs.description ?? ''}` };
		}),
	}));
}

export function annotate(root: XmlNode, defs: ComponentDef[], udcs: ReadonlySet<string> = new Set()): void {
	const byKey = new Map<string, number[]>();
	defs.forEach((d, i) => {
		const key = d.ns + ' ' + d.id;
		byKey.set(key, [...byKey.get(key) ?? [], i]);
	});
	const walk = (node: XmlNode, ancestors: string[]) => {
		let candidates = byKey.get(node.ns + ' ' + localName(node.tag)) ?? [];
		const narrow = (keep: (d: ComponentDef) => boolean) => {
			const kept = candidates.filter(i => keep(defs[i]));
			if (kept.length) {
				candidates = kept;
			}
		};
		if (candidates.length > 1) {
			narrow(d => d.parents.includes(ancestors[0]));
			narrow(d => d.bases.some(b => ancestors.includes(b)));
			const full = node.attrs.appearance === 'full';
			narrow(d => ['radio', 'checkbox'].includes(d.realType) === full);
		}
		node.def = candidates[0];
		if (node.def === undefined && udcs.has(localName(node.tag))) {
			node.udc = true;
		}
		node.children.forEach(c => walk(c, [localName(node.tag), ...ancestors]));
	};
	walk(root, []);
}

export async function findDefinitionFile(eclipseRoot: string): Promise<string | undefined> {
	const versionDirs = await findDirs(eclipseRoot, (dir, names) =>
		names.includes('WebSquareConfig.xml') && path.basename(path.dirname(dir)) === 'config');
	const best = versionDirs.sort(numeric).pop();
	return best && path.join(best, 'WebSquareConfig.xml');
}

const componentCache = new Map<string, Promise<ComponentDef[]>>();
export const loadComponents = (file: string) => cached(componentCache, file, () => readFile(file, 'utf8').then(parseComponents));

export function parseDefaultStyles(xml: string): Map<string, Record<string, string>> {
	const components = childTags(parseDocument(xml, { xmlMode: true })).find(c => c.name === 'components');
	const own = new Map((components ? childTags(components) : []).filter(c => c.name === 'component').map(c => [c.attribs.id, {
		base: c.attribs.extends,
		props: Object.fromEntries(childTags(c).filter(p => p.name === 'property' && p.attribs.name).map(p => [p.attribs.name, p.attribs.value ?? ''])),
	}]));
	const resolve = (id: string | undefined, seen: Set<string>): Record<string, string> => {
		const c = id === undefined || seen.has(id) ? undefined : own.get(id);
		return c ? { ...resolve(c.base, seen.add(id!)), ...c.props } : {};
	};
	return new Map([...own.keys()].filter(id => !id.startsWith('__')).map(id => [id, resolve(id, new Set())]));
}

const defaultStyleCache = new Map<string, Promise<Map<string, Record<string, string>>>>();
export const loadDefaultStyles = (definitionFile: string) => cached(defaultStyleCache, definitionFile,
	() => readFile(path.join(path.dirname(definitionFile), 'ComponentDefaultStyle.xml'), 'utf8').then(parseDefaultStyles))
	.catch(() => new Map<string, Record<string, string>>());
