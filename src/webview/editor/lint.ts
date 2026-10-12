import { parse } from 'acorn';
import { SaxesParser } from 'saxes';
import { linter, lintGutter, type Diagnostic, type LintSource } from '@codemirror/lint';
import type { RemoteDiagnostic } from '../../core/protocol';
import { StateEffect, type Extension, type Text } from '@codemirror/state';

const DELAY = 500;

/** JS 문법 오류(첫 오류 하나, 일반 스크립트 기준). offset: text가 문서 안에서 시작하는 위치 */
function jsProblems(text: string, offset = 0): Diagnostic[] {
	try {
		parse(text, { ecmaVersion: 'latest', sourceType: 'script' });
		return [];
	} catch (e) {
		const pos = (e as { pos?: unknown }).pos;
		if (!(e instanceof SyntaxError) || typeof pos !== 'number') {
			return [];
		}
		const from = Math.max(0, Math.min(pos, text.length - 1));
		return [{ from: offset + from, to: offset + Math.max(from, Math.min(pos + 1, text.length)), severity: 'error', message: e.message.replace(/ \(\d+:\d+\)$/, '') }];
	}
}

const SCRIPT_CDATA = /<(?:[\w.-]+:)?script\b(?![^>]*\ssrc\s*=)[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>/;

/** XML 형식 오류(엄격 파서, 첫 오류 하나). 형식이 맞으면 첫 인라인 script CDATA의 JS 문법 오류 */
function xmlProblems(doc: Text): Diagnostic[] {
	const text = doc.toString();
	if (!text.trim()) {
		return [];
	}
	const parser = new SaxesParser();
	let error: Diagnostic | undefined;
	parser.on('error', e => {
		if (!error) {
			const line = doc.line(Math.min(Math.max(parser.line, 1), doc.lines));
			const pos = Math.min(line.from + parser.columnIndex, line.to);
			const from = pos === line.to && pos > line.from ? pos - 1 : pos;
			error = { from, to: Math.min(from + 1, line.to), severity: 'error', message: e.message.replace(/^(?:.*?:)?\d+:\d+: /, '') };
		}
	});
	parser.write(text).close();
	if (error) {
		return [error];
	}
	const script = SCRIPT_CDATA.exec(text);
	// `]]>`를 나눠 적은 CDATA는 뒤 조각이 빠져 잘못 검사하므로 건너뛴다
	if (!script || text.startsWith('<![CDATA[', script.index + script[0].length)) {
		return [];
	}
	return jsProblems(script[1], script.index + script[0].length - 3 - script[1].length);
}

/** js: 화면 Script, xml: Source·연결한 XML(VS Code 기본 설치에는 XML 검사가 없다) */
export type LintMode = 'js' | 'xml';

/** VS Code가 새 문제를 보냄: 연결 탭 검사를 다시 */
export const remoteProblemsChanged = StateEffect.define<null>();

/** VS Code 쪽 줄·글자(0부터) → 이 문서 위치. 문서가 그사이 짧아졌으면 그 줄·문서 끝으로 */
export function posAt(doc: Text, line: number, ch: number): number {
	const l = doc.line(Math.min(line + 1, doc.lines));
	return Math.min(l.from + ch, l.to);
}

/** VS Code가 낸 문제(줄·글자) → 이 문서 위치 */
export function fromRemote(doc: Text, items: RemoteDiagnostic[]): Diagnostic[] {
	const at = (line: number, ch: number) => posAt(doc, line, ch);
	return items.map(d => {
		const from = at(d.fromLine, d.fromCh);
		return { from, to: Math.max(from, at(d.toLine, d.toCh)), severity: d.severity, message: d.message, source: d.source };
	});
}

/**
 * 편집기 문법 검사: 입력을 멈추고 잠시 뒤 검사, 밑줄 + 줄 번호 옆 표시.
 * mode: 이 편집기가 직접 검사(Script JS·XML). remote: VS Code가 그 파일에 낸 문제(연결 탭, Java 언어 서버 등)
 */
export const lintFor = (mode?: LintMode, remote?: LintSource): Extension => mode || remote ? [
	mode ? linter(view => mode === 'xml' ? xmlProblems(view.state.doc) : jsProblems(view.state.doc.toString()), { delay: DELAY }) : [],
	remote ? linter(remote, { delay: DELAY, needsRefresh: u => u.transactions.some(tr => tr.effects.some(e => e.is(remoteProblemsChanged))) }) : [],
	lintGutter(),
] : [];
