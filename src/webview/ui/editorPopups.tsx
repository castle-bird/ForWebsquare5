// 데이터·Submission·선택 항목·그리드 팝업: 열기, 최신 노드 찾기, 적용 응답과 오류를 한곳에서 관리한다.
import { useEffect, useState } from 'react';
import type { ToExtension, ToWebview } from '../../core/protocol';
import { defOf, findNode, findTag, nodeAt, type XmlNode } from '../../core/xmlModel';
import { isDataNode } from '../../core/data';
import { newSubmissionFields, submissionFields, type SubmissionFields } from '../../core/submission';
import { post, useEditorStore } from '../store';
import type { useEventHandler } from '../eventHandler';
import { DataEditor } from './dataEditor';
import { SubmissionEditor } from './submissionEditor';
import { ChoicesEditor, choicesKind, type ChoicesKind } from './choicesEditor';
import { GridCellsEditor } from './gridCellsEditor';

type Popup = { key: string; error?: string; busy?: boolean } & (
	| { kind: 'data'; id: string }
	| { kind: 'submission'; initial: SubmissionFields; source?: { id?: string; index: number } }
	| { kind: 'choices'; index: number; id?: string; choices: ChoicesKind }
	| { kind: 'gridCells'; index: number; id?: string });

export function useEditorPopups(openEventHandler: ReturnType<typeof useEventHandler>, revealSubmissions: () => void) {
	const doc = useEditorStore(s => s.doc), defs = useEditorStore(s => s.defs), setSelected = useEditorStore(s => s.setSelected);
	const root = doc?.root, body = root?.children.find(c => c.tag === 'body');
	const model = root && findTag(root, 'xf:model'), dataCollection = model?.children.find(c => c.tag === 'w2:dataCollection');
	const submissions = model?.children.filter(c => c.tag === 'xf:submission') ?? [];
	const [popups, setPopups] = useState<Popup[]>([]);

	const updatePopup = (key: string, patch: Pick<Popup, 'error' | 'busy'>) => setPopups(curr => curr.map(p => p.key === key ? { ...p, ...patch } : p));
	const closePopup = (key: string) => setPopups(curr => curr.filter(p => p.key !== key));
	const postPopupEdit = (msg: Extract<ToExtension, { popup: string }>) => {
		updatePopup(msg.popup, { error: '', busy: true });
		post(msg);
	};

	useEffect(() => {
		const onMessage = ({ data: msg }: MessageEvent<ToWebview>) => {
			if (msg.type !== 'popupAck') { return; }
			setPopups(curr => msg.ok ? curr.filter(p => p.key !== msg.popup)
				: curr.map(p => p.key === msg.popup ? { ...p, busy: false, error: msg.error ?? '적용하지 못했습니다.' } : p));
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, []);

	const openSubmissionEditor = () => {
		if (!doc || !root || !model) { return; }
		setSelected(-1);
		setPopups(curr => [...curr, { key: crypto.randomUUID(), kind: 'submission', initial: newSubmissionFields(root) }]);
	};
	const editSubmission = (item: XmlNode) => {
		if (!doc) { return; }
		setSelected(item.index);
		const key = `sub_${item.attrs.id ?? item.index}`;
		setPopups(curr => curr.some(p => p.key === key) ? curr
			: [...curr, { key, kind: 'submission', initial: submissionFields(item), source: { id: item.attrs.id, index: item.index } }]);
	};
	const openDataPopup = (id: string) => setPopups(curr => [...curr.filter(p => p.key !== `data:${id}`), { key: `data:${id}`, kind: 'data', id }]);
	const openDataEditor = (item: XmlNode) => {
		if (item.index === -1) { openSubmissionEditor(); return; }
		if (item.tag === 'xf:submission') { editSubmission(item); return; }
		if (doc && isDataNode(item) && item.attrs.id) {
			setSelected(item.index);
			openDataPopup(item.attrs.id);
		}
	};
	const findSubmission = (source: { id?: string; index: number }) => submissions.find(s => source.id ? s.attrs.id === source.id : s.index === source.index);
	const applySubmission = (key: string, source: { id?: string; index: number } | undefined, fields: SubmissionFields) => {
		if (!doc || !model) { return; }
		revealSubmissions();
		if (!source) {
			postPopupEdit({ type: 'addSubmission', version: doc.version, index: model.index, popup: key, fields });
			return;
		}
		const node = findSubmission(source);
		if (node) {
			postPopupEdit({ type: 'editSubmission', version: doc.version, index: node.index, popup: key, fields });
		} else {
			updatePopup(key, { error: '원래 Submission을 찾지 못했습니다. 다시 열어 주세요.' });
		}
	};
	const openGridCells = (grid: XmlNode) => {
		setSelected(grid.index);
		setPopups(curr => [...curr.filter(p => p.kind !== 'gridCells'), { key: `gridCells:${grid.attrs.id ?? grid.index}`, kind: 'gridCells', index: grid.index, id: grid.attrs.id }]);
	};
	const openEditor = (index: number) => {
		const n = body && nodeAt(body, index);
		// 그리드(칸 밖 빈 곳·Outline): 칸 속성 표
		if (n?.tag.endsWith(':gridView')) { openGridCells(n); return true; }
		const kind = n && choicesKind(n, defOf(n, defs?.defs));
		if (!n || !kind) { return false; }
		setSelected(index);
		setPopups(curr => [...curr.filter(p => p.kind !== 'choices'), { key: `choices:${n.attrs.id ?? index}`, kind: 'choices', index, id: n.attrs.id, choices: kind }]);
		return true;
	};
	const choicesNode = (p: Extract<Popup, { kind: 'choices' }>) => {
		const n = root && (p.id ? findNode(root, c => c.attrs.id === p.id && choicesKind(c, defOf(c, defs?.defs)) === p.choices) : nodeAt(root, p.index));
		return n && choicesKind(n, defOf(n, defs?.defs)) === p.choices ? n : undefined;
	};
	const editors = <>
		{popups.map((p, offsetIndex) => {
			const common = { externalError: p.error, offsetIndex, onClose: () => closePopup(p.key) };
			if (p.kind === 'data') {
				const node = dataCollection?.children.find(c => c.attrs.id === p.id && isDataNode(c));
				return node && <DataEditor key={p.key} {...common} node={node}
					onApply={(fields, id) => { if (doc) { postPopupEdit({ type: 'editDataFields', version: doc.version, index: node.index, popup: p.key, fields, id }); } }} />;
			}
			if (p.kind === 'submission') {
				const { source } = p;
				return <SubmissionEditor key={p.key} {...common} initial={p.initial} editing={!!source} busy={!!p.busy}
					onScript={source && ((eventName, current) => { const target = findSubmission(source); return target && openEventHandler(target, eventName, current); })}
					onConfirm={fields => applySubmission(p.key, source, fields)} />;
			}
			if (p.kind === 'gridCells') {
				const grid = root && (p.id ? findNode(root, c => c.attrs.id === p.id && c.tag.endsWith(':gridView')) : nodeAt(root, p.index));
				return grid?.tag.endsWith(':gridView') && <GridCellsEditor key={p.key} {...common} grid={grid} defs={defs?.defs}
					onApply={cells => { if (doc) { postPopupEdit({ type: 'editGridCells', version: doc.version, index: grid.index, popup: p.key, cells }); } }} />;
			}
			const node = choicesNode(p);
			return node && <ChoicesEditor key={p.key} {...common} node={node} kind={p.choices}
				sources={dataCollection?.children.filter(c => isDataNode(c) && c.attrs.id).map(c => ({ nodeset: `data:${c.attrs.id}`,
					fields: c.children.find(i => /:(columnInfo|keyInfo)$/.test(i.tag))?.children.flatMap(f => f.attrs.id ? [f.attrs.id] : []) ?? [] })) ?? []}
				onApply={fields => { if (doc) { postPopupEdit({ type: 'editChoices', version: doc.version, index: node.index, popup: p.key, fields }); } }} />;
		})}
	</>;
	return { openSubmissionEditor, openDataPopup, openDataEditor, openGridCells, openEditor, editors };
}
