// 표 행을 손잡이(⠿)로 끌어 순서 바꾸기(DataList·DataMap, 선택 항목 팝업, 팔레트 즐겨찾기). 놓을 자리는 행의 위·아래 절반
// 브라우저 끌기(draggable)는 끄는 동안 휠을 막아서 포인터 이벤트로 끈다: 휠로 굴리거나 목록 위·아래 가장자리로 가져가면 스크롤
import { useRef, useState, type Dispatch, type PointerEvent, type SetStateAction } from 'react';

const EDGE = 32;
const ATTR = 'data-row-drag';

/** 행을 담은 세로 스크롤 칸 */
function scrollerOf(el: HTMLElement): HTMLElement | undefined {
	for (let e = el.parentElement; e; e = e.parentElement) {
		if (/auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight) { return e; }
	}
	return undefined;
}

type Drag<U> = { uid: U; row: HTMLElement; scroller?: HTMLElement; startY: number; y: number; moved: boolean; frame?: number; drop?: { uid: U; after: boolean }; stop(): void };

export function useRowDrag<T extends { uid: string | number }>(setRows: Dispatch<SetStateAction<T[]>>, onDropped?: (uid: T['uid']) => void) {
	const drag = useRef<Drag<T['uid']>>(undefined);
	/** data 속성(문자열) → 원래 uid(숫자일 수 있음) */
	const uids = useRef(new Map<string, T['uid']>());
	const [drop, setDrop] = useState<{ uid: T['uid']; after: boolean }>();

	/** 포인터 높이(스크롤 칸 밖이면 칸 안으로 당김)에 있는 같은 목록의 행과 그 위·아래 절반 */
	const update = (d: Drag<T['uid']>) => {
		const box = d.scroller?.getBoundingClientRect();
		const y = box ? Math.max(box.top + 1, Math.min(box.bottom - 1, d.y)) : d.y;
		const row = [...d.row.parentElement!.children].find((el): el is HTMLElement => el.hasAttribute(ATTR) && (r => y >= r.top && y < r.bottom)(el.getBoundingClientRect()));
		const uid = row && uids.current.get(row.getAttribute(ATTR)!);
		const r = row?.getBoundingClientRect();
		d.drop = uid === undefined || uid === d.uid ? undefined : { uid, after: y > r!.top + r!.height / 2 };
		setDrop(current => current?.uid === d.drop?.uid && current?.after === d.drop?.after ? current : d.drop);
	};

	/** 가장자리(EDGE px 안·밖)에 머무는 동안 매 프레임 굴린다(멀수록 빠르게, 최대 8px) */
	const autoScroll = (d: Drag<T['uid']>) => {
		d.frame = undefined;
		const s = d.scroller;
		if (!s || drag.current !== d) { return; }
		const r = s.getBoundingClientRect(), up = r.top + EDGE - d.y, down = d.y - (r.bottom - EDGE);
		const step = up > 0 ? -Math.min(8, Math.ceil(up / 6)) : down > 0 ? Math.min(8, Math.ceil(down / 6)) : 0;
		const before = s.scrollTop;
		s.scrollTop += step;
		if (s.scrollTop === before) { return; }
		update(d);
		d.frame = requestAnimationFrame(() => autoScroll(d));
	};

	const end = () => {
		drag.current?.stop();
		drag.current = undefined;
		setDrop(undefined);
	};

	/** 손잡이 버튼에 */
	const handleProps = (uid: T['uid']) => ({
		onPointerDown: (e: PointerEvent<HTMLElement>) => {
			const row = e.currentTarget.closest<HTMLElement>(`[${ATTR}]`);
			if (e.button !== 0 || !row) { return; }
			end();
			e.currentTarget.setPointerCapture(e.pointerId);
			const scroller = scrollerOf(row);
			const d: Drag<T['uid']> = { uid, row, scroller, startY: e.clientY, y: e.clientY, moved: false, stop: () => { } };
			// 휠로 굴려도 포인터 아래 행이 바뀌니 놓을 자리를 다시 잡는다
			const onScroll = () => { if (d.moved) { update(d); } };
			scroller?.addEventListener('scroll', onScroll);
			d.stop = () => { scroller?.removeEventListener('scroll', onScroll); if (d.frame) { cancelAnimationFrame(d.frame); } };
			drag.current = d;
		},
		onPointerMove: (e: PointerEvent<HTMLElement>) => {
			const d = drag.current;
			if (!d) { return; }
			d.y = e.clientY;
			d.moved ||= Math.abs(d.y - d.startY) > 3;
			if (!d.moved) { return; }
			update(d);
			if (!d.frame) { autoScroll(d); }
		},
		onPointerUp: () => {
			const d = drag.current;
			end();
			const target = d?.moved && d.drop;
			if (!d || !target) { return; }
			setRows(current => {
				const from = current.findIndex(r => r.uid === d.uid), to = current.findIndex(r => r.uid === target.uid);
				if (from < 0 || to < 0 || from === to) { return current; }
				const next = [...current];
				const [item] = next.splice(from, 1);
				next.splice(to + (target.after ? 1 : 0) - (from < to ? 1 : 0), 0, item);
				return next;
			});
			onDropped?.(d.uid);
		},
		onPointerCancel: end,
	});
	/** 행(tr)에 */
	const rowProps = (uid: T['uid']) => {
		uids.current.set(String(uid), uid);
		return { [ATTR]: String(uid) };
	};
	/** 행에 붙일 놓을 자리 표시 클래스 */
	const dropClass = (uid: T['uid']) => drop?.uid === uid ? drop.after ? 'drop-after' : 'drop-before' : '';
	return { handleProps, rowProps, dropClass };
}
