// 현재 화면의 Submission 흐름: 요청 데이터(ref) → Submission(action) → 응답 데이터(target)와 이벤트 핸들러.
// dataList·dataMap은 어느 쪽(요청·응답)에도 올 수 있어 종류로 방향을 가정하지 않는다
import { DATA_KINDS, modelParts, type DataKind } from './data';
import { layoutFlat, snap, snapUp } from './erdLayout';
import { parseDataRef, SUBMISSION_EVENTS } from './submission';
import type { NoteColor, ShapeKind, TableLink, UsedGroup, UsedShape, UsedTables } from './tables';
import { isWs, type XmlNode } from './xmlModel';

interface FlowData { id: string; kind: DataKind; index: number; fields: string[] }
/** ref·target의 항목 하나. data가 없으면 화면에 그런 데이터가 없는 것 */
interface FlowRef { id: string; action: string; key: string; data?: FlowData }
/** ref·target 한쪽. 값을 해석하지 못하면 items는 비고 raw에 원문 */
interface FlowSide { items: FlowRef[]; raw?: string }
export interface SubmissionFlow {
	id: string; index: number; action: string; method: string;
	request: FlowSide; response: FlowSide;
	handlers: { event: string; handler: string }[];
}

const fieldsOf = (n: XmlNode) => n.children.find(c => isWs(c, 'columnInfo') || isWs(c, 'keyInfo'))?.children.flatMap(f => f.attrs.id ? [f.attrs.id] : []) ?? [];

export function dataFlow(root: XmlNode | undefined): SubmissionFlow[] {
	const { dataCollection, submissions } = modelParts(root);
	const data = new Map<string, FlowData>();
	for (const n of dataCollection?.children ?? []) {
		const kind = DATA_KINDS.find(k => isWs(n, k));
		if (kind && n.attrs.id && !data.has(n.attrs.id)) { data.set(n.attrs.id, { id: n.attrs.id, kind, index: n.index, fields: fieldsOf(n) }); }
	}
	const side = (value: string | undefined): FlowSide => {
		const parsed = parseDataRef(value ?? '');
		return parsed ? { items: parsed.items.map(i => ({ ...i, data: data.get(i.id) })) } : { items: [], raw: value };
	};
	return submissions.map(s => ({
		id: s.attrs.id ?? '', index: s.index, action: s.attrs.action ?? '', method: s.attrs.method ?? '',
		request: side(s.attrs.ref), response: side(s.attrs.target),
		handlers: SUBMISSION_EVENTS.flatMap(event => s.attrs[`ev:${event}`]?.trim() ? [{ event, handler: s.attrs[`ev:${event}`].trim() }] : []),
	}));
}

const FLOW_PREFIX = 'flow-';
const isFlowId = (id: string) => id.startsWith(FLOW_PREFIX);

/** 줄마다 글자 폭(영문 1칸, 한글 등 2칸)을 재서 16px 격자에 맞춘 박스 너비를 구한다 */
function textBoxWidth(text: string, minWidth: number): number {
	const cols = Math.max(...text.split('\n').map(line => [...line].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x7f ? 2 : 1), 0)));
	return Math.max(minWidth, snapUp(cols * 8 + 32));
}

function sideBoxes(side: FlowSide): { kind: ShapeKind; text: string; color: NoteColor }[] {
	if (side.raw) {
		return [{ kind: 'rect', text: `[문법 오류]\n${side.raw}`, color: 'red' }];
	}
	return side.items.map(item => {
		if (!item.data) {
			return { kind: 'rect', text: `[잘못된 형식]\n${item.id}`, color: 'orange' };
		}
		const kind: ShapeKind = item.data.kind === 'dataMap' ? 'dataMap' : 'dataList';
		return { kind, text: item.id, color: 'gray' };
	});
}

/**
 * 현재 화면의 Submission 데이터 흐름을 ERD(UsedTables)의 그룹·도형·선으로 만든다.
 * 이미 그려진 Submission은 사용자가 옮긴 위치를 유지하고, 새로 그리는 것만 @dagrejs/dagre로 계산해 기존 영역과 겹치지 않는 오른쪽 빈자리에 배치한다
 */
export function applyDataFlow(current: UsedTables, flows: SubmissionFlow[]): { data: UsedTables; ids: string[] } {
	const baseGroups = current.groups.filter(g => !isFlowId(g.id));
	const baseShapes = current.shapes.filter(s => !isFlowId(s.id));
	const baseMemos = current.memos.filter(m => !isFlowId(m.id));
	const baseLinks = current.links.filter(l => !isFlowId(l.from) && !isFlowId(l.to));
	if (!flows.length) {
		return { data: { tables: current.tables, memos: baseMemos, groups: baseGroups, shapes: baseShapes, links: baseLinks }, ids: [] };
	}

	const groupById = new Map(current.groups.map(g => [g.id, g]));
	const shapeById = new Map(current.shapes.map(s => [s.id, s]));
	const usedKeys = new Set<string>();
	const prepared = flows.map((flow, i) => {
		const baseKey = flow.id || `sbm-${i}`;
		let key = baseKey, n = 2;
		while (usedKeys.has(key)) { key = `${baseKey}-${n++}`; }
		usedKeys.add(key);
		// 이전 형식(index-id)으로 저장된 그룹이 있으면 그 키를 이어받아 위치를 유지한다
		const legacyKey = `${i}-${flow.id || 'sbm'}`;
		const resolvedKey = !groupById.has(`${FLOW_PREFIX}sbm-${key}`) && groupById.has(`${FLOW_PREFIX}sbm-${legacyKey}`) ? legacyKey : key;
		const reqItems = sideBoxes(flow.request);
		const resItems = sideBoxes(flow.response);
		const actText = flow.action || '(action 없음)';
		return { flow, key: resolvedKey, reqItems, resItems, actText };
	});

	// 여러 Submission이 위아래로 놓일 때 Request·Action·Response 열 폭을 맞춰 정렬한다
	const itemW = Math.max(192, ...prepared.flatMap(p => [...p.reqItems, ...p.resItems].map(x => textBoxWidth(x.text, 192))));
	const actW = Math.max(192, ...prepared.map(p => textBoxWidth(p.actText, 192)));
	const ITEM_H = 48, ITEM_GAP = 16, ACT_H = 48;
	const OUTER_PAD_X = 32, OUTER_TOP = 48, OUTER_BOTTOM = 32;
	const SIDE_PAD_X = 32, SIDE_TOP = 48, SIDE_BOTTOM = 32, GAP_X = 64;
	const sideW = SIDE_PAD_X * 2 + itemW;

	const existingOuters = prepared.flatMap(p => { const g = groupById.get(`${FLOW_PREFIX}sbm-${p.key}`); return g ? [g] : []; });
	const occupied = [
		...current.tables.map(t => ({ x: t.x, y: t.y, w: 360, h: 80 + t.columns.length * 28 })),
		...baseMemos,
		...baseGroups,
		...baseShapes,
	];
	// 새로 추가되는 Submission의 시작 자리: 기존 흐름 그룹이 있으면 그 아래, 없으면 일반 노드 오른쪽 빈자리
	const startX = existingOuters.length ? existingOuters[0].x : occupied.length ? snap(Math.max(...occupied.map(b => b.x + b.w)) + 96) : 80;
	let curY = existingOuters.length ? snap(Math.max(...existingOuters.map(g => g.y + g.h)) + 48) : occupied.length ? snap(Math.min(...occupied.map(b => b.y))) : 128;

	const groups: UsedGroup[] = [];
	const shapes: UsedShape[] = [];
	const links: TableLink[] = [];
	const ids: string[] = [];

	for (const { flow, key, reqItems, resItems, actText } of prepared) {
		const outerId = `${FLOW_PREFIX}sbm-${key}`;
		const reqGroupId = `${FLOW_PREFIX}req-${key}`;
		const resGroupId = `${FLOW_PREFIX}res-${key}`;
		const actId = `${FLOW_PREFIX}act-${key}`;
		const inIds = reqItems.map((_, j) => `${FLOW_PREFIX}in-${key}-${j}`);
		const outIds = resItems.map((_, j) => `${FLOW_PREFIX}out-${key}-${j}`);

		const prevOuter = groupById.get(outerId);
		const prevReq = groupById.get(reqGroupId);
		const prevRes = groupById.get(resGroupId);
		const prevAct = shapeById.get(actId);
		const prevIns = inIds.map(id => shapeById.get(id));
		const prevOuts = outIds.map(id => shapeById.get(id));
		const extraIn = shapeById.has(`${FLOW_PREFIX}in-${key}-${reqItems.length}`);
		const extraOut = shapeById.has(`${FLOW_PREFIX}out-${key}-${resItems.length}`);

		// 이미 같은 구성으로 그려져 있으면 사용자가 옮긴 위치·크기를 그대로 유지한다
		if (prevOuter && prevReq && prevRes && prevAct && !extraIn && !extraOut
			&& prevAct.kind === 'controller' && prevAct.text === actText
			&& prevIns.every((s, j) => s?.kind === reqItems[j].kind && s?.text === reqItems[j].text)
			&& prevOuts.every((s, j) => s?.kind === resItems[j].kind && s?.text === resItems[j].text)) {
			groups.push(
				{ ...prevOuter, color: 'blue' },
				{ ...prevReq, color: 'red' },
				{ ...prevRes, color: 'green' },
			);
			shapes.push(
				{ ...prevAct, color: 'blue' },
				...(prevIns as UsedShape[]).map((s, j) => ({ ...s, color: reqItems[j].color })),
				...(prevOuts as UsedShape[]).map((s, j) => ({ ...s, color: resItems[j].color })),
			);
			ids.push(outerId, reqGroupId, resGroupId, actId, ...inIds, ...outIds);
			inIds.forEach(id => links.push({ from: id, to: actId, arrow: 'end', label: '' }));
			outIds.forEach(id => links.push({ from: actId, to: id, arrow: 'end', label: '' }));
			continue;
		}

		// Request·Response 안쪽 도형들과 3열(Request → Action → Response)을 @dagrejs/dagre로 배치
		const reqInner = layoutFlat(inIds.map(id => ({ id, w: itemW, h: ITEM_H })), [], { direction: 'LR', nodesep: ITEM_GAP });
		const resInner = layoutFlat(outIds.map(id => ({ id, w: itemW, h: ITEM_H })), [], { direction: 'LR', nodesep: ITEM_GAP });
		const sideH = snapUp(SIDE_TOP + Math.max(reqInner.height, resInner.height, ITEM_H) + SIDE_BOTTOM);
		const row = layoutFlat(
			[
				{ id: reqGroupId, w: sideW, h: sideH },
				{ id: actId, w: actW, h: ACT_H },
				{ id: resGroupId, w: sideW, h: sideH },
			],
			[{ from: reqGroupId, to: actId }, { from: actId, to: resGroupId }],
			{ direction: 'LR', ranksep: GAP_X },
		);
		const outerW = snapUp(OUTER_PAD_X * 2 + row.width);
		const outerH = snapUp(OUTER_TOP + row.height + OUTER_BOTTOM);

		// 구성이 바뀌었더라도 기존 그룹이 있었으면 그 그룹이 있던 자리를 기준으로 그린다
		const boxX = prevOuter ? prevOuter.x : startX;
		const boxY = prevOuter ? prevOuter.y : curY;
		if (!prevOuter) { curY += outerH + 48; }

		const reqPos = row.positions.get(reqGroupId)!;
		const actPos = row.positions.get(actId)!;
		const resPos = row.positions.get(resGroupId)!;
		const reqX = boxX + OUTER_PAD_X + reqPos.x, reqY = boxY + OUTER_TOP + reqPos.y;
		const actX = boxX + OUTER_PAD_X + actPos.x, actY = boxY + OUTER_TOP + actPos.y;
		const resX = boxX + OUTER_PAD_X + resPos.x, resY = boxY + OUTER_TOP + resPos.y;

		groups.push(
			{ id: outerId, title: flow.id || '(id 없음)', color: 'blue', x: boxX, y: boxY, w: outerW, h: outerH },
			{ id: reqGroupId, title: 'Request', color: 'red', x: reqX, y: reqY, w: sideW, h: sideH },
			{ id: resGroupId, title: 'Response', color: 'green', x: resX, y: resY, w: sideW, h: sideH },
		);
		ids.push(outerId, reqGroupId, resGroupId, actId);

		shapes.push({
			id: actId, kind: 'controller', text: actText, color: 'blue',
			x: actX, y: actY, w: actW, h: ACT_H,
		});

		const reqOffsetY = snap((sideH - SIDE_TOP - SIDE_BOTTOM - reqInner.height) / 2);
		reqItems.forEach((item, j) => {
			const id = inIds[j], p = reqInner.positions.get(id)!;
			ids.push(id);
			shapes.push({
				id, kind: item.kind, text: item.text, color: item.color,
				x: reqX + SIDE_PAD_X + p.x, y: reqY + SIDE_TOP + reqOffsetY + p.y, w: itemW, h: ITEM_H,
			});
			links.push({ from: id, to: actId, arrow: 'end', label: '' });
		});

		const resOffsetY = snap((sideH - SIDE_TOP - SIDE_BOTTOM - resInner.height) / 2);
		resItems.forEach((item, j) => {
			const id = outIds[j], p = resInner.positions.get(id)!;
			ids.push(id);
			shapes.push({
				id, kind: item.kind, text: item.text, color: item.color,
				x: resX + SIDE_PAD_X + p.x, y: resY + SIDE_TOP + resOffsetY + p.y, w: itemW, h: ITEM_H,
			});
			links.push({ from: actId, to: id, arrow: 'end', label: '' });
		});
	}

	const validIds = new Set([...current.tables, ...baseMemos, ...baseGroups, ...baseShapes, ...groups, ...shapes].map(n => n.id));
	const userLinks = current.links.filter(l => validIds.has(l.from) && validIds.has(l.to) && !(isFlowId(l.from) && isFlowId(l.to)));

	return {
		data: {
			tables: current.tables,
			memos: baseMemos,
			groups: [...baseGroups, ...groups],
			shapes: [...baseShapes, ...shapes],
			links: [...userLinks, ...links],
		},
		ids,
	};
}
