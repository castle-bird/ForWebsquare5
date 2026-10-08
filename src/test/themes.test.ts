import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { customizationsFor, fromVsCodeTheme, parseJsonc, withCustomizations } from '../core/codeTheme';
import { DEFAULT_CODE_OPTIONS, readFontLigatures, readSqlDialect, readWordWrap, SQL_DIALECTS } from '../core/codeOptions';

suite('코드 편집기 테마', () => {
	test('코드 편집기 테마 가져오기: VS Code 테마 .json(JSONC) → 색·문법 색', () => {
		assert.deepStrictEqual(parseJsonc('{\n // 주석\n "a": "http://x/*y*/", /* 블록 */ "b": [1, 2,],\n}'), { a: 'http://x/*y*/', b: [1, 2] }, '문자열 안 // /* 는 그대로');
		const theme = fromVsCodeTheme({
			type: 'dark',
			colors: { 'editor.background': '#101010', 'editor.foreground': '#eeeeee', 'editorLineNumber.foreground': '#555555', 'editor.selectionBackground': 'nope' },
			tokenColors: [
				{ settings: { foreground: '#aaaaaa' } },
				{ scope: 'keyword', settings: { foreground: '#ff0000' } },
				{ scope: 'keyword.control', settings: { foreground: '#00ff00' } },
				{ scope: ['comment'], settings: { foreground: '#777777' } },
				{ scope: 'comment.line', settings: { fontStyle: 'italic' } },
				{ scope: 'comment', settings: { fontStyle: 'italic' } },
				{ scope: 'source.java keyword.control', settings: { foreground: '#123456' } },
				{ scope: 'string, constant.numeric', settings: { foreground: '#ce9178' } },
			],
		});
		assert.strictEqual(theme.dark, true);
		assert.deepStrictEqual(theme.colors, { background: '#101010', foreground: '#eeeeee', gutterBackground: '#101010', gutterForeground: '#555555' }, '틀린 색은 버림');
		assert.deepStrictEqual(theme.tokens?.keyword, { color: '#00ff00' }, '더 긴 scope(keyword.control)가 이김, 자손 선택자 규칙은 무시');
		assert.deepStrictEqual(theme.tokens?.comment, { color: '#777777', fontStyle: 'italic' }, '색과 글꼴 모양은 따로');
		assert.deepStrictEqual([theme.tokens?.string, theme.tokens?.number], [{ color: '#ce9178' }, { color: '#ce9178' }], '쉼표로 묶은 scope');
		assert.strictEqual(fromVsCodeTheme({ colors: { 'editor.background': '#fafafa' } }).dark, false, 'type이 없으면 배경 밝기로');
		assert.throws(() => fromVsCodeTheme({ tokenColors: './x.tmTheme' }), /tmTheme/);
	});

	test('코드 편집기 테마 덮어쓰기: 공통 다음 [테마 id·이름], 틀린 값은 버림', () => {
		const setting = {
			colors: { background: '#000000', caret: 'red' },
			tokens: { keyword: '#ff8800', comment: { color: '#888888', fontStyle: 'italic' }, unknown: '#111111' },
			'[Dracula]': { tokens: { keyword: '#ff79c6' } },
		};
		assert.deepStrictEqual(customizationsFor(setting, 'dracula', 'Dracula'), {
			common: { colors: { background: '#000000' }, tokens: { keyword: { color: '#ff8800' }, comment: { color: '#888888', fontStyle: 'italic' } } },
			own: { tokens: { keyword: { color: '#ff79c6' } } },
		});
		assert.deepStrictEqual(Object.keys(customizationsFor(setting, 'amy', 'Amy')), ['common'], '다른 테마에는 공통만');
		assert.deepStrictEqual(customizationsFor(undefined, 'amy', 'Amy'), {});
		// 팝업 저장: 공통은 위에, 이 테마는 기존 키("[Dracula]") 그대로, 다른 테마 칸 유지, 빈 층은 지움
		const other = { tokens: { string: '#00ff00' } };
		const saved = withCustomizations({ ...setting, '[Amy]': other }, 'dracula', 'Dracula', { tokens: { number: { color: '#123456' } } }, { colors: { caret: '#ffffff' } });
		assert.deepStrictEqual(saved, { tokens: { number: { color: '#123456' } }, '[Dracula]': { colors: { caret: '#ffffff' } }, '[Amy]': other });
		assert.deepStrictEqual(withCustomizations(saved, 'dracula', 'Dracula', undefined, {}), { '[Amy]': other });
		assert.deepStrictEqual(withCustomizations(undefined, 'custom:My', 'My', undefined, { tokens: { tag: { color: '#abcdef' } } }), { '[My]': { tokens: { tag: { color: '#abcdef' } } } });
	});
});

suite('코드 편집기 옵션', () => {
	test('editor.wordWrap: off 말고는 줄바꿈', () => {
		assert.strictEqual(readWordWrap('off'), false);
		for (const value of ['on', 'wordWrapColumn', 'bounded']) {
			assert.strictEqual(readWordWrap(value), true, value);
		}
		assert.strictEqual(readWordWrap(undefined), false);
		assert.strictEqual(readWordWrap(true), false);
	});

	test('editor.fontLigatures: 끔·켬·글꼴 기능 글자', () => {
		for (const value of [false, undefined, '', ' ', 'false', 1]) {
			assert.strictEqual(readFontLigatures(value), '"liga" off, "calt" off', String(value));
		}
		assert.strictEqual(readFontLigatures(true), '"liga" on, "calt" on');
		assert.strictEqual(readFontLigatures('true'), '"liga" on, "calt" on');
		assert.strictEqual(readFontLigatures(" 'ss01', 'ss02' "), "'ss01', 'ss02'");
		assert.strictEqual(DEFAULT_CODE_OPTIONS.fontFeatures, '"liga" off, "calt" off');
	});

	test('SQL 방언: 목록에 없으면 standard', () => {
		for (const dialect of SQL_DIALECTS) {
			assert.strictEqual(readSqlDialect(dialect), dialect);
		}
		assert.strictEqual(readSqlDialect('Oracle'), DEFAULT_CODE_OPTIONS.sqlDialect);
		assert.strictEqual(readSqlDialect(undefined), 'standard');
	});

	test('package.json의 방언 목록과 코드가 같다', () => {
		const setting = (JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')) as { contributes: { configuration: { properties: Record<string, { enum?: string[]; default?: string }> } } })
			.contributes.configuration.properties['websquare5-editor.sqlDialect'];
		assert.deepStrictEqual(setting.enum, [...SQL_DIALECTS]);
		assert.strictEqual(setting.default, DEFAULT_CODE_OPTIONS.sqlDialect);
	});
});
