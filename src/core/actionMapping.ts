// Submission action URL → Spring Controller 메서드. Spring 확장·Java 서버 없이 .java 글자에서 @RequestMapping·@GetMapping 등을 읽는다

/** Controller 메서드 하나의 요청 경로(클래스 경로 + 메서드 경로)와 자리 */
export interface ActionMapping { path: string; method: string; line: number }

const MAPPING = /@(Request|Get|Post|Put|Delete|Patch)Mapping\b\s*(\()?/g;

/** 주석을 같은 길이 공백으로(글자 자리 유지). 문자열 안의 // 등은 그대로 */
function blankComments(text: string): string {
	let out = '', i = 0;
	while (i < text.length) {
		const c = text[i], next = text[i + 1];
		if (c === '"' || c === '\'') {
			let j = i + 1;
			while (j < text.length && text[j] !== c && text[j] !== '\n') { j += text[j] === '\\' ? 2 : 1; }
			out += text.slice(i, j + 1);
			i = j + 1;
		} else if (c === '/' && (next === '/' || next === '*')) {
			const end = next === '/' ? text.indexOf('\n', i) : text.indexOf('*/', i + 2) + 2;
			const stop = end <= 1 || end === -1 ? text.length : end;
			out += text.slice(i, stop).replace(/[^\n]/g, ' ');
			i = stop;
		} else {
			out += c;
			i++;
		}
	}
	return out;
}

/** 괄호 안 인자(depth 0 쉼표로 나눔)에서 경로 문자열들: 이름 없는 값, value=, path= */
function mappingPaths(args: string): string[] {
	const parts: string[] = [];
	let depth = 0, start = 0;
	for (let i = 0; i < args.length; i++) {
		const c = args[i];
		if (c === '"') { i = args.indexOf('"', i + 1); if (i < 0) { break; } }
		else if (c === '{' || c === '(') { depth++; }
		else if (c === '}' || c === ')') { depth--; }
		else if (c === ',' && depth === 0) { parts.push(args.slice(start, i)); start = i + 1; }
	}
	parts.push(args.slice(start));
	const paths = parts.flatMap(part => {
		const named = /^\s*(\w+)\s*=([\s\S]*)$/.exec(part);
		if (named && named[1] !== 'value' && named[1] !== 'path') { return []; }
		return [...(named ? named[2] : part).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]);
	});
	return paths.length ? paths : [''];
}

/** 닫는 괄호 자리(문자열 안 괄호는 건너뜀) */
function closeParen(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		const c = text[i];
		if (c === '"') { const end = text.indexOf('"', i + 1); if (end < 0) { return -1; } i = end; }
		else if (c === '(') { depth++; }
		else if (c === ')' && --depth === 0) { return i; }
	}
	return -1;
}

const join = (a: string, b: string) => `/${[a, b].map(p => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')}`;

/** Java 원문에서 요청 경로가 붙은 메서드들. 클래스에 붙은 경로는 앞에 붙인다(파일에 클래스 하나 가정) */
export function parseMappings(java: string): ActionMapping[] {
	const text = blankComments(java);
	const found: { paths: string[]; at: number; method?: string }[] = [];
	for (const m of text.matchAll(MAPPING)) {
		const end = m[2] ? closeParen(text, m.index + m[0].length - 1) : m.index + m[0].length - 1;
		if (end < 0) { continue; }
		const paths = m[2] ? mappingPaths(text.slice(m.index + m[0].length, end)) : [''];
		// 다음 선언까지: `class`가 먼저면 클래스 경로, `이름(`이 먼저면 그 메서드
		const after = text.slice(end + 1);
		const decl = /\b(class|interface)\b|([A-Za-z_$][\w$]*)\s*\(/.exec(after.replace(/@\w+(\.\w+)*(\s*\([^)]*\))?/g, s => ' '.repeat(s.length)));
		if (!decl) { continue; }
		found.push(decl[1] ? { paths, at: m.index } : { paths, at: end + 1 + decl.index, method: decl[2] });
	}
	const prefixes = found.find(f => !f.method)?.paths ?? [''];
	const lineAt = (offset: number) => java.slice(0, offset).split('\n').length - 1;
	return found.filter(f => f.method).flatMap(f => prefixes.flatMap(prefix => f.paths.map(p => ({ path: join(prefix, p), method: f.method!, line: lineAt(f.at) }))));
}

/** action URL → 비교할 경로: 주소·쿼리·끝 /를 떼고, 마지막 조각의 확장자(.do 등)도 뗀다 */
export function actionPath(action: string): string {
	const path = action.trim().replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/[?#].*$/, '');
	return join('', path).replace(/\.[A-Za-z]\w*$/, '');
}

/**
 * action이 mapping에 맞는 정도: 2 같음, 1 action 앞에 컨텍스트 경로가 더 붙음, 0 아님.
 * 매핑의 `{변수}`·`*`는 한 조각, `**`는 여러 조각
 */
export function matchAction(action: string, mapping: string): number {
	const target = actionPath(action), path = actionPath(mapping);
	if (path === '/' || target === '/') { return 0; }
	const pattern = path.split('/').slice(1).map(seg => seg === '**' ? '.*' : seg.replace(/\{[^}]*\}|\*|[.+?^$()|[\]\\]/g, s => s.startsWith('{') || s === '*' ? '[^/]+' : `\\${s}`)).join('/');
	return new RegExp(`^/${pattern}$`).test(target) ? 2 : new RegExp(`/${pattern}$`).test(target) ? 1 : 0;
}
