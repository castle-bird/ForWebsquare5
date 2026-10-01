import { readFile, stat } from 'node:fs/promises';
import { DomUtils, parseDocument } from 'htmlparser2';
import type { Document, Element, ParentNode } from 'domhandler';
import { configFile } from './paths';

export const childTags = (n: ParentNode): Element[] => n.children.filter(DomUtils.isTag);

const configCache = new Map<string, { mtime: number; doc: Promise<Document> }>();

export async function readWebConfig(webRoot: string): Promise<Document> {
	const file = configFile(webRoot);
	const { mtimeMs } = await stat(file);
	const hit = configCache.get(file);
	if (hit?.mtime === mtimeMs) {
		return hit.doc;
	}
	const doc = readFile(file, 'utf8').then(text => parseDocument(text, { xmlMode: true }));
	configCache.set(file, { mtime: mtimeMs, doc });
	doc.catch(() => configCache.delete(file));
	return doc;
}
