/** 컴포넌트 정의 설명(description)을 도움말에 보일 덩어리로 나눈다 */
export type HelpBlock = { kind: 'text' | 'code'; text: string } | { kind: 'heading'; text: string };

// 줄 맨 앞의 `|`(공백 허용)는 정의 파일 작성자가 붙인 들여쓰기 표시다: 옵션 설명·코드·XML 예제가 섞여 있고, `|`만 있는 줄은 빈 줄이다
const BAR = /^\s*\|/;
const HEADING = /^\(.+\)$/;
// 코드 표시: 줄 끝 `;`·`{`·`}`, 주석 줄, function·scwin.·var 선언, 줄 앞 XML 태그
const CODE = /;\s*(\/\/.*)?$|[{}]\s*$|^\s*[{}]|^\s*\/\/|\bfunction\s*\w*\s*\(|^\s*(var|let|const)\s|^\s*scwin\.|^\s*<\/?[A-Za-z][\w:.-]*[\s>/]/;

export const trimBlank = (lines: string[]) => {
	let start = 0, end = lines.length;
	while (start < end && !lines[start].trim()) { start++; }
	while (end > start && !lines[end - 1].trim()) { end--; }
	return lines.slice(start, end);
};

/** 가장 적게 들여쓴 만큼 왼쪽 공백을 걷어 낸다(코드 모양은 유지) */
export function dedent(lines: string[]): string[] {
	const indent = Math.min(...lines.filter(l => l.trim()).map(l => /^[ \t]*/.exec(l)![0].length));
	return lines.map(l => l.slice(Number.isFinite(indent) ? indent : 0));
}

/**
 * `|` 줄은 괄호 제목 줄(`|(옵션 설명)`)이나 `|`가 없는 줄에서 끊어 덩어리로 묶고, 코드 표시가 있는 덩어리만 code로 보인다.
 * 코드가 아닌 `|` 덩어리(옵션 목록 등)는 `|`만 뗀 일반 글자다. 빈 `|` 줄은 코드 안에서는 빈 줄로 둔다
 */
export function helpBlocks(description: string): HelpBlock[] {
	const blocks: HelpBlock[] = [];
	let plain: string[] = [], bar: string[] = [];
	const flushPlain = () => {
		const lines = trimBlank(plain.map(l => l.trim()));
		if (lines.length) { blocks.push({ kind: 'text', text: lines.join('\n') }); }
		plain = [];
	};
	const flushBar = () => {
		const lines = trimBlank(bar);
		if (lines.length) {
			blocks.push(lines.some(l => CODE.test(l)) ? { kind: 'code', text: dedent(lines).join('\n') } : { kind: 'text', text: dedent(lines).map(l => l.trimEnd()).join('\n') });
		}
		bar = [];
	};
	for (const line of description.split(/\r\n|\r|\n/)) {
		if (!BAR.test(line)) {
			flushBar();
			plain.push(line);
			continue;
		}
		const body = line.replace(BAR, '').replace(/^ /, '');
		if (HEADING.test(body.trim())) {
			flushPlain();
			flushBar();
			blocks.push({ kind: 'heading', text: body.trim() });
			continue;
		}
		flushPlain();
		bar.push(body.trimEnd());
	}
	flushPlain();
	flushBar();
	return blocks;
}
