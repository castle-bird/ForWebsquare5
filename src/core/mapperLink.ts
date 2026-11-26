// MyBatis Mapper 인터페이스(.java) ↔ 매퍼 XML. XML의 namespace = 인터페이스 전체 이름, 문(select 등)의 id = 메서드 이름
import { parser as javaParser } from '@lezer/java';
import type { SyntaxNode } from '@lezer/common';

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

/** 인터페이스 선언에 @Mapper 애너테이션이 붙었는지(@org.apache.ibatis.annotations.Mapper 포함) */
function hasMapperAnnotation(iface: SyntaxNode, java: string): boolean {
	const mods = iface.getChild('Modifiers');
	if (!mods) { return false; }
	for (let child = mods.firstChild; child; child = child.nextSibling) {
		if (child.name !== 'Annotation' && child.name !== 'MarkerAnnotation') { continue; }
		const nameNode = child.getChild('Identifier') ?? child.getChild('ScopedIdentifier');
		if (!nameNode) { continue; }
		const raw = java.slice(nameNode.from, nameNode.to).replace(/\s+/g, '');
		if (raw === 'Mapper' || raw.endsWith('.Mapper')) { return true; }
	}
	return false;
}

/** 첫 번째 인터페이스 선언과 package 선언을 CST에서 찾는다 */
function parseInterfaceNode(java: string): { pkg?: string; iface: SyntaxNode; def: SyntaxNode } | undefined {
	const root = javaParser.parse(java).topNode;
	let pkg: string | undefined;
	let iface: SyntaxNode | undefined;
	for (let child = root.firstChild; child; child = child.nextSibling) {
		if (child.name === 'PackageDeclaration' && !pkg) {
			const nameNode = child.getChild('ScopedIdentifier') ?? child.getChild('Identifier');
			if (nameNode) { pkg = java.slice(nameNode.from, nameNode.to).replace(/\s+/g, ''); }
		} else if (child.name === 'InterfaceDeclaration' && !iface) {
			iface = child;
		}
	}
	const def = iface?.getChild('Definition');
	return iface && def ? { pkg, iface, def } : undefined;
}

/** 인터페이스 본문 바로 안의 메서드 선언(@lezer/java CST). 주석·애너테이션·default 메서드 본문은 제외 */
export function parseJavaMapper(java: string): JavaMapper | undefined {
	const found = parseInterfaceNode(java);
	if (!found) { return undefined; }
	const { pkg, iface, def } = found;
	const name = java.slice(def.from, def.to);
	const body = iface.getChild('InterfaceBody');
	const methods: Named[] = [];
	if (body) {
		for (let member = body.firstChild; member; member = member.nextSibling) {
			if (member.name !== 'MethodDeclaration') { continue; }
			const mDef = member.getChild('Definition');
			if (mDef) { methods.push({ name: java.slice(mDef.from, mDef.to), at: mDef.from }); }
		}
	}
	return { fqcn: pkg ? `${pkg}.${name}` : name, type: { name, at: def.from }, methods };
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
	const found = parseInterfaceNode(java);
	if (!found) { return false; }
	const name = java.slice(found.def.from, found.def.to);
	if (MAPPER_SUFFIX.test(name) || (fileName && /(?:Mapper|Dao|Repository)\.java$/i.test(fileName))) {
		return true;
	}
	return hasMapperAnnotation(found.iface, java);
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
