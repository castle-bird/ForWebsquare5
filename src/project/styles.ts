import type { CssRuleSource } from '../core/protocol';
import { DomUtils } from 'htmlparser2';
import postcss, { CssSyntaxError, type Root } from 'postcss';
import safeParse from 'postcss-safe-parser';
import selectorParser from 'postcss-selector-parser';
import valueParser from 'postcss-value-parser';
import { readWebConfig } from './config';
import { fromWebPath, webPath } from './paths';

export async function stylesheetFiles(webRoot: string, screenFile: string, screenText: string): Promise<string[]> {
	const el = DomUtils.findOne(e => e.name === 'stylesheet', (await readWebConfig(webRoot)).children);
	const hrefs: string[] = [];
	if (el && el.attribs.enable !== 'false') {
		if (el.attribs.value) {
			hrefs.push('/websquare/_websquare_/skin/' + el.attribs.value);
		}
		hrefs.push(...(el.attribs.earlyImportList ?? '').split(',').map(s => s.trim()).filter(Boolean));
	}
	for (const m of screenText.matchAll(/<\?xml-stylesheet\s[^?]*href="([^"]+)"/g)) {
		hrefs.push(m[1]);
	}
	const screenUrl = webPath(webRoot, screenFile);
	return [...new Set(hrefs.map(h => fromWebPath(webRoot, h, screenUrl)))];
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
			n.nodes = valueParser(JSON.stringify(toUri(fromWebPath(webRoot, url.value, base)))).nodes;
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
