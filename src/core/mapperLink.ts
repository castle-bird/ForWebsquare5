// MyBatis Mapper 인터페이스(.java) ↔ 매퍼 XML. XML의 namespace = 인터페이스 전체 이름, 문(select 등)의 id = 메서드 이름
import { blankComments } from './actionMapping';

/** 이름과 그 글자 자리(offset) */
export interface Named { name: string; at: number }
export interface JavaMapper { fqcn: string; type: Named; methods: Named[] }
export interface XmlMapper { namespace: Named; statements: Named[] }
/** 이동할 곳: id가 없으면 인터페이스·namespace 자체 */
export interface MapperTarget { fqcn: string; id?: string }
/** 커서 위치에서 찾은 이동 대상과 원래 이름 자리 */
export interface MapperHit { target: MapperTarget; origin: Named }
/** 편집기 표시용 매퍼 링크 한 건(0부터 줄·글자) */
export interface MapperLinkMark {
	line: number;
	ch: number;
	length: number;
	direction: 'xml' | 'java';
	targetFile: string;
	id?: string;
}

const blank = (s: string) => s.replace(/[^\n]/g, ' ');
const on = (n: Named, offset: number) => offset >= n.at && offset <= n.at + n.name.length;
const MAPPER_SUFFIX = /(?:Mapper|Dao|Repository)$/i;

/** 인터페이스 본문 바로 안(중괄호·괄호 깊이 0)의 `이름(` = 메서드 선언. 애너테이션·default 메서드 본문은 뺀다 */
export function parseJavaMapper(java: string): JavaMapper | undefined {
	const text = blankComments(java).replace(/"""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, blank);
	const type = /\binterface\s+([A-Za-z_$][\w$]*)/.exec(text);
	const open = type ? text.indexOf('{', type.index) : -1;
	if (!type || open < 0) { return undefined; }
	const pkg = /\bpackage\s+([\w.]+)\s*;/.exec(text)?.[1];
	const methods: Named[] = [];
	const word = /[A-Za-z_$][\w$]*(?=\s*(\()?)/y;
	let braces = 0, parens = 0;
	for (let i = open + 1; i < text.length && braces >= 0; i++) {
		const c = text[i];
		if (c === '{') { braces++; } else if (c === '}') { braces--; } else if (c === '(') { parens++; } else if (c === ')') { parens--; }
		else if (braces === 0 && parens === 0 && /[A-Za-z_$]/.test(c)) {
			word.lastIndex = i;
			const m = word.exec(text)!;
			let b = i - 1;
			while (b > open && /\s/.test(text[b])) { b--; }
			if (m[1] && text[b] !== '@' && text[b] !== '.') { methods.push({ name: m[0], at: i }); }
			i += m[0].length - 1;
		}
	}
	const name = type[1];
	return { fqcn: pkg ? `${pkg}.${name}` : name, type: { name, at: type.index + type[0].length - name.length }, methods };
}

/** `<mapper namespace>`와 select·insert·update·delete의 id. 주석·CDATA 안은 보지 않는다 */
export function parseXmlMapper(xml: string): XmlMapper | undefined {
	const text = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, blank);
	const ns = /<mapper\b[^>]*?\bnamespace\s*=\s*(["'])([^"']*)\1/.exec(text);
	if (!ns) { return undefined; }
	const valueAt = (m: RegExpExecArray, value: string) => m.index + m[0].length - 1 - value.length;
	const statements = [...text.matchAll(/<(?:select|insert|update|delete)\b[^>]*?\bid\s*=\s*(["'])([^"']*)\1/g)]
		.map(m => ({ name: m[2], at: valueAt(m, m[2]) }));
	return { namespace: { name: ns[2], at: valueAt(ns, ns[2]) }, statements };
}

/** Java 커서가 메서드 선언·인터페이스 이름 위면 갈 곳과 원래 이름 자리 */
export function javaHitAt(java: string, offset: number): MapperHit | undefined {
	const mapper = parseJavaMapper(java);
	if (!mapper) { return undefined; }
	const method = mapper.methods.find(m => on(m, offset));
	return method ? { target: { fqcn: mapper.fqcn, id: method.name }, origin: method }
		: on(mapper.type, offset) ? { target: { fqcn: mapper.fqcn }, origin: mapper.type } : undefined;
}

/** XML 커서가 문 id·namespace 값 위면 갈 곳과 원래 이름 자리 */
export function xmlHitAt(xml: string, offset: number): MapperHit | undefined {
	const mapper = parseXmlMapper(xml);
	if (!mapper) { return undefined; }
	const statement = mapper.statements.find(s => on(s, offset));
	return statement ? { target: { fqcn: mapper.namespace.name, id: statement.name }, origin: statement }
		: on(mapper.namespace, offset) ? { target: { fqcn: mapper.namespace.name }, origin: mapper.namespace } : undefined;
}

/** Java 커서가 메서드 선언·인터페이스 이름 위면 갈 곳 */
export function javaTargetAt(java: string, offset: number): MapperTarget | undefined {
	return javaHitAt(java, offset)?.target;
}

/** XML 커서가 문 id·namespace 값 위면 갈 곳 */
export function xmlTargetAt(xml: string, offset: number): MapperTarget | undefined {
	return xmlHitAt(xml, offset)?.target;
}

/** 자동 아이콘 탐색 대상 Java 인터페이스인지: @Mapper 애너테이션이나 Mapper·Dao·Repository 이름 */
export function isLikelyJavaMapper(java: string, fileName?: string): boolean {
	const mapper = parseJavaMapper(java);
	if (!mapper) { return false; }
	if (MAPPER_SUFFIX.test(mapper.type.name) || (fileName && /(?:Mapper|Dao|Repository)\.java$/i.test(fileName))) {
		return true;
	}
	return /@(?:[\w.]+\.)?Mapper\b/.test(blankComments(java));
}

/** 글자 위치(offset) → 0부터 줄·글자(CRLF·LF·CR 지원) */
export function lineColAt(text: string, offset: number): { line: number; ch: number } {
	const end = Math.min(Math.max(0, offset), text.length);
	let line = 0, last = 0;
	for (let i = 0; i < end; i++) {
		const code = text.charCodeAt(i);
		if (code === 10 || (code === 13 && text.charCodeAt(i + 1) !== 10)) {
			line++;
			last = i + 1;
		}
	}
	return { line, ch: end - last };
}

/** 대상 안에서 이름 자리: id가 있으면 그 메서드·문, 없으면 인터페이스·namespace */
export function javaPlace(mapper: JavaMapper, id?: string): Named | undefined {
	return id === undefined ? mapper.type : mapper.methods.find(m => m.name === id);
}

export function xmlPlace(mapper: XmlMapper, id?: string): Named | undefined {
	return id === undefined ? mapper.namespace : mapper.statements.find(s => s.name === id);
}
