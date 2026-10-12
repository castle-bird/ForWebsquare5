/** Ctrl(macOS는 Cmd)+key 단축키인지. Alt가 같이 눌렸으면 아니다(Shift는 상관없음: Ctrl+Shift+Z도 z) */
export const isModKey = (e: KeyboardEvent, key: string) => (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === key;

/** 마지막으로 누른 자리(pointerdown 경로, Shadow DOM 안까지). 같은 키가 어디를 눌렀느냐에 따라 다를 때(F2: Outline은 id 바꾸기, 화면은 부모 고르기) */
let pressed: EventTarget[] = [];
window.addEventListener('pointerdown', e => { pressed = e.composedPath(); }, true);
export const lastPressedIn = (selector: string) => pressed.some(t => t instanceof Element && t.matches(selector));
