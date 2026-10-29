// 떠 있는 창(우클릭 메뉴·도움말) 자리: floating-ui로 기준 옆에 붙이고, 화면 밖으로 나가면 뒤집거나 밀어 넣는다(실제 크기로 잰다)
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { computePosition, flip, offset, shift, type Placement, type ReferenceElement } from '@floating-ui/dom';

/** 화면 한 점(우클릭 자리)을 기준으로 */
export const pointAt = (x: number, y: number): ReferenceElement =>
	({ getBoundingClientRect: () => ({ x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0 }) });

/** ref를 붙인 요소의 자리(style). 자리를 잡기 전에는 숨긴다(엉뚱한 자리에 잠깐 보이지 않게, 숨긴 동안은 포커스도 못 받는다). 요소 크기가 바뀌면 다시 잡는다 */
export function useFloating<T extends HTMLElement>(reference: ReferenceElement | undefined, placement: Placement, gap = 0) {
	const ref = useRef<T>(null);
	const [at, setAt] = useState<{ x: number; y: number }>();
	useLayoutEffect(() => {
		setAt(undefined);
		const floating = ref.current;
		if (!reference || !floating) {
			return;
		}
		let live = true;
		const place = () => void computePosition(reference, floating, { strategy: 'fixed', placement, middleware: [offset(gap), flip(), shift({ padding: 4 })] })
			.then(p => live && setAt({ x: p.x, y: p.y }));
		place();
			// 내용이 바뀌어 창 크기가 달라지면(목록을 거르면 좁아짐) 다시 잰다: 넓을 때 밀어 넣은 자리가 그대로 남지 않게
			const resize = new ResizeObserver(place);
			resize.observe(floating);
			return () => { live = false; resize.disconnect(); };
	}, [reference, placement, gap]);
	const style: CSSProperties = at ? { left: at.x, top: at.y } : { visibility: 'hidden' };
	return { ref, style, placed: !!at };
}
