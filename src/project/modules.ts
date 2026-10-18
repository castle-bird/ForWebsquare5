import { readFile } from 'node:fs/promises';
import { DomUtils } from 'htmlparser2';
import { readWebConfig } from './config';
import { ENGINE_PAGE, fromWebPath } from './paths';

interface ModuleFile { path: string; text: string }

export async function udcNames(webRoot: string): Promise<Set<string>> {
	const udc = DomUtils.findOne(e => e.name === 'udc', (await readWebConfig(webRoot)).children);
	return new Set(udc ? DomUtils.findAll(e => e.name === 'require' && !!e.attribs.as, udc.children).map(e => e.attribs.as) : []);
}

export async function engineModules(webRoot: string): Promise<{ files: ModuleFile[]; failed: string[] }> {
	const engine = DomUtils.findOne(e => e.name === 'engine', (await readWebConfig(webRoot)).children);
	const srcs = engine ? DomUtils.findAll(e => e.name === 'module' && !!e.attribs.src, engine.children).map(e => e.attribs.src) : [];
	const loaded = await Promise.all(srcs.map(async src => {
		try {
			return { src, text: await readFile(fromWebPath(webRoot, src, ENGINE_PAGE), 'utf8') };
		} catch {
			return { src };
		}
	}));
	const files: ModuleFile[] = [], failed: string[] = [];
	for (const r of loaded) {
		if (r.text !== undefined) { files.push({ path: r.src, text: r.text }); } else { failed.push(r.src); }
	}
	return { files, failed };
}
