/** Ctrl(macOS는 Cmd)+key 단축키인지. Alt가 같이 눌렸으면 아니다(Shift는 상관없음: Ctrl+Shift+Z도 z) */
export const isModKey = (e: KeyboardEvent, key: string) => (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === key;
