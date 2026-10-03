// 편집기 오른쪽 아래에 잠깐 뜨는 알림(확장이 보낸 toast). VS Code 알림을 꺼 둬도 보인다
import { useEffect } from 'react';
import { useEditorStore } from '../store';

const SHOW_MS = 5000;

export function Toast() {
	const toast = useEditorStore(s => s.toast);
	useEffect(() => {
		if (!toast) {
			return;
		}
		const timer = setTimeout(() => useEditorStore.setState(s => s.toast === toast ? { toast: undefined } : {}), SHOW_MS);
		return () => clearTimeout(timer);
	}, [toast]);
	return toast ? <div key={toast.key} className="toast" role="status">{toast.message}</div> : null;
}
