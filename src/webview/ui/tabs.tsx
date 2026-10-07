import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { DndContext, PointerSensor, useDraggable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent } from '@dnd-kit/core';
import { moveTab, orderTabs } from '../../core/links';

export interface TabHint { title?: string; dirty?: boolean }

type Drop = { target: string; after: boolean };

export function Tabs({ items, actions, start, end, pinned = [], position = 'top', keepMounted = [], active: activeProp, onActive, order, onReorder, hints, onTabMenu, onAdd, keys = {} }: {
	items: Record<string, ReactNode>; actions?: Record<string, ReactNode>;
	/** 탭 줄 맨 앞(탭 앞)에 둘 것 */
	start?: ReactNode; end?: ReactNode; position?: 'top' | 'bottom'; keepMounted?: string[];
	/** 탭 줄 오른쪽(end 앞)에 고정할 탭(ERD 등). 끌어 순서 바꾸기·저장 순서에서 빠진다 */
	pinned?: string[];
	active?: string; onActive?(name: string): void;
	/** onReorder가 있으면 탭을 끌어 순서를 바꾼다 */
	order?: readonly string[]; onReorder?(order: string[]): void;
	hints?: Record<string, TabHint>; onTabMenu?(name: string, e: MouseEvent): void;
	/** 있으면 탭 끝에 + 버튼 */
	onAdd?(): void;
	/** 이름이 바뀌어도 내용(편집기)을 그대로 두는 탭별 고정 키. 없으면 이름 */
	keys?: Record<string, string>;
}) {
	const names = orderTabs(Object.keys(items).filter(n => !pinned.includes(n)), order);
	const all = [...names, ...pinned.filter(n => n in items)];
	const [activeState, setActiveState] = useState(names[0]);
	const active = activeProp ?? activeState;
	const setActive = onActive ?? setActiveState;
	// 한 번이라도 연 탭(keepMounted면 이후 숨기기만). 클릭뿐 아니라 바깥에서 active를 바꾼 경우(Event script 버튼 → Script)도 남겨야
	// 다른 탭으로 갈 때 편집기가 버려지지 않는다(커서·Ctrl+Z 기록 유지). 렌더 중 갱신은 React가 권하는 파생 상태 방식
	const keyOf = (name: string) => keys[name] ?? name;
	const [visited, setVisited] = useState<string[]>([keyOf(active)]);
	if (!visited.includes(keyOf(active))) {
		setVisited([...visited, keyOf(active)]);
	}
	const [drop, setDrop] = useState<Drop>();
	const buttons = useRef(new Map<string, HTMLElement>());
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
	// 끄는 탭 가운데가 놓인 탭 기준 앞·뒤. dnd-kit의 over는 마지막 이동보다 늦게 갱신될 수 있어 탭 위치로 직접 잰다
	const dropOf = (e: DragMoveEvent | DragEndEvent): Drop | undefined => {
		const rect = e.active.rect.current.translated;
		const others = names.filter(n => n !== e.active.id).flatMap(n => {
			const r = buttons.current.get(n)?.getBoundingClientRect();
			return r ? [{ n, r }] : [];
		});
		if (!rect || !others.length) {
			return undefined;
		}
		const x = rect.left + rect.width / 2;
		const hit = others.find(({ r }) => x < r.right) ?? others.at(-1)!;
		const d = { target: hit.n, after: x > hit.r.left + hit.r.width / 2 };
		// 제자리면 표시도 바꾸기도 하지 않는다
		return moveTab(names, String(e.active.id), d.target, d.after).join() === names.join() ? undefined : d;
	};
	const onDragEnd = (e: DragEndEvent) => {
		const d = dropOf(e);
		setDrop(undefined);
		if (d && onReorder) {
			onReorder(moveTab(names, String(e.active.id), d.target, d.after));
		}
	};
	const bar = (
		<nav className="tab-bar" role="tablist">
			{start}
			<DndContext sensors={sensors} onDragMove={e => setDrop(dropOf(e))} onDragEnd={onDragEnd} onDragCancel={() => setDrop(undefined)}>
				{names.map(n => <Tab key={n} name={n} active={n === active} hint={hints?.[n]} draggable={!!onReorder} buttons={buttons.current}
					drop={drop?.target === n ? drop.after ? 'after' : 'before' : undefined}
					onClick={() => setActive(n)} onContextMenu={onTabMenu && (e => onTabMenu(n, e))} />)}
			</DndContext>
			{onAdd && <button className="tab-add codicon codicon-add" title="탭 추가" aria-label="탭 추가" onClick={onAdd} />}
			<span className="tab-actions">{actions?.[active]}</span>
			{all.slice(names.length).map(n => <button key={n} role="tab" aria-selected={n === active} className={clsx('tab-pinned', { active: n === active })} onClick={() => setActive(n)}>{n}</button>)}
			{end}
		</nav>
	);
	return (
		<>
			{position === 'top' && bar}
			{all.filter(n => n === active || (keepMounted.includes(n) && visited.includes(keyOf(n)))).map(n =>
				<div key={keyOf(n)} className="tab-body" role="tabpanel" hidden={n !== active}>{items[n]}</div>)}
			{position === 'bottom' && bar}
		</>
	);
}

function Tab({ name, active, hint, draggable, buttons, drop, onClick, onContextMenu }: {
	name: string; active: boolean; hint?: TabHint; draggable: boolean; buttons: Map<string, HTMLElement>; drop?: 'before' | 'after';
	onClick(): void; onContextMenu?(e: MouseEvent): void;
}) {
	const drag = useDraggable({ id: name, disabled: !draggable });
	return <button ref={node => {
		drag.setNodeRef(node);
		if (node) { buttons.set(name, node); } else { buttons.delete(name); }
	}} {...draggable && { ...drag.attributes, ...drag.listeners }}
		role="tab" aria-selected={active} title={hint?.title}
		className={clsx({ active, markable: !!hint, dirty: hint?.dirty, dragging: drag.isDragging }, drop && `drop-${drop}`)}
		style={drag.transform ? { transform: `translateX(${drag.transform.x}px)` } : undefined}
		onClick={onClick} onContextMenu={onContextMenu}>{name}</button>;
}
