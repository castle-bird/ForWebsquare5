// 편집기 오른쪽 아래에 잠깐 뜨는 알림(확장이 보낸 toast). VS Code 알림을 꺼 둬도 보인다
import { useEffect, useState } from 'react';
import { useEditorStore } from '../store';

const SHOW_MS = 3000;

/** 알림 글: `값`은 코드 모양으로, 줄바꿈은 그대로 */
const render = (message: string) => message.split('`').map((part, i) => i % 2 ? <code key={i}>{part}</code> : part);

export function Toast() {
	const toast = useEditorStore(s => s.toast);
	// 마우스를 올려 둔 동안은 안 사라진다(읽을 시간). 떼면 다시 SHOW_MS
	const [hover, setHover] = useState(false);
	useEffect(() => {
		if (!toast || hover) {
			return;
		}
		const timer = setTimeout(() => useEditorStore.setState(s => s.toast === toast ? { toast: undefined } : {}), SHOW_MS);
		return () => clearTimeout(timer);
	}, [toast, hover]);
	return toast ? <div key={toast.key} className="toast" role="status" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>{render(toast.message)}</div> : null;
}
