import * as assert from 'assert';
import { applyEdits } from '../core/edit';
import { formatWithInsert, missingImportsEdit } from '../core/javaImports';

suite('Java 빠진 import 추가', () => {
	const body = 'public class A {\n    List<String> x;\n}\n';

	test('빠진 import만 마지막 import 뒤에 넣고 안 쓰는 import·순서는 건드리지 않는다', () => {
		const text = `package a;\n\nimport java.util.Map;\nimport b.Unused;\n\n${body}`;
		const organized = `package a;\n\nimport java.util.List;\nimport java.util.Map;\n\n${body}`;
		const edit = missingImportsEdit(text, organized)!;
		assert.strictEqual(applyEdits(text, [edit]), `package a;\n\nimport java.util.Map;\nimport b.Unused;\nimport java.util.List;\n\n${body}`);
	});

	test('import가 없으면 package 뒤, package도 없으면 맨 앞에', () => {
		const withPackage = `package a;\n\n${body}`;
		assert.strictEqual(applyEdits(withPackage, [missingImportsEdit(withPackage, `package a;\n\nimport java.util.List;\n\n${body}`)!]),
			`package a;\n\nimport java.util.List;\n\n${body}`);
		assert.strictEqual(applyEdits(body, [missingImportsEdit(body, `import java.util.List;\n\n${body}`)!]), `import java.util.List;\n\n${body}`);
	});

	test('빠진 게 없으면 없음, CRLF 문서는 CRLF로', () => {
		const text = `import java.util.List;\n\n${body}`;
		assert.strictEqual(missingImportsEdit(text, `import  java.util.List;\n\n${body}`), undefined, '공백만 다른 같은 import');
		assert.strictEqual(missingImportsEdit(text, `${body}`), undefined, '삭제 쪽 차이는 무시');
		const crlf = 'package a;\r\n\r\npublic class A {}\r\n';
		assert.strictEqual(applyEdits(crlf, [missingImportsEdit(crlf, 'package a;\r\n\r\nimport x.Y;\r\n\r\npublic class A {}\r\n')!]), 'package a;\r\n\r\nimport x.Y;\r\n\r\npublic class A {}\r\n');
	});

	test('서식 편집과 합친다: 삽입 자리 앞 편집만큼 밀고, 한가운데를 덮는 서식 편집은 뺀다', () => {
		const text = 'package a;\n\nimport  b.C;\npublic class A {}\n';
		const insert = missingImportsEdit(text, 'package a;\n\nimport b.C;\nimport x.Y;\n\npublic class A {}\n')!;
		// 앞(`import  b.C` 공백 하나 줄임)과 뒤(import 뒤 빈 줄 넣기) 서식 편집
		const edits = [
			{ start: text.indexOf('  b.C'), end: text.indexOf('  b.C') + 2, replacement: ' ' },
			{ start: text.indexOf('public'), end: text.indexOf('public'), replacement: '\n' },
		];
		assert.strictEqual(formatWithInsert(text, edits, insert), 'package a;\n\nimport b.C;\nimport x.Y;\n\npublic class A {}\n');
		// 삽입 자리가 서식 편집 한가운데
		const cover = [{ start: insert.start - 2, end: insert.start + 2, replacement: 'ZZ' }];
		assert.strictEqual(formatWithInsert(text, cover, insert), applyEdits(text, [insert]));
	});
});
