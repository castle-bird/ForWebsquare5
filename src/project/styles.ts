import type { CssRuleSource } from '../core/protocol';
import { readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { DomUtils } from 'htmlparser2';
import postcss, { CssSyntaxError, type Root } from 'postcss';
import safeParse from 'postcss-safe-parser';
import selectorParser from 'postcss-selector-parser';
import valueParser from 'postcss-value-parser';
import { readWebConfig } from './config';
import { ENGINE_PAGE, fromWebPath, numeric, webPath } from './paths';

async function stylesheetConfig(webRoot: string) {
	const attrs = DomUtils.findOne(e => e.name === 'stylesheet', (await readWebConfig(webRoot)).children)?.attribs;
	return attrs?.enable === 'false' ? undefined : attrs;
}

const skinFile = (root: string, value: string) => fromWebPath(root, '_websquare_/skin/' + value, ENGINE_PAGE);
const isFile = (file: string) => stat(file).then(info => info.isFile(), () => false);

/** 웹 루트에 기본 스킨이 없으면 요청한 CSS가 있는 설치본 엔진을 최신순으로 찾는다. */
export async function findEngineRoot(installRoot: string, webRoot: string): Promise<string | undefined> {
	const skin = (await stylesheetConfig(webRoot))?.value;
	if (!skin || await isFile(skinFile(webRoot, skin))) {
		return undefined;
	}
	const plugins = path.join(installRoot, 'plugins');
	const names = (await readdir(plugins).catch(() => [] as string[])).filter(n => n.startsWith('com.inswave.websquare.webapp.engine_')).sort(numeric);
	for (const name of names.reverse()) {
		const root = path.join(plugins, name);
		if (await isFile(skinFile(root, skin))) {
			return root;
		}
	}
	return undefined;
}

/** 화면에 적용할 CSS 파일과 그 파일의 웹 루트(CSS url() 기준). 기본 스킨이 웹 루트에 없으면 engineRoot(설치본 엔진)에서 */
export async function stylesheetFiles(webRoot: string, screenFile: string, screenText: string, engineRoot?: string): Promise<{ file: string; root: string }[]> {
	const config = await stylesheetConfig(webRoot);
	const hrefs = (config?.earlyImportList ?? '').split(',').map(s => s.trim()).filter(Boolean);
	let skin: { file: string; root: string } | undefined;
	if (config?.value) {
		const file = skinFile(webRoot, config.value);
		skin = { file, root: webRoot };
		if (engineRoot && !await isFile(file)) {
			const fallback = skinFile(engineRoot, config.value);
			if (await isFile(fallback)) {
				skin = { file: fallback, root: engineRoot };
			}
		}
	}
	for (const m of screenText.matchAll(/<\?xml-stylesheet\s[^?]*href="([^"]+)"/g)) {
		hrefs.push(m[1]);
	}
	const screenUrl = webPath(webRoot, screenFile);
	const files = [...new Set(hrefs.map(h => fromWebPath(webRoot, h, screenUrl)))].filter(f => f !== skin?.file);
	return [...skin ? [skin] : [], ...files.map(file => ({ file, root: webRoot }))];
}

export function scopeCss(css: string, file: string, webRoot: string, toUri: (fsPath: string) => string, imports?: string[], errors?: string[], sources?: CssRuleSource[]): string {
	const root = parse(css, file, errors);
	const base = webPath(webRoot, file);
	root.walkAtRules('import', a => {
		const first = valueParser(a.params).nodes.find(n => n.type !== 'space' && n.type !== 'comment');
		const href = first?.type === 'function' && first.value.toLowerCase() === 'url'
			? first.nodes.find(n => n.type !== 'space' && n.type !== 'comment')?.value : first?.value;
		if (href && /^https:\/\//i.test(href)) {
			imports?.push(href);
		}
		a.remove();
	});
	root.walkRules(rule => {
		const selector = rule.selector;
		let match = '';
		rule.selector = selectorParser(selectors => {
			selectors.walkPseudos(n => { if (n.value === ':root') { n.value = ':host'; } });
			selectors.walkTags(n => {
				if (n.value === 'html') { n.replaceWith(selectorParser.pseudo({ value: ':host' })); }
				if (n.value === 'body') { n.replaceWith(selectorParser.className({ value: 'wse-page' })); }
			});
			if (sources) {
				const matcher = selectors.clone();
				matcher.walkPseudos(n => { if (n.value === ':host') { n.replaceWith(selectorParser.className({ value: 'wse-view' })); } });
				match = matcher.toString();
			}
		}).processSync(rule.selector);
		if (sources && rule.source?.start && rule.nodes.some(n => n.type === 'decl')) {
			const media: string[] = [], supports: string[] = [];
			let keyframes = false;
			for (let parent: typeof rule.parent | Root['parent'] = rule.parent; parent; parent = parent.parent) {
				if (parent.type !== 'atrule') { continue; }
				if (parent.name === 'media') { media.push(parent.params); }
				if (parent.name === 'supports') { supports.push(parent.params); }
				keyframes ||= parent.name.endsWith('keyframes');
			}
			if (!keyframes) {
				sources.push({ file, line: rule.source.start.line - 1, ch: rule.source.start.column - 1, selector, match, media, supports });
			}
		}

	});
	root.walkDecls(decl => {
		const value = valueParser(decl.value);
		value.walk(n => {
			if (n.type !== 'function' || n.value.toLowerCase() !== 'url') { return; }
			const parts = n.nodes.filter(child => child.type !== 'space' && child.type !== 'comment');
			if (parts.length !== 1) { return; }
			const url = parts[0];
			if ((url.type !== 'word' && url.type !== 'string') || /^(data:|[a-z]+:\/\/|#)/i.test(url.value)) { return; }
			// 웹 루트 밖·잘못된 경로는 그 url만 그대로 둔다(CSS 전체가 빠지지 않게)
			try {
				n.nodes = valueParser(JSON.stringify(toUri(fromWebPath(webRoot, url.value, base)))).nodes;
			} catch {
				return;
			}
		});
		decl.value = valueParser.stringify(value.nodes);
	});
	return root.toString();
}

function parse(css: string, file: string, errors?: string[]): Root {
	try {
		return postcss.parse(css, { from: file });
	} catch (e) {
		if (!(e instanceof CssSyntaxError)) { throw e; }
		errors?.push(`${e.line}줄 ${e.reason}`);
		// 타입은 postcss 공통 Parser(Root | Document)지만 CSS 파서는 항상 Root
		return safeParse(css, { from: file }) as Root;
	}
}
