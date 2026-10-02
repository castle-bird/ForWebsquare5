// 표 행을 손잡이(⠿)로 끌어 순서 바꾸기(DataList·DataMap, 선택 항목 팝업). 놓을 자리는 행의 위·아래 절반으로
import { useRef, useState, type Dispatch, type DragEvent, type SetStateAction } from 'react';

export function useRowDrag<T extends { uid: number }>(setRows: Dispatch<SetStateAction<T[]>>, onDropped?: (uid: number) => void) {
	const dragging = useRef<number | undefined>(undefined);
	const [drop, setDrop] = useState<{ uid: number; after: boolean }>();
	const afterOf = (e: DragEvent<HTMLElement>) => {
		const rect = e.currentTarget.getBoundingClientRect();
		return e.clientY > rect.top + rect.height / 2;
	};
	/** 손잡이 버튼에 */
	const handleProps = (uid: number) => ({
		draggable: true,
		onDragStart: (e: DragEvent<HTMLElement>) => { dragging.current = uid; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(uid)); },
		onDragEnd: () => { dragging.current = undefined; setDrop(undefined); },
	});
	/** 행(tr)에 */
	const rowProps = (uid: number) => ({
		onDragOver: (e: DragEvent<HTMLElement>) => {
			if (dragging.current === undefined || dragging.current === uid) { return; }
			e.preventDefault();
			const after = afterOf(e);
			setDrop(current => current?.uid === uid && current.after === after ? current : { uid, after });
		},
		onDrop: (e: DragEvent<HTMLElement>) => {
			e.preventDefault();
			const dragged = dragging.current;
			if (dragged === undefined) { return; }
			const after = afterOf(e);
			setRows(current => {
				const from = current.findIndex(r => r.uid === dragged), to = current.findIndex(r => r.uid === uid);
				if (from < 0 || to < 0 || from === to) { return current; }
				const next = [...current];
				const [item] = next.splice(from, 1);
				next.splice(to + (after ? 1 : 0) - (from < to ? 1 : 0), 0, item);
				return next;
			});
			onDropped?.(dragged);
			dragging.current = undefined;
			setDrop(undefined);
		},
	});
	/** 행에 붙일 놓을 자리 표시 클래스 */
	const dropClass = (uid: number) => drop?.uid === uid ? drop.after ? 'drop-after' : 'drop-before' : '';
	return { handleProps, rowProps, dropClass };
}
