import { readFile, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { DomUtils, parseDocument } from 'htmlparser2';
import type { ApiParam, ApiReturn, ScriptApi } from '../core/protocol';
import { errorMessage } from '../core/errors';
import { cached, findDirs } from './paths';

const API_DIR = /^(\$p(?:\.|$)|WebSquare(?:\.|$))/;

const hasClass = (name: string) => (e: { attribs?: Record<string, string> }) => (e.attribs?.class ?? '').split(/\s+/).includes(name);

function parseDetailList(doc: ReturnType<typeof parseDocument>, tagClass: string, descClass: string): ScriptApi[string] {
	const dts = DomUtils.findAll(hasClass(tagClass), doc.children);
	return dts.flatMap(dt => {
		const rawSig = DomUtils.textContent(dt).replace(/\s+/g, ' ').trim();
		const name = rawSig.split('(')[0].trim();
		if (!/^[\w$]+$/.test(name)) { return []; }

		let dd = dt.next;
		while (dd && dd.type !== 'tag') { dd = dd.next; }

		let description = '';
		const params: ApiParam[] = [];
		const returns: ApiReturn[] = [];
		let sample: string | undefined;

		if (dd) {
			const desc = DomUtils.findOne(hasClass(descClass), dd.children);
			if (desc) { description = DomUtils.textContent(desc).trim(); }

			const tables = DomUtils.findAll(e => e.name === 'table', dd.children);
			for (const tbl of tables) {
				const cap = DomUtils.findOne(e => e.name === 'caption', tbl.children);
				const capText = cap ? DomUtils.textContent(cap).trim() : '';
				const rows = DomUtils.findAll(e => e.name === 'tr', tbl.children).slice(1)
					.map(tr => DomUtils.findAll(e => e.name === 'td', tr.children).map(td => DomUtils.textContent(td).trim()));
				if (capText === 'Parameter') {
					params.push(...rows.filter(tds => tds.length >= 3)
						.map(tds => ({ name: tds[0], type: tds[1], required: tds.length >= 4 ? tds[2] : '', description: tds[tds.length - 1] })));
				} else if (capText === 'Return') {
					returns.push(...rows.filter(tds => tds.length >= 2).map(tds => ({ type: tds[0], description: tds[1] })));
				}
			}

			const xmp = DomUtils.findOne(e => e.name === 'xmp', dd.children);
			if (xmp) { sample = DomUtils.textContent(xmp).trim(); }
		}

		return [{
			name,
			signature: rawSig,
			description,
			...params.length && { params },
			...returns.length && { returns },
			...sample && { sample },
		}];
	});
}

export function parseApiMethods(html: string): ScriptApi[string] {
	const doc = parseDocument(html);
	const methods = parseDetailList(doc, 'apiname', 'pdesc');
	if (methods.length > 0) {
		return methods;
	}
	return DomUtils.findAll(hasClass('apisum_title'), doc.children).flatMap(link => {
		const signature = DomUtils.textContent(link).replace(/\s+/g, ' ').trim();
		const name = signature.split('(')[0].trim();
		if (!/^[\w$]+$/.test(name)) { return []; }
		const desc = link.parent?.parent && DomUtils.findOne(hasClass('apisum_desc'), link.parent.parent.children);
		return [{ name, signature, description: desc ? DomUtils.textContent(desc).trim() : '' }];
	});
}

export function parseApiEvents(html: string): ScriptApi[string] {
	return parseDetailList(parseDocument(html), 'ename', 'edesc');
}

export async function findApiDocs(eclipseRoot: string): Promise<string | undefined> {
	const dirs = await findDirs(eclipseRoot, (_dir, names) => names.includes('index.html') && names.some(n => API_DIR.test(n)));
	return dirs[0];
}

const docsCache = new Map<string, Promise<{ api: ScriptApi; events: ScriptApi }>>();

export async function loadApiDocs(directory: string | undefined): Promise<{ api: ScriptApi; events: ScriptApi; error?: string }> {
	if (!directory) { return { api: {}, events: {}, error: 'WebSquare 메서드 자동완성을 쓰려면 API 문서 폴더를 지정해 주세요. (F1 → WebSquare5: 환경 설정)' }; }
	try {
		return await cached(docsCache, directory, () => readApiDocs(directory));
	} catch (e) {
		return { api: {}, events: {}, error: `WebSquare API 문서를 읽지 못했습니다: ${errorMessage(e)}` };
	}
}

async function readApiDocs(directory: string): Promise<{ api: ScriptApi; events: ScriptApi }> {
	const entries = (await readdir(directory, { withFileTypes: true })).filter(e => e.isDirectory() && API_DIR.test(e.name));
	const loaded = await Promise.all(entries.map(async e => {
		const html = await readFile(path.join(directory, e.name, `${e.name}.html`), 'utf8');
		return [e.name, parseApiMethods(html), parseApiEvents(html)] as const;
	}));
	if (!loaded.length) { throw new Error('API 문서가 없습니다.'); }
	return {
		api: Object.fromEntries(loaded.map(([name, methods]) => [name, methods])),
		events: Object.fromEntries(loaded.map(([name, , events]) => [name, events])),
	};
}
