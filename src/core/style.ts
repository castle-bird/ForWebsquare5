function declarations(style: string): string[] {
	const out: string[] = [];
	let depth = 0, quote = '', start = 0;
	for (let i = 0; i < style.length; i++) {
		const c = style[i];
		if (quote) {
			quote = c === quote ? '' : quote;
		} else if (c === '"' || c === "'") {
			quote = c;
		} else if (c === '(') {
			depth++;
		} else if (c === ')') {
			depth = Math.max(0, depth - 1);
		} else if (c === ';' && !depth) {
			out.push(style.slice(start, i));
			start = i + 1;
		}
	}
	out.push(style.slice(start));
	return out.filter(d => d.trim());
}

/** props의 속성만 바꾼다(값이 undefined면 그 속성을 지움). 나머지 선언·순서·공백은 그대로 */
export function setStyle(style: string | undefined, props: Record<string, string | undefined>): string {
	const rest = new Map(Object.entries(props).map(([k, v]) => [k.toLowerCase(), v]));
	const decls = declarations(style ?? '').flatMap(d => {
		const colon = d.indexOf(':');
		const name = d.slice(0, colon).trim().toLowerCase();
		if (colon <= 0 || !rest.has(name)) {
			return [d];
		}
		const value = rest.get(name);
		rest.delete(name);
		return value === undefined ? [] : [d.slice(0, colon + 1) + (d[colon + 1] === ' ' ? ' ' : '') + value];
	});
	decls.push(...[...rest].flatMap(([k, v]) => v === undefined ? [] : [`${k}:${v}`]));
	return decls.length ? decls.join(';') + ';' : '';
}

const styleMap = (style: string | undefined) => new Map(declarations(style ?? '').flatMap(d => {
	const colon = d.indexOf(':');
	return colon > 0 ? [[d.slice(0, colon).trim().toLowerCase(), d.slice(colon + 1).trim()] as const] : [];
}));

/** before → after에서 바뀐 속성(지운 속성은 undefined). 여러 컴포넌트에 같은 style 수정을 나눠 적용할 때 */
export function styleChanges(before: string | undefined, after: string | undefined): Record<string, string | undefined> {
	const a = styleMap(before), b = styleMap(after);
	return Object.fromEntries([...new Set([...a.keys(), ...b.keys()])].filter(k => a.get(k) !== b.get(k)).map(k => [k, b.get(k)]));
}
