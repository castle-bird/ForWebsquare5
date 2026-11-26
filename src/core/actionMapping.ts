// Submission action URL → Spring Controller 메서드. Spring 확장·Java 서버 없이 @lezer/java CST에서 @RequestMapping·@GetMapping 등을 읽는다
import { parser as javaParser } from '@lezer/java';
import type { SyntaxNode } from '@lezer/common';

/** Controller 메서드 하나의 요청 경로(클래스 경로 + 메서드 경로)와 자리 */
export interface ActionMapping { path: string; method: string; line: number }

const MAPPING_NAMES = new Set(['RequestMapping', 'GetMapping', 'PostMapping', 'PutMapping', 'DeleteMapping', 'PatchMapping']);
const TYPE_DECLS = new Set(['ClassDeclaration', 'InterfaceDeclaration', 'RecordDeclaration']);
const TYPE_BODIES = new Set(['ClassBody', 'InterfaceBody', 'RecordBody']);

/** 애너테이션의 단순 이름(`@a.b.GetMapping` → `GetMapping`) */
function annotationName(node: SyntaxNode, text: string): string {
	const nameNode = node.getChild('Identifier') ?? node.getChild('ScopedIdentifier');
	if (!nameNode) { return ''; }
	const raw = text.slice(nameNode.from, nameNode.to).replace(/\s+/g, '');
	const dot = raw.lastIndexOf('.');
	return dot >= 0 ? raw.slice(dot + 1) : raw;
}

/** Java 문자열 리터럴(`"..."`)의 따옴표·이스케이프 해제 */
function unquoteJavaString(raw: string): string {
	if (raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') { return raw; }
	try {
		return JSON.parse(raw) as string;
	} catch {
		return raw.slice(1, -1).replace(/\\(["\\])/g, '$1');
	}
}

/** 노드 아래의 모든 문자열 리터럴 값 */
function collectStrings(node: SyntaxNode, text: string, out: string[] = []): string[] {
	if (node.name === 'StringLiteral') {
		out.push(unquoteJavaString(text.slice(node.from, node.to)));
		return out;
	}
	for (let child = node.firstChild; child; child = child.nextSibling) {
		collectStrings(child, text, out);
	}
	return out;
}

/** 매핑 애너테이션 하나의 경로 목록(없으면 `['']`) */
function annotationPaths(node: SyntaxNode, text: string): string[] {
	const args = node.getChild('AnnotationArgumentList');
	if (!args) { return ['']; }
	const pairs = args.getChildren('ElementValuePair');
	const paths: string[] = [];
	if (pairs.length) {
		for (const pair of pairs) {
			const key = pair.getChild('Identifier');
			const name = key ? text.slice(key.from, key.to) : '';
			if (name === 'value' || name === 'path') {
				collectStrings(pair, text, paths);
			}
		}
	} else {
		collectStrings(args, text, paths);
	}
	return paths.length ? paths : [''];
}

/** 선언의 Modifiers에서 Spring 매핑 애너테이션 경로 목록을 모은다 */
function mappingPathsOf(decl: SyntaxNode, text: string): string[] {
	const mods = decl.getChild('Modifiers');
	if (!mods) { return []; }
	const paths: string[] = [];
	for (let child = mods.firstChild; child; child = child.nextSibling) {
		if ((child.name === 'Annotation' || child.name === 'MarkerAnnotation') && MAPPING_NAMES.has(annotationName(child, text))) {
			paths.push(...annotationPaths(child, text));
		}
	}
	return paths;
}

const join = (a: string, b: string) => `/${[a, b].map(p => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')}`;

/** 줄 시작 offset 표로 0부터 시작하는 줄 번호 계산 */
function lineFinder(text: string): (offset: number) => number {
	const starts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10) { starts.push(i + 1); }
	}
	return offset => {
		let lo = 0, hi = starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (starts[mid] <= offset) { lo = mid; } else { hi = mid - 1; }
		}
		return lo;
	};
}

/** Java 원문에서 요청 경로가 붙은 메서드들. 클래스(·중첩 클래스)에 붙은 경로를 앞에 붙인다 */
export function parseMappings(java: string): ActionMapping[] {
	const lineAt = lineFinder(java);
	const out: ActionMapping[] = [];
	const visitType = (typeNode: SyntaxNode, outerPrefixes: string[]) => {
		const own = mappingPathsOf(typeNode, java);
		const prefixes = own.length ? outerPrefixes.flatMap(outer => own.map(p => join(outer, p))) : outerPrefixes;
		let body: SyntaxNode | null = null;
		for (let child = typeNode.firstChild; child; child = child.nextSibling) {
			if (TYPE_BODIES.has(child.name)) { body = child; break; }
		}
		if (!body) { return; }
		for (let member = body.firstChild; member; member = member.nextSibling) {
			if (TYPE_DECLS.has(member.name)) {
				visitType(member, prefixes);
			} else if (member.name === 'MethodDeclaration') {
				const methodPaths = mappingPathsOf(member, java);
				if (!methodPaths.length) { continue; }
				const def = member.getChild('Definition');
				if (!def) { continue; }
				const method = java.slice(def.from, def.to);
				const line = lineAt(def.from);
				for (const prefix of prefixes) {
					for (const p of methodPaths) {
						out.push({ path: join(prefix, p), method, line });
					}
				}
			}
		}
	};
	const root = javaParser.parse(java).topNode;
	for (let child = root.firstChild; child; child = child.nextSibling) {
		if (TYPE_DECLS.has(child.name)) {
			visitType(child, ['']);
		}
	}
	return out;
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
