// DTD에서 자동완성 스키마(요소·자식·속성·정해진 값)를 읽는다. 연결한 XML의 DOCTYPE이 가리키는 DTD(예: mybatis jar 안의 mybatis-3-mapper.dtd)
import type { XmlElementSpec } from './protocol';

const NAME = '[\\w.:-]+';
const DOCTYPE_RE = new RegExp(`<!DOCTYPE\\s+(${NAME})\\s+(?:PUBLIC\\s+(?:"[^"]*"|'[^']*')\\s+|SYSTEM\\s+)(?:"([^"]*)"|'([^']*)')`);
const ENTITY_DECL_RE = new RegExp(`<!ENTITY\\s+%\\s+(${NAME})\\s+(?:"([^"]*)"|'([^']*)')\\s*>`, 'g');
const ENTITY_REF_RE = new RegExp(`%(${NAME});`, 'g');
const ELEMENT_RE = new RegExp(`<!ELEMENT\\s+(${NAME})\\s+([^>]*)>`, 'g');
const CHILD_NAME_RE = new RegExp(`#?${NAME}`, 'g');
const ATTLIST_RE = new RegExp(`<!ATTLIST\\s+(${NAME})([^>]*)>`, 'g');
const ATTR_RE = new RegExp(`(${NAME})\\s+(\\([^)]*\\)|[A-Z]+)\\s+(?:#REQUIRED|#IMPLIED|(?:#FIXED\\s+)?(?:"[^"]*"|'[^']*'))`, 'g');

/** DOCTYPE의 최상위 요소 이름과 SYSTEM 식별자(DTD 경로·URL). 없으면 undefined */
export function doctypeOf(xml: string): { root: string; system: string } | undefined {
	const m = DOCTYPE_RE.exec(xml);
	return m ? { root: m[1], system: m[2] ?? m[3] } : undefined;
}

/** 매개변수 엔티티(`<!ENTITY % x "...">`, `%x;`)를 풀고 주석을 뺀 본문 */
function expand(text: string): string {
	let body = text.replace(/<!--[\s\S]*?-->/g, '');
	const entities = new Map<string, string>();
	for (const m of body.matchAll(ENTITY_DECL_RE)) {
		entities.set(m[1], m[2] ?? m[3]);
	}
	// 엔티티 안의 엔티티까지(순환이면 몇 번 뒤 멈춘다)
	for (let i = 0; i < 5 && /%[\w.:-]+;/.test(body); i++) {
		body = body.replace(ENTITY_REF_RE, (all, name: string) => entities.get(name) ?? all);
	}
	return body;
}

/** DTD → 요소 스키마(lang-xml completeFromSchema 모양). root가 있으면 그 요소만 최상위 */
export function parseDtd(text: string, root?: string): XmlElementSpec[] {
	const body = expand(text);
	const elements = new Map<string, XmlElementSpec>();
	const element = (name: string) => elements.get(name) ?? elements.set(name, { name, children: [], attributes: [] }).get(name)!;
	for (const m of body.matchAll(ELEMENT_RE)) {
		const children = [...m[2].matchAll(CHILD_NAME_RE)].map(c => c[0]).filter(c => !c.startsWith('#') && !/^(EMPTY|ANY)$/.test(c));
		element(m[1]).children = [...new Set(children)];
	}
	for (const m of body.matchAll(ATTLIST_RE)) {
		const owner = element(m[1]);
		for (const a of m[2].matchAll(ATTR_RE)) {
			const values = a[2].startsWith('(') ? a[2].slice(1, -1).split('|').map(v => v.trim()).filter(Boolean) : undefined;
			owner.attributes!.push(values ? { name: a[1], values } : { name: a[1] });
		}
	}
	const all = [...elements.values()];
	return root && elements.has(root) ? all.map(e => e.name === root ? { ...e, top: true } : e) : all;
}
