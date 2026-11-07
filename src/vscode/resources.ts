import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { defOf, parseXml, type XmlNode } from '../core/xmlModel';
import { scriptBody } from '../core/edit';
import { errorMessage } from '../core/errors';
import type { CssRuleSource, ToWebview } from '../core/protocol';
import { ENGINE_PAGE, fromWebPath } from '../project/paths';
import { scopeCss, stylesheetFiles } from '../project/styles';
import { attachFrames } from '../project/frames';
import { engineModules } from '../project/modules';
import { annotate, loadComponents, type ComponentDef } from '../project/components';
import { offerSetup, resolvePath } from './setup';

let warnedNoDefs = false;

/** 웹뷰로 보낼 화면 XML: 원문·Script 본문과 디스크·웹뷰 주소가 필요한 부가 정보(연결 화면·이미지 주소·UDC 목록). 노드 트리는 웹뷰에서 파싱해 IPC 직렬화 크기를 줄인다 */
export async function documentMessage(document: vscode.TextDocument, webview: vscode.Webview, webRoot: string, defs: ComponentDef[], udcs: Set<string>): Promise<Extract<ToWebview, { type: 'document' }>> {
	const base = { type: 'document', version: document.version, text: document.getText() } as const;
	try {
		const root = parseXml(base.text);
		const body = root ? scriptBody(base.text, root) : 'XML을 읽지 못했습니다.';
		const script = typeof body === 'string' ? { text: '', note: body } : { text: body.text };
		const frames: Record<number, { frame?: XmlNode; frameError?: string }> = {};
		const urls: Record<number, string> = {};
		if (root) {
			annotate(root, defs, udcs);
			await attachFrames(root, document.uri.fsPath, webRoot, defs, udcs);
			const images = (n: XmlNode, inFrame = false) => {
				if (defOf(n, defs)?.realType === 'image' && n.attrs.src && !/^[a-z]+:/i.test(n.attrs.src)) {
					const url = webview.asWebviewUri(vscode.Uri.file(fromWebPath(webRoot, n.attrs.src, ENGINE_PAGE))).toString();
					if (inFrame) { n.url = url; } else { urls[n.index] = url; }
				}
				if (!inFrame && (n.frame || n.frameError)) {
					frames[n.index] = { ...n.frame && { frame: n.frame }, ...n.frameError && { frameError: n.frameError } };
				}
				n.children.forEach(c => images(c, inFrame));
				if (n.frame) { images(n.frame, true); }
			};
			images(root);
		}
		return {
			...base, script,
			...udcs.size && { udcs: [...udcs] },
			...Object.keys(frames).length && { frames },
			...Object.keys(urls).length && { urls },
		};
	} catch (e) {
		return { ...base, error: String(e), script: { text: '', note: String(e) } };
	}
}

export async function loadDefinitions(uri: vscode.Uri, webRoot?: string): Promise<{ defs: ComponentDef[]; error?: string }> {
	try {
		const source = await resolvePath('componentDefinitionFile', uri, webRoot);
		if (!source) {
			if (!warnedNoDefs) {
				warnedNoDefs = true;
				void offerSetup('componentDefinitionFile', '컴포넌트 정의 파일(WebSquareConfig.xml)을 찾지 못해 Property·Event 목록이 비어 있습니다.', uri, webRoot);
			}
			return { defs: [], error: '컴포넌트 정의(WebSquareConfig.xml)를 찾지 못했습니다. (F1 → WebSquare5: 환경 설정)' };
		}
		return { defs: await loadComponents(source) };
	} catch (e) {
		return { defs: [], error: `컴포넌트 정의 읽기 실패: ${errorMessage(e)}` };
	}
}

/**
 * 파일별 CSS 변환 결과. 글자와 웹뷰 주소 모양이 그대로면 다시 파싱하지 않는다
 * (큰 테마 CSS는 변환에 수백 ms가 걸리고 그동안 확장 호스트가 멈춘다. 화면을 열 때마다 반복하지 않게)
 */
const scopedCss = new Map<string, { text: string; uriBase: string; css: string; imports: string[]; errors: string[]; rules: CssRuleSource[] }>();

export async function loadStyles(document: vscode.TextDocument, webview: vscode.Webview, webRoot: string): Promise<Extract<ToWebview, { type: 'styles' }>> {
	const css: string[] = [], rules: CssRuleSource[] = [], imports: string[] = [], failed: string[] = [], broken: string[] = [];
	try {
		const files = await stylesheetFiles(webRoot, document.uri.fsPath, document.getText());
		const texts = await Promise.all(files.map(file => readFile(file, 'utf8').catch(() => undefined)));
		const toUri = (p: string) => webview.asWebviewUri(vscode.Uri.file(p)).toString();
		for (let i = 0; i < files.length; i++) {
			const file = files[i], text = texts[i];
			if (text === undefined) {
				failed.push(path.relative(webRoot, file));
				continue;
			}
			const key = `${webRoot}\n${file}`, uriBase = toUri(webRoot);
			let scoped = scopedCss.get(key);
			if (scoped?.text !== text || scoped.uriBase !== uriBase) {
				const fileImports: string[] = [], errors: string[] = [], fileRules: CssRuleSource[] = [];
				scoped = { text, uriBase, css: scopeCss(text, file, webRoot, toUri, fileImports, errors, fileRules), imports: fileImports, errors, rules: fileRules };
				scopedCss.set(key, scoped);
			}
			css.push(scoped.css);
			imports.push(...scoped.imports);
			rules.push(...scoped.rules);
			broken.push(...scoped.errors.map(e => `${path.relative(webRoot, file)} ${e}`));
		}
	} catch (e) {
		return { type: 'styles', css, rules, imports, error: `websquare/config.xml 읽기 실패: ${errorMessage(e)}` };
	}
	const error = [
		failed.length && `CSS를 읽지 못함: ${failed.join(', ')}`,
		broken.length && `CSS 문법 오류(그 부분만 빼고 적용): ${broken.join(', ')}`,
	].filter(Boolean).join(' / ');
	return { type: 'styles', css, rules, imports, ...error && { error } };
}

export async function loadModules(webRoot: string): Promise<Extract<ToWebview, { type: 'modules' }>> {
	try {
		const { files, failed } = await engineModules(webRoot);
		return { type: 'modules', files, ...failed.length && { error: `공통 JS를 읽지 못함: ${failed.join(', ')}` } };
	} catch (e) {
		return { type: 'modules', files: [], error: `공통 JS 목록(websquare/config.xml) 읽기 실패: ${errorMessage(e)}` };
	}
}
