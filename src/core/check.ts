// 화면 점검: 겹치는 id, 없는 데이터·컬럼을 가리키는 바인딩, Script에 없는 이벤트 함수
import { isDataKind } from './data';
import { EV, localName, pathTo, type XmlNode } from './xmlModel';

/** 안에서만 id가 겹치면 안 되는 범위: 그리드(와 그 header·gBody·footer·subTotal), 데이터의 columnInfo·keyInfo. 그 밖은 화면 전체 */
const SCOPE = /:(gridView|header|gBody|footer|subTotal|columnInfo|keyInfo)$/;

/** 노드의 id 범위(path: 그 노드까지) */
const scopeOf = (path: XmlNode[]) => path.slice(0, -1).reverse().find(n => SCOPE.test(n.tag)) ?? path[0];

/** 범위마다 id → 노드들 */
function idGroups(root: XmlNode): Map<string, XmlNode[]>[] {
	const groups = new Map<XmlNode, Map<string, XmlNode[]>>();
	const visit = (n: XmlNode, scope: XmlNode) => {
		const id = n.attrs.id;
		if (id) {
			const group = groups.get(scope) ?? new Map<string, XmlNode[]>();
			groups.set(scope, group.set(id, [...group.get(id) ?? [], n]));
		}
		n.children.forEach(c => visit(c, SCOPE.test(n.tag) ? n : scope));
	};
	visit(root, root);
	return [...groups.values()];
}

/** index 노드의 id를 id로 바꾸면 같은 범위의 다른 노드와 겹치는지(겹치면 이유) */
export function idConflict(root: XmlNode, index: number, id: string): string | undefined {
	const path = pathTo(root, index);
	if (!path) {
		return undefined;
	}
	const scope = scopeOf(path);
	const clash = (n: XmlNode, inScope: boolean): boolean =>
		inScope && n.index !== index && n.attrs.id === id || n.children.some(c => clash(c, n === scope || inScope && !SCOPE.test(n.tag)));
	return clash(scope, false) ? `이미 사용 중인 ID입니다. \`${id}\`` : undefined;
}

/** 데이터 id → 종류(dataList 등)·컬럼·키 id들(columnInfo·keyInfo가 없는 linkedDataList·alias는 columns 없음: 컬럼은 안 본다) */
function dataColumns(root: XmlNode): Map<string, { kind: string; columns?: Set<string> }> {
	const data = new Map<string, { kind: string; columns?: Set<string> }>();
	const visit = (n: XmlNode) => {
		if (isDataKind(n) && n.attrs.id) {
			const info = n.children.find(c => /:(columnInfo|keyInfo)$/.test(c.tag));
			data.set(n.attrs.id, { kind: localName(n.tag), columns: info && new Set(info.children.flatMap(c => c.attrs.id ? [c.attrs.id] : [])) });
		}
		n.children.forEach(visit);
	};
	visit(root);
	return data;
}

/** "data:" 값이 가리키는 데이터 id(와 컬럼). data:dlt_a.col · data:json,dlt_a · data:json,["dlt_a",{"id":"dma_b"}] */
function dataRefs(value: string): { id: string; column?: string }[] {
	const body = value.slice('data:'.length);
	const comma = body.indexOf(',');
	if (comma < 0) {
		const dot = body.indexOf('.');
		return body ? [dot < 0 ? { id: body } : { id: body.slice(0, dot), column: body.slice(dot + 1) }] : [];
	}
	const rest = body.slice(comma + 1).trim();
	if (!/^[[{]/.test(rest)) {
		return rest ? [{ id: rest }] : [];
	}
	try {
		const parsed: unknown = JSON.parse(rest);
		return (Array.isArray(parsed) ? parsed : [parsed]).flatMap(item => {
			const id = typeof item === 'string' ? item : (item as { id?: unknown } | null)?.id;
			return typeof id === 'string' ? [{ id }] : [];
		});
	} catch {
		return [];
	}
}

/**
 * 화면 점검 결과: 노드 index → 문제들. 겹치는 id(같은 범위), 화면에 있는 데이터의 없는 컬럼을 가리키는 "data:" 바인딩,
 * 이벤트 값 scwin.함수가 Script에 없음. 화면에 없는 데이터는 안 본다: 공통 코드 등은 스크립트에서 만들어 바인딩하는 일이 많아 오류로 착각한다
 */
export function screenProblems(root: XmlNode, script = ''): Map<number, string[]> {
	const problems = new Map<number, string[]>();
	const add = (n: XmlNode, message: string) => problems.set(n.index, [...problems.get(n.index) ?? [], message]);
	for (const group of idGroups(root)) {
		for (const [id, nodes] of group) {
			if (nodes.length > 1) {
				nodes.forEach(n => add(n, `ID가 중복되었습니다. \`${id}\` (${nodes.length}곳)`));
			}
		}
	}
	const data = dataColumns(root);
	const defined = new Set([...script.matchAll(/\bscwin\.([\w$]+)\s*=/g)].map(m => m[1]));
	const visit = (n: XmlNode) => {
		for (const [name, value] of Object.entries(n.attrs)) {
			if (value.startsWith('data:')) {
				for (const ref of dataRefs(value)) {
					const target = data.get(ref.id);
					if (ref.column && target?.columns && !target.columns.has(ref.column)) {
						add(n, `${target.kind}에 존재하지 않는 ID입니다. \`${ref.id}.${ref.column}\``);
					}
				}
			}
			const handler = name.startsWith(EV) ? /^scwin\.([\w$]+)$/.exec(value.trim())?.[1] : undefined;
			if (handler && !defined.has(handler)) {
				add(n, `등록되지 않은 handler가 적용되어 있습니다. \`scwin.${handler}\``);
			}
		}
		n.children.forEach(visit);
	};
	visit(root);
	return problems;
}

/** 문제가 있는 노드의 조상들(접힌 줄에도 안쪽 문제를 표시) */
export function problemAncestors(root: XmlNode, problems: Map<number, string[]>): Set<number> {
	const ancestors = new Set<number>();
	if (!problems.size) { return ancestors; }
	const visit = (n: XmlNode): boolean => {
		let inside = false;
		for (const child of n.children) {
			if (visit(child)) { inside = true; }
		}
		if (inside) { ancestors.add(n.index); }
		return inside || problems.has(n.index);
	};
	visit(root);
	return ancestors;
}
