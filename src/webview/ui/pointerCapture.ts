// 끌기용 포인터 잡기. setPointerCapture가 오류 없이 무시되는 때가 있다(Chromium: 다른 끌기 뒤 등, 테스트에서 간헐적으로 확인).
// 그러면 요소 밖으로 나간 움직임·놓기를 못 받아 끌기가 끊긴다 → 잡히지 않았으면 놓을 때까지 창에서 받아 그 요소로 다시 보낸다(React 핸들러가 그대로 받음)
const TYPES = ['pointermove', 'pointerup', 'pointercancel'] as const;

export function capturePointer(e: { currentTarget: Element; pointerId: number }): void {
	const el = e.currentTarget, id = e.pointerId;
	try { el.setPointerCapture(id); } catch { /* 합성 이벤트 등 활성 포인터가 없으면 잡지 않고 진행 */ }
	if (el.hasPointerCapture(id)) { return; }
	const stop = new AbortController();
	const forward = (ev: PointerEvent) => {
		if (ev.pointerId !== id || !ev.isTrusted) { return; }
		if (ev.type !== 'pointermove') { stop.abort(); }
		// 요소 위에서 난 것은 요소가 이미 받는다
		if (!el.isConnected || ev.composedPath().includes(el)) { return; }
		el.dispatchEvent(new PointerEvent(ev.type, ev));
	};
	TYPES.forEach(t => window.addEventListener(t, forward, { capture: true, signal: stop.signal }));
}
