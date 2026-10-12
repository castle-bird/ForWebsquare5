import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { defOf, kid, parseXml, type XmlNode } from '../core/xmlModel';
import { annotate, type ComponentDef } from './components';
import { ENGINE_PAGE, exists, fromWebPath, webPath } from './paths';

const MAX_DEPTH = 5;

export async function resolveSrc(rawSrc: string, file: string, webRoot?: string): Promise<string | undefined> {
	const src = rawSrc.replace(/[?#].*$/, '');
	const candidates = webRoot
		? [fromWebPath(webRoot, src, webPath(webRoot, file)), fromWebPath(webRoot, src, ENGINE_PAGE)]
		: [path.resolve(path.dirname(file), src)];
	for (const c of candidates) {
		if (await exists(c)) {
			return c;
		}
	}
	return undefined;
}

const FRAME_TYPES = new Set(['wframe', 'content']);

/** 하위 화면 원문. 상위 화면은 입력할 때마다 다시 보내므로 바뀐 파일(수정 시각·크기)만 다시 읽는다. 트리는 annotate가 고치므로 원문만 둔다 */
const texts = new Map<string, { mtimeMs: number; size: number; text: string }>();

async function readScreen(file: string): Promise<string> {
	const { mtimeMs, size } = await stat(file);
	const hit = texts.get(file);
	if (hit?.mtimeMs === mtimeMs && hit.size === size) {
		return hit.text;
	}
	const text = await readFile(file, 'utf8');
	texts.set(file, { mtimeMs, size, text });
	return text;
}

export async function attachFrames(root: XmlNode, file: string, webRoot: string | undefined, defs: ComponentDef[], udcs: ReadonlySet<string> = new Set(), stack: string[] = [file]): Promise<void> {
	const frames: XmlNode[] = [];
	const walk = (n: XmlNode) => {
		if (n.attrs.src && FRAME_TYPES.has(defOf(n, defs)?.realType ?? '')) {
			frames.push(n);
		}
		n.children.forEach(walk);
	};
	walk(root);
	await Promise.all(frames.map(async n => {
		const src = n.attrs.src;
		try {
			const target = await resolveSrc(src, file, webRoot);
			if (!target) {
				n.frameError = `화면을 찾지 못함: ${src}`;
				return;
			}
			if (stack.includes(target) || stack.length > MAX_DEPTH) {
				n.frameError = '순환 참조 또는 중첩이 너무 깊음';
				return;
			}
			const child = parseXml(await readScreen(target));
			const body = kid(child, 'body');
			if (!child || !body) {
				n.frameError = 'body가 없는 화면';
				return;
			}
			annotate(child, defs, udcs);
			await attachFrames(child, target, webRoot, defs, udcs, [...stack, target]);
			n.frame = body;
		} catch {
			n.frameError = `읽기 실패: ${src}`;
		}
	}));
}
