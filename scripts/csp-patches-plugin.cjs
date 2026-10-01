const fs = require('node:fs');

// 웹뷰 CSP는 style 속성 문자열을 막는다. 속성으로 스타일을 넣는 CodeMirror 확장을 빌드 때 클래스로 바꾼다.
const PATCHES = [
	{
		// 줄마다 다른 선 모양: 같은 모양마다 클래스를 하나 만들어 생성한 스타일시트(CSP 대상 아님)에 등록
		filter: /[/\\]@replit[/\\]codemirror-indentation-markers[/\\].*\.js$/,
		replace: [
			[`class: 'cm-indent-markers',
                attributes: {
                    style: \`--indent-markers: \${backgrounds}\`,
                },`, `class: 'cm-indent-markers ' + markerClass(backgrounds),`],
			['class IndentMarkersClass {', `const markerClasses = new Map();
let markerSheet;
function markerClass(backgrounds) {
    let name = markerClasses.get(backgrounds);
    if (!name) {
        if (!markerSheet) {
            markerSheet = new CSSStyleSheet();
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, markerSheet];
        }
        name = 'cm-indent-markers-' + markerClasses.size;
        markerClasses.set(backgrounds, name);
        markerSheet.insertRule('.' + name + ' { --indent-markers: ' + backgrounds + '; }');
    }
    return name;
}
class IndentMarkersClass {`],
		],
	},
];

module.exports = {
	name: 'csp-patches',
	setup(build) {
		for (const { filter, replace } of PATCHES) {
			build.onLoad({ filter }, async args => {
				let source = await fs.promises.readFile(args.path, 'utf8');
				for (const [from, to] of replace) {
					if (!source.includes(from)) {
						throw new Error(`${args.path}: 패치할 코드를 찾지 못했습니다. 패키지 버전이 바뀌었으면 csp-patches-plugin.cjs를 확인하세요.`);
					}
					source = source.replace(from, to);
				}
				return { contents: source, loader: 'js' };
			});
		}
	},
};
