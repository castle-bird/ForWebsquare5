import { useEffect, useRef } from 'react';
import { onJump } from '../editor/jumps';
import { post } from '../store';

/**
 * 마우스 뒤로·앞으로 버튼(button 3·4), IDE처럼: 이 편집기 안에서 본 탭 순서와 코드 편집기 안 정의로 이동(editor/jumps.ts)을 먼저 따라가고,
 * 끝에 닿으면 VS Code 이동 기록(이전·다음 파일)으로 넘긴다.
 * 탭이 바뀌는 길(클릭·이벤트 코드 버튼 → Script 등)이 여러 곳이라 보이는 탭(shownTab)이 바뀔 때 기록한다. 지워진 연결 탭은 건너뜀(exists).
 * 버튼을 누를 때도 막아야 웹뷰 안에서 브라우저 뒤로 가기가 안 일어난다
 */
export function useTabHistory(shownTab: string, show: (name: string) => void, exists: (name: string) => boolean) {
	/** 기록 한 칸: 탭, 정의로 이동한 자리면 그 편집기 자리로 되돌리는 함수 */
	type Place = { tab: string; restore?: () => void };
	const back = useRef<Place[]>([]), forward = useRef<Place[]>([]), here = useRef<Place>({ tab: shownTab });
	// 뒤로·앞으로로 옮긴 탭은 here가 이미 그 탭이라 기록하지 않는다
	useEffect(() => {
		if (here.current.tab === shownTab) { return; }
		back.current.push(here.current);
		forward.current = [];
		here.current = { tab: shownTab };
	}, [shownTab]);
	useEffect(() => onJump((from, to) => {
		back.current.push({ tab: here.current.tab, restore: from });
		forward.current = [];
		here.current = { tab: here.current.tab, restore: to };
	}), []);
	const navigate = useRef<(isBack: boolean) => void>(undefined);
	navigate.current = isBack => {
		const from = isBack ? back.current : forward.current;
		let place = from.pop();
		while (place !== undefined && ((place.tab === shownTab && !place.restore) || !exists(place.tab))) { place = from.pop(); }
		if (place === undefined) { post({ type: 'navigate', back: isBack }); return; }
		(isBack ? forward.current : back.current).push(here.current);
		here.current = place;
		if (place.tab !== shownTab) { show(place.tab); }
		place.restore?.();
	};
	useEffect(() => {
		let pressed: number | undefined;
		const clear = () => { pressed = undefined; };
		const onMouse = (e: globalThis.MouseEvent) => {
			if (e.button !== 3 && e.button !== 4) { return; }
			e.preventDefault();
			if (e.type === 'mousedown') { pressed = e.button; return; }
			// VS Code에서 누르고 돌아온 뒤의 놓음은 이미 이동한 클릭이다.
			const button = pressed;
			clear();
			if (button === e.button) { navigate.current?.(e.button === 3); }
		};
		window.addEventListener('mousedown', onMouse, true);
		window.addEventListener('mouseup', onMouse, true);
		window.addEventListener('blur', clear);
		return () => {
			window.removeEventListener('mousedown', onMouse, true);
			window.removeEventListener('mouseup', onMouse, true);
			window.removeEventListener('blur', clear);
		};
	}, []);
}
