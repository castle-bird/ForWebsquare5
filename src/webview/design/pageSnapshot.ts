import type { BrowserPage } from '../../core/protocol';
import canvasCss from './canvas.css';

/** 캔버스 기본 CSS에서 편집용 안내선(그룹 점선) 규칙만 뺀 것. 프로젝트 CSS가 정한 outline은 그대로 */
const PREVIEW_CANVAS_CSS = canvasCss.replace(/^\.wse-page \.w2group \{[^}]*\}[ \t]*\r?\n/m, '');

/** 지금 Design 캔버스 화면(.wse-page)의 스냅샷. 편집용 속성(data-wse*, draggable)은 뺀다. 캔버스가 없으면 undefined */
export function pageSnapshot(sheets: string[] = [], imports: string[] = []): BrowserPage | undefined {
	const page = document.querySelector('.canvas-host')?.shadowRoot?.querySelector('.wse-page');
	if (!page) {
		return undefined;
	}
	const copy = page.cloneNode(true) as Element;
	for (const el of [copy, ...copy.querySelectorAll('*')]) {
		for (const name of el.getAttributeNames()) {
			if (name.startsWith('data-wse') || name === 'draggable') {
				el.removeAttribute(name);
			}
		}
	}
	return { html: copy.outerHTML, css: [...sheets, PREVIEW_CANVAS_CSS], imports };
}
