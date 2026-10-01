import { parse } from 'acorn';
import { SaxesParser } from 'saxes';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import type { Extension, Text } from '@codemirror/state';

const DELAY = 500;

const parsesAs = (text: string, sourceType: 'script' | 'module') => {
	try {
		parse(text, { ecmaVersion: 'latest', sourceType });
		return true;
	} catch {
		return false;
	}
};

/** JS 문법 오류(첫 오류 하나, 일반 스크립트 기준). offset: text가 문서 안에서 시작하는 위치. module이면 ES 모듈로 읽혀도 오류 아님(import·export 파일) */
export function jsProblems(text: string, offset = 0, module = false): Diagnostic[] {
	try {
		parse(text, { ecmaVersion: 'latest', sourceType: 'script' });
		return [];
	} catch (e) {
		const pos = (e as { pos?: unknown }).pos;
		if (!(e instanceof SyntaxError) || typeof pos !== 'number' || module && parsesAs(text, 'module')) {
			return [];
		}
		const from = Math.max(0, Math.min(pos, text.length - 1));
		return [{ from: offset + from, to: offset + Math.max(from, Math.min(pos + 1, text.length)), severity: 'error', message: e.message.replace(/ \(\d+:\d+\)$/, '') }];
	}
}

const SCRIPT_CDATA = /<(?:[\w.-]+:)?script\b(?![^>]*\ssrc\s*=)[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>/;

/** XML 형식 오류(엄격 파서, 첫 오류 하나). 형식이 맞으면 첫 인라인 script CDATA의 JS 문법 오류 */
export function xmlProblems(doc: Text): Diagnostic[] {
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

/** js: 화면 Script, jsFile: 연결한 .js(ES 모듈도), xml: Source·연결한 XML */
export type LintMode = 'js' | 'jsFile' | 'xml';

/** 편집기 문법 검사(JS: Script, XML: Source·연결한 XML): 입력을 멈추고 잠시 뒤 검사, 밑줄 + 줄 번호 옆 표시. 없으면 검사 안 함(Java) */
export const lintFor = (mode?: LintMode): Extension => mode ? [
	linter(view => mode === 'xml' ? xmlProblems(view.state.doc) : jsProblems(view.state.doc.toString(), 0, mode === 'jsFile'), { delay: DELAY }),
	lintGutter(),
] : [];
