import type { TextEdit } from './edit';

const IMPORT = /^[ \t]*import[ \t]+[^;\r\n]+;/gm;
const PACKAGE = /^[ \t]*package[ \t]+[^;\r\n]+;/m;

const importsOf = (text: string) => [...text.matchAll(IMPORT)];
const key = (statement: string) => statement.replace(/\s+/g, ' ').trim();

/**
 * Organize imports 결과(organized)에서 원문(text)에 없는 import만 골라 넣는 편집(빈 범위 삽입). 없으면 undefined.
 * 안 쓰는 import 삭제·정렬은 하지 않는다: 쓰기 전에 미리 적어 둔 import가 사라지지 않게
 */
export function missingImportsEdit(text: string, organized: string): TextEdit | undefined {
	const have = new Set(importsOf(text).map(m => key(m[0])));
	const added = importsOf(organized).map(m => key(m[0])).filter(statement => !have.has(statement));
	if (!added.length) { return undefined; }
	const eol = text.includes('\r\n') ? '\r\n' : '\n', lines = [...new Set(added)].join(eol);
	const last = importsOf(text).at(-1);
	if (last) {
		const at = last.index + last[0].length;
		return { start: at, end: at, replacement: eol + lines };
	}
	const pkg = PACKAGE.exec(text);
	if (pkg) {
		const at = pkg.index + pkg[0].length;
		return { start: at, end: at, replacement: eol + eol + lines };
	}
	return { start: 0, end: 0, replacement: lines + eol + eol };
}

/**
 * 서식 편집(edits)을 적용한 글에 원문 위치(insert.start)의 삽입을 합친다. 삽입 자리 앞의 서식 편집이 바꾼 길이만큼 자리를 옮기고,
 * 삽입 자리가 한 서식 편집의 한가운데면 그 서식 편집만 뺀다(다음 포맷에서 반영)
 */
export function formatWithInsert(text: string, edits: TextEdit[], insert: TextEdit): string {
	const kept = edits.filter(e => !(e.start < insert.start && insert.start < e.end));
	const shift = kept.reduce((n, e) => e.end <= insert.start ? n + e.replacement.length - (e.end - e.start) : n, 0);
	const at = insert.start + shift;
	const formatted = kept.sort((a, b) => b.start - a.start).reduce((t, e) => t.slice(0, e.start) + e.replacement + t.slice(e.end), text);
	return formatted.slice(0, at) + insert.replacement + formatted.slice(at);
}
