import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { clsx } from 'clsx';
import { useDraggable, useDroppable, type ClientRect } from '@dnd-kit/core';
import { isContainer, type DropPosition } from '../../core/paste';
import type { ComponentDef } from '../../core/protocol';
import { defOf, type XmlNode } from '../../core/xmlModel';
import { outlineChildren, outlineIcon } from '../design/renderers';

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

export interface DragData { index: number; depth: number; container: boolean }

export function useFold() {
	const [state, setState] = useState<{ all?: boolean; overrides: Map<number, boolean> }>({ overrides: new Map() });
	return {
		isOpen: (n: XmlNode) => state.overrides.get(n.index) ?? state.all ?? false,
		toggle: (n: XmlNode, open: boolean) => setState(s => ({ ...s, overrides: new Map(s.overrides).set(n.index, open) })),
		setAll: (all: boolean) => setState({ all, overrides: new Map() }),
		reveal: (nodes: XmlNode[]) => setState(s => {
			const overrides = new Map(s.overrides);
			nodes.forEach(n => overrides.set(n.index, true));
			return { ...s, overrides };
		}),
	};
}
export type Fold = ReturnType<typeof useFold>;

export const REF_MIME = 'application/x-wse-ref';

export function TreeItem({ node, depth, selected, extra, onSelect, onContextMenu, onDoubleClick, fold, defs, interactive, bindRef }: {
	node: XmlNode; depth: number; selected?: number;
	extra?: number[]; onSelect(i: number, additive?: boolean): void; onContextMenu?(e: MouseEvent<HTMLDivElement>, node: XmlNode): void; onDoubleClick?(node: XmlNode): void;
	fold: Fold; defs?: ComponentDef[]; interactive?: boolean;
	bindRef?(node: XmlNode): string | undefined;
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
	const zone = drop.isOver ? dropZone(drop.active?.rect.current.translated ?? null, drop.rect.current, container, depth) : undefined;
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
				draggable={ref ? true : undefined}
				onDragStart={ref ? e => {
					e.dataTransfer.setData(REF_MIME, ref);
					e.dataTransfer.setData('text/plain', ref);
					e.dataTransfer.effectAllowed = 'link';
					setDragGhost(e.dataTransfer, defs ? outlineIcon(node, defs) : 'symbol-field', ref);
				} : undefined}
				{...(draggable ? drag.listeners : undefined)} {...(draggable ? drag.attributes : undefined)}>
				<span className={clsx('chevron', { hidden: !hasChildren, open })} onClick={e => { e.stopPropagation(); fold.toggle(node, !open); }} />
				{defs && <span className={`codicon codicon-${outlineIcon(node, defs)} tree-icon`} />}
				<span className="tag" title={node.tag}>{name}{node.attrs.tagname && `:${node.attrs.tagname}`}</span>
				{node.attrs.id && <span className="id">{node.attrs.id}</span>}
				{cls && <span className="cls">{cls}</span>}
				{!interactive && node.attrs.name && <span className="name">{node.attrs.name}</span>}
			</div>
			{open && children.map(c => <TreeItem key={c.index} node={c} depth={depth + 1} selected={selected} extra={extra} onSelect={onSelect} onContextMenu={onContextMenu} onDoubleClick={onDoubleClick} fold={fold} defs={defs} interactive={interactive} bindRef={bindRef} />)}
		</>
	);
}

function setDragGhost(transfer: DataTransfer, icon: string, text: string) {
	const ghost = document.createElement('div');
	ghost.className = 'drag-ghost';
	ghost.append(Object.assign(document.createElement('span'), { className: `codicon codicon-${icon}` }), text);
	document.body.append(ghost);
	transfer.setDragImage(ghost, -8, -8);
	setTimeout(() => ghost.remove());
}

export const classLabel = (n: XmlNode) => n.attrs.class?.trim().split(/\s+/).filter(Boolean).map(c => `.${c}`).join('') ?? '';
