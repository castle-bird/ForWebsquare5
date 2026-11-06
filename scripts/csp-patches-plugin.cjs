const fs = require('node:fs');

// 웹뷰 CSP에 맞춰 style 속성을 클래스로 바꾸고, 들여쓰기 안내선은 화면 픽셀에 맞춰 그린다.
const PATCHES = [
	{
		// 줄마다 다른 선 모양: 같은 모양마다 클래스를 하나 만들어 생성한 스타일시트(CSP 대상 아님)에 등록
		filter: /[/\\]@replit[/\\]codemirror-indentation-markers[/\\].*\.js$/,
		replace: [
			// 반복 간격(ch)이 소수 화면 픽셀일 때 선마다 두께가 달라진다. 각 선의 자리를 화면 픽셀 경계로 맞춘다.
			['const gradient = `repeating-linear-gradient(to right, var(${markerCssProperty}) 0 ${thickness}px, transparent ${thickness}px ${indentWidth}ch)`;\n    // Subtract one pixel from the background width to get rid of artifacts of pixel rounding\n    return `${gradient} ${startOffset * indentWidth}.5ch/calc(${indentWidth * columns}ch - 1px) no-repeat`;', `return Array.from({ length: columns }, (_, i) => {
        const at = (startOffset + i) * indentWidth + 0.5;
        const x = 'calc(round(nearest, calc(' + at + 'ch + var(--indent-guide-origin, 0px)), var(--indent-guide-pixel, 1px)) - var(--indent-guide-origin, 0px))';
        const end = 'calc(' + x + ' + var(--indent-guide-pixel, 1px))';
        return 'linear-gradient(to right, transparent ' + x + ', var(' + markerCssProperty + ') ' + x + ' ' + end + ', transparent ' + end + ')';
    }).join(',');`],
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
