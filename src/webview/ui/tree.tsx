import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { clsx } from 'clsx';
import { useDraggable, useDroppable, type ClientRect } from '@dnd-kit/core';
import { isContainer, type DropPosition } from '../../core/paste';
import type { ComponentDef } from '../../core/protocol';
import { defOf, findNode, nodeAt, VALID_ID, type XmlNode } from '../../core/xmlModel';
import { post } from '../store';
import { outlineChildren, outlineIcon } from '../design/renderers';
import { EditBox } from './editBox';

export function dropZone(activeRect: ClientRect | null, overRect: ClientRect | null, container: boolean, depth: number): DropPosition {
	if (depth === 0) {
		return 'inside';
	}
	if (!activeRect || !overRect) {
		return container ? 'inside' : 'after';
	}
	const ratio = (activeRect.top + activeRect.height / 2 - overRect.top) / overRect.height;
	if (!container) {
		return ratio < 0.5 ? 'before' : 'after';
	}
	return ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
}

/** Data 트리 끌어 옮기기(브라우저 기본 끌기: 같은 끌기를 Design에 놓으면 바인딩). zone: 이 행에 놓을 수 있으면 자리 */
export interface Reorder {
	canDrag(node: XmlNode): boolean;
	zone(over: XmlNode, ratio: number): DropPosition | undefined;
	drop(over: XmlNode, position: DropPosition): void;
	start(node: XmlNode | undefined): void;
}
const NODE_MIME = 'application/x-wse-node';

export interface DragData { index: number; depth: number; container: boolean }

export function useFold() {
	const [state, setState] = useState<{ all?: boolean; overrides: Map<number, boolean> }>({ overrides: new Map() });
	return {
		isOpen: (n: XmlNode) => state.overrides.get(n.index) ?? state.all ?? false,
		toggle: (n: XmlNode, open: boolean) => setState(s => ({ ...s, overrides: new Map(s.overrides).set(n.index, open) })),
		setAll: (all: boolean) => setState({ all, overrides: new Map() }),
		reveal: (nodes: XmlNode[]) => setState(s => {
			const closed = nodes.filter(n => !(s.overrides.get(n.index) ?? s.all ?? false));
			if (!closed.length) { return s; }
			const overrides = new Map(s.overrides);
			closed.forEach(n => overrides.set(n.index, true));
			return { ...s, overrides };
		}),
	};
}
export type Fold = ReturnType<typeof useFold>;

export const REF_MIME = 'application/x-wse-ref';

/** rename: F2로 id를 고치는 중인 노드(그 행의 id 자리가 입력칸) */
export interface Rename { index?: number; commit(node: XmlNode, id: string): void; close(): void }

/** 화면 점검(core/check): of 노드 → 문제들, inside 안쪽에 문제가 있는 노드 */
export interface Problems { of: Map<number, string[]>; inside: Set<number> }

export function TreeItem({ node, depth, selected, extra, onSelect, onContextMenu, onDoubleClick, fold, defs, interactive, bindRef, reorder, rename, problems }: {
	node: XmlNode; depth: number; selected?: number;
	extra?: number[]; onSelect(i: number, additive?: boolean): void; onContextMenu?(e: MouseEvent<HTMLDivElement>, node: XmlNode): void; onDoubleClick?(node: XmlNode): void;
	fold: Fold; defs?: ComponentDef[]; interactive?: boolean;
	bindRef?(node: XmlNode): string | undefined;
	reorder?: Reorder;
	rename?: Rename;
	problems?: Problems;
}) {
	const ref = bindRef?.(node);
	const cls = interactive ? classLabel(node) : '';
	const name = interactive && defOf(node, defs)?.display || node.tag;
	const open = fold.isOpen(node);
	const children = interactive && defs ? outlineChildren(node, defs) : node.children;
	const hasChildren = children.length > 0;
	const isSelected = node.index === selected;
	const isExtra = !!extra?.includes(node.index);
	const container = isContainer(node);
	const draggable = !!interactive && depth > 0;
	const drag = useDraggable({ id: node.index, data: { index: node.index, depth, container } satisfies DragData, disabled: !draggable });
	const drop = useDroppable({ id: node.index, data: { index: node.index, depth, container } satisfies DragData, disabled: !interactive || drag.isDragging });
	const [nativeZone, setNativeZone] = useState<DropPosition>();
	const movable = !!reorder?.canDrag(node);
	const zone = nativeZone ?? (drop.isOver ? dropZone(drop.active?.rect.current.translated ?? null, drop.rect.current, container, depth) : undefined);
	const row = useRef<HTMLDivElement>(null);
	const setRow = (el: HTMLDivElement | null) => {
		row.current = el;
		drag.setNodeRef(el);
		drop.setNodeRef(el);
	};
	useEffect(() => {
		if (isSelected) {
			row.current?.scrollIntoView({ block: 'nearest' });
		}
	}, [isSelected]);
	return (
		<>
			<div ref={setRow} role="treeitem" aria-expanded={hasChildren ? open : undefined}
				className={clsx('tree-row', { selected: isSelected || isExtra, dragging: drag.isDragging }, zone && `drop-${zone}`)}
				style={{ paddingLeft: 4 + depth * 14 }} onClick={e => onSelect(node.index, e.ctrlKey || e.metaKey)}
				onContextMenu={e => onContextMenu?.(e, node)}
				onDoubleClick={() => onDoubleClick?.(node)}
				draggable={ref || movable ? true : undefined}
				onDragStart={ref || movable ? e => {
					if (ref) {
						e.dataTransfer.setData(REF_MIME, ref);
						e.dataTransfer.setData('text/plain', ref);
					}
					if (movable) {
						e.dataTransfer.setData(NODE_MIME, String(node.index));
						reorder!.start(node);
					}
					e.dataTransfer.effectAllowed = ref && movable ? 'linkMove' : ref ? 'link' : 'move';
					setDragGhost(e.dataTransfer, defs ? outlineIcon(node, defs) : 'symbol-field', ref ?? node.attrs.id ?? node.tag);
				} : undefined}
				onDragEnd={movable ? () => reorder!.start(undefined) : undefined}
				onDragOver={reorder ? e => {
					const r = e.currentTarget.getBoundingClientRect();
					const z = e.dataTransfer.types.includes(NODE_MIME) ? reorder.zone(node, (e.clientY - r.top) / r.height) : undefined;
					if (z) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
					setNativeZone(z);
				} : undefined}
				onDragLeave={reorder ? () => setNativeZone(undefined) : undefined}
				onDrop={reorder ? e => {
					const z = nativeZone;
					setNativeZone(undefined);
					if (z) { e.preventDefault(); reorder.drop(node, z); }
				} : undefined}
				{...(draggable ? drag.listeners : undefined)} {...(draggable ? drag.attributes : undefined)}>
				<span className={clsx('chevron', { hidden: !hasChildren, open })} onClick={e => { e.stopPropagation(); fold.toggle(node, !open); }} />
				{defs && <span className={`codicon codicon-${outlineIcon(node, defs)} tree-icon`} />}
				<span className="tag" title={node.tag}>{name}{node.attrs.tagname && `:${node.attrs.tagname}`}</span>
				{rename?.index === node.index
					? <EditBox value={node.attrs.id ?? ''} multiline={false} className="tree-rename" onCommit={v => rename.commit(node, v)} onClose={rename.close} />
					: node.attrs.id && <span className="id">{node.attrs.id}</span>}
				{cls && <span className="cls">{cls}</span>}
				{problems?.of.has(node.index)
					? <span className="codicon codicon-warning tree-problem" role="img" aria-label="점검 문제" title={problems.of.get(node.index)!.join('\n').replaceAll('`', '')} />
					// 묶음 줄(Data의 Submission 등)은 문서 노드가 아니라 자식으로 본다
					: !open && problems && [node, ...children].some(c => problems.inside.has(c.index) || c !== node && problems.of.has(c.index)) && <span className="codicon codicon-warning tree-problem inside" role="img" aria-label="안쪽 점검 문제" title="안쪽에 점검 문제가 있습니다" />}
				{!interactive && node.attrs.name && <span className="name">{node.attrs.name}</span>}
			</div>
			{open && children.map(c => <TreeItem key={c.index} node={c} depth={depth + 1} selected={selected} extra={extra} onSelect={onSelect} onContextMenu={onContextMenu} onDoubleClick={onDoubleClick} fold={fold} defs={defs} interactive={interactive} bindRef={bindRef} reorder={reorder} rename={rename} problems={problems} />)}
		</>
	);
}

export function setDragGhost(transfer: DataTransfer, icon: string, text: string) {
	const ghost = document.createElement('div');
	ghost.className = 'drag-ghost';
	ghost.append(Object.assign(document.createElement('span'), { className: `codicon codicon-${icon}` }), text);
	document.body.append(ghost);
	transfer.setDragImage(ghost, -8, -8);
	setTimeout(() => ghost.remove());
}

export const classLabel = (n: XmlNode) => n.attrs.class?.trim().split(/\s+/).filter(Boolean).map(c => `.${c}`).join('') ?? '';

/**
 * Data 트리 순서 바꾸기: submission끼리(xf:model 안), dataMap·dataList끼리(DataCollection 안). 루트(-1, Submission 묶음)에 놓으면 맨 뒤
 */
export function useDataReorder(version: number | undefined, model?: XmlNode, dataCollection?: XmlNode): Reorder {
	const dragging = useRef<XmlNode>(undefined);
	const groupOf = (n: XmlNode) => n.tag === 'xf:submission' ? 'submission' : dataCollection?.children.includes(n) ? 'data' : undefined;
	return {
		canDrag: n => !!groupOf(n),
		start: n => { dragging.current = n; },
		zone: (over, ratio) => {
			const d = dragging.current, kind = d && groupOf(d);
			if (!d || !kind || over.index === d.index) { return undefined; }
			if (over.index === -1) { return kind === 'submission' ? 'inside' : undefined; }
			if (over === dataCollection) { return kind === 'data' ? 'inside' : undefined; }
			return groupOf(over) === kind ? ratio < 0.5 ? 'before' : 'after' : undefined;
		},
		drop: (over, position) => {
			const d = dragging.current;
			dragging.current = undefined;
			const target = over.index === -1 ? model : over;
			if (version !== undefined && d && target) { post({ type: 'move', version, dragged: d.index, target: target.index, position }); }
		},
	};
}

/**
 * F2: 고른 노드의 id를 트리에서 바로 고친다(없으면 새로 넣는다, VS Code 탐색기 이름 바꾸기처럼). 형식·중복은 반영 전에 확인.
 * 그 노드가 보이는 트리(Outline 또는 Data 탭)에 있을 때만
 */
export function useTreeRename(root: XmlNode | undefined, selected: number | undefined, setId: (id: string, index: number) => void): Rename {
	const [index, setIndex] = useState<number>();
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const el = e.composedPath()[0] as HTMLElement;
			if (e.key !== 'F2' || el.closest?.('input, textarea, select, [contenteditable], .code-editor')) { return; }
			const n = root && selected !== undefined ? nodeAt(root, selected) : undefined;
			const row = n && document.querySelector<HTMLElement>('.pane .tree-row.selected');
			if (n && row?.offsetParent) {
				e.preventDefault();
				setIndex(n.index);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [root, selected]);
	return {
		index,
		commit: (n, id) => {
			if (!VALID_ID.test(id)) {
				post({ type: 'warn', message: `ID 형식이 아니야: ${id || '(비어 있음)'}` });
			} else if (root && findNode(root, c => c !== n && c.attrs.id === id)) {
				post({ type: 'warn', message: `이미 있는 ID야: ${id}` });
			} else {
				setId(id, n.index);
			}
		},
		close: () => setIndex(undefined),
	};
}
