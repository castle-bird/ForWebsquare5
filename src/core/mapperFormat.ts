// MyBatis 매퍼 XML 포맷(1단계): 태그 들여쓰기만 맞추고 SQL 본문의 줄 구조·안쪽 들여쓰기는 그대로 둔다
const STATEMENTS = new Set(['select', 'insert', 'update', 'delete', 'sql']);
const TAB = 4;

type Kind = 'comment' | 'cdata' | 'pi' | 'doctype' | 'open' | 'close' | 'self' | 'text';
interface Token { kind: Kind; start: number; end: number; name: string }

export function isMapperXml(text: string): boolean {
	return /<mapper[\s>]/.test(text);
}

function tokenize(xml: string): Token[] {
	const tokens: Token[] = [];
	const pattern = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!(?!\[CDATA)[\s\S]*?>|<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
	let last = 0;
	for (const match of xml.matchAll(pattern)) {
		const index = match.index!, text = match[0];
		if (index > last) { tokens.push({ kind: 'text', start: last, end: index, name: '' }); }
		last = index + text.length;
		const kind: Kind = text.startsWith('<!--') ? 'comment' : text.startsWith('<![CDATA[') ? 'cdata' : text.startsWith('<?') ? 'pi' : text.startsWith('<!') ? 'doctype'
			: match[1] ? 'close' : match[4] ? 'self' : 'open';
		tokens.push({ kind, start: index, end: last, name: (match[2] ?? '').toLowerCase() });
	}
	if (last < xml.length) { tokens.push({ kind: 'text', start: last, end: xml.length, name: '' }); }
	return tokens;
}

/** 문장(select 등) 본문의 첫 줄·끝 줄 바꿈: 여는 태그 뒤나 닫는 태그 앞에 글자가 붙어 있으면 줄을 나눈다. 짧은 한 줄 문장은 그대로 */
function breakStatements(xml: string): string {
	const tokens = tokenize(xml);
	const stack: Token[] = [];
	const pairs: [Token, Token][] = [];
	for (const token of tokens) {
		if (token.kind === 'open') { stack.push(token); }
		else if (token.kind === 'close') {
			const at = stack.map(item => item.name).lastIndexOf(token.name);
			if (at >= 0) {
				const open = stack.splice(at)[0];
				if (STATEMENTS.has(open.name)) { pairs.push([open, token]); }
			}
		}
	}
	let out = xml;
	for (const [open, close] of pairs.sort((a, b) => b[0].start - a[0].start)) {
		let body = out.slice(open.end, close.start);
		if (!body.trim()) { continue; }
		const lineStart = out.lastIndexOf('\n', open.start) + 1;
		if (!body.includes('\n') && open.end - lineStart + body.trim().length + (close.end - close.start) <= 100) {
			body = body.trim();
		} else {
			if (!/^[ \t]*\r?\n/.test(body)) { body = `\n${body.replace(/^[ \t]+/, '')}`; }
			if (!/\r?\n[ \t]*$/.test(body)) { body = `${body.replace(/[ \t]+$/, '')}\n`; }
		}
		out = out.slice(0, open.end) + body + out.slice(close.start);
	}
	return out;
}

const widthOf = (indent: string) => [...indent].reduce((sum, ch) => sum + (ch === '\t' ? TAB : 1), 0);

export function formatMapper(text: string, unit = '    '): string {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const source = breakStatements(text.replace(/\r\n/g, '\n'));
	const tokens = tokenize(source);
	const lines = source.split('\n');
	const starts: number[] = [];
	let at = 0;
	for (const line of lines) { starts.push(at); at += line.length + 1; }
	const lineOf = (offset: number) => {
		let low = 0, high = starts.length - 1;
		while (low < high) { const mid = (low + high + 1) >> 1; if (starts[mid] <= offset) { low = mid; } else { high = mid - 1; } }
		return low;
	};
	interface Info { kind: 'blank' | 'structure' | 'body' | 'continue' | 'cdata'; depth: number; statement?: number; token?: Token; orig: number; nested?: number; text?: boolean; parent?: number }
	const infos: Info[] = [];
	const stack: Token[] = [];
	let t = 0;
	for (let i = 0; i < lines.length; i++) {
		const ls = starts[i];
		while (t < tokens.length && tokens[t].end <= ls) {
			const token = tokens[t++];
			if (token.kind === 'open') { stack.push(token); }
			else if (token.kind === 'close') { const found = stack.map(item => item.name).lastIndexOf(token.name); if (found >= 0) { stack.splice(found); } }
		}
		const indent = /^[ \t]*/.exec(lines[i])![0];
		const orig = widthOf(indent);
		const spanning = tokens[t] && tokens[t].start < ls && tokens[t].kind !== 'text' ? tokens[t] : undefined;
		if (spanning) { infos.push({ kind: spanning.kind === 'cdata' ? 'cdata' : 'continue', depth: 0, token: spanning, orig }); continue; }
		if (indent.length === lines[i].length) { infos.push({ kind: 'blank', depth: 0, orig }); continue; }
		const p = ls + indent.length;
		let k = t;
		while (k < tokens.length && tokens[k].end <= p) { k++; }
		const first = tokens[k];
		const statementAt = stack.findIndex(item => STATEMENTS.has(item.name));
		const closesStatement = first?.kind === 'close' && statementAt >= 0 && first.name === stack[statementAt].name && stack.length - 1 === statementAt;
		if (statementAt >= 0 && !closesStatement) {
			const nested = stack.length - statementAt - 1 - (first?.kind === 'close' ? 1 : 0);
			infos.push({ kind: 'body', depth: statementAt + 1, statement: stack[statementAt].start, orig, nested: Math.max(0, nested), text: !first || first.kind === 'text', parent: stack.length > statementAt + 1 ? lineOf(stack[stack.length - 1].start) : undefined });
		}
		else { infos.push({ kind: 'structure', depth: Math.max(0, stack.length - (first?.kind === 'close' ? 1 : 0)), orig }); }
	}
	const group = (info: Info) => info.nested ? `p${info.parent}` : `s${info.statement}`;
	const bodyMin = new Map<string, number>();
	for (const info of infos) {
		if (info.kind === 'body' && info.text) { bodyMin.set(group(info), Math.min(bodyMin.get(group(info)) ?? Infinity, info.orig)); }
	}
	const delta: number[] = [];
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const info = infos[i];
		const body = lines[i].trimStart();
		if (info.kind === 'blank') { out.push(''); delta.push(0); continue; }
		if (info.kind === 'cdata') { out.push(lines[i]); delta.push(0); continue; }
		if (info.kind === 'continue') {
			const shift = delta[lineOf(info.token!.start)] ?? 0;
			out.push(`${' '.repeat(Math.max(0, info.orig + shift))}${body.trimEnd()}`);
			delta.push(shift);
			continue;
		}
		let indent = unit.repeat(info.depth);
		if (info.kind === 'body') {
			indent += unit.repeat(info.nested!);
			if (info.text) {
				indent += ' '.repeat(Math.max(0, info.orig - (bodyMin.get(group(info)) ?? info.orig)));
			}
		}
		out.push(`${indent}${body.trimEnd()}`);
		delta.push(widthOf(indent) - info.orig);
	}
	return out.join(eol);
}
