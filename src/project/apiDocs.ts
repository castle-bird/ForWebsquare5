import { readFile, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { DomUtils, parseDocument } from 'htmlparser2';
import type { ApiParam, ApiReturn, ScriptApi } from '../core/protocol';
import { errorMessage } from '../core/errors';
import { cached, findDirs } from './paths';

const API_DIR = /^(\$p(?:\.|$)|WebSquare(?:\.|$))/;

const hasClass = (name: string) => (e: { attribs?: Record<string, string> }) => (e.attribs?.class ?? '').split(/\s+/).includes(name);

/**
 * 예제 글자: 앞뒤 빈 줄과 공통 들여쓰기를 걷고, 빈 줄이 이어지면 한 줄로
 * (브라우저의 xmp처럼 엔티티는 풀지 않고 원문 그대로 쓴다)
 */
export function cleanSample(raw: string): string {
	const lines = raw.replace(/\r\n?/g, '\n').split('\n').map(l => l.trimEnd());
	while (lines.length && !lines[0]) { lines.shift(); }
	while (lines.length && !lines[lines.length - 1]) { lines.pop(); }
	const indent = Math.min(...lines.filter(Boolean).map(l => /^[ \t]*/.exec(l)![0].length));
	return lines.map(l => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n').replace(/\n{3,}/g, '\n\n');
}

/** xmp 안의 원문. htmlparser2는 xmp 안 XML을 요소로 파싱해 textContent가 태그를 버리므로, 원본 문자열에서 시작 태그와 닫는 태그 사이를 자른다 */
function xmpSource(html: string, xmp: { startIndex: number | null }): string {
	const open = html.indexOf('>', xmp.startIndex ?? 0) + 1, close = html.toLowerCase().indexOf('</xmp', open);
	return html.slice(open, close < 0 ? undefined : close);
}

function parseDetailList(doc: ReturnType<typeof parseDocument>, html: string, tagClass: string, descClass: string): ScriptApi[string] {
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

			// 설명 안의 "(관련 함수)" 안내 xmp가 앞에 올 수 있으니 Sample 제목 뒤의 xmp를 먼저 쓴다
			const caption = DomUtils.findOne(hasClass('caption_sample'), dd.children);
			const xmps = DomUtils.findAll(e => e.name === 'xmp', dd.children);
			const xmp = caption ? xmps.find(x => (x.startIndex ?? 0) > (caption.startIndex ?? 0)) ?? xmps[0] : xmps[0];
			if (xmp) { sample = cleanSample(xmpSource(html, xmp)); }
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
	const doc = parseDocument(html, { withStartIndices: true });
	const methods = parseDetailList(doc, html, 'apiname', 'pdesc');
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
	return parseDetailList(parseDocument(html, { withStartIndices: true }), html, 'ename', 'edesc');
}

export async function findApiDocs(eclipseRoot: string): Promise<string | undefined> {
	const dirs = await findDirs(eclipseRoot, (_dir, names) => names.includes('index.html') && names.some(n => API_DIR.test(n)), 8, name => name === 'node_modules');
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
