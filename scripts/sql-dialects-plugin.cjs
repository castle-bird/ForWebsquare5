// 확장 호스트 번들 전용: core/sqlCompletion.ts가 읽는 lang-sql 방언 명세(키워드·자료형·내장 함수)만 빌드 때 값으로 넣는다.
// lang-sql을 그대로 묶으면 화면이 없는 확장 호스트에 CodeMirror 편집기 코드(약 400KB)가 딸려 온다.
// 단위 테스트는 패키지를 묶지 않아 실제 lang-sql을 읽으므로 두 경로의 단어가 같다.
module.exports = {
	name: 'sql-dialect-specs',
	setup(build) {
		build.onResolve({ filter: /^@codemirror\/lang-sql$/ }, () => ({ path: 'lang-sql-specs', namespace: 'sql-dialect-specs' }));
		build.onLoad({ filter: /.*/, namespace: 'sql-dialect-specs' }, () => {
			const specs = {};
			for (const [name, dialect] of Object.entries(require('@codemirror/lang-sql'))) {
				const spec = dialect?.spec;
				if (spec && typeof spec === 'object') {
					specs[name] = { spec: { keywords: spec.keywords, types: spec.types, builtin: spec.builtin } };
				}
			}
			return { contents: `module.exports = ${JSON.stringify(specs)};`, loader: 'js' };
		});
	},
};
