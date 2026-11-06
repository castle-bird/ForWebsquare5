import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';

const GUIDE = 'var(--vscode-editorIndentGuide-background1, var(--vscode-editorIndentGuide-background))';
const ACTIVE_GUIDE = 'var(--vscode-editorIndentGuide-activeBackground1, var(--vscode-editorIndentGuide-activeBackground))';
const ratio = () => window.devicePixelRatio || 1;

/** 빌드 패치가 그리는 안내선의 두께와 원점을 화면 픽셀에 맞춘다. 들여쓰기·활성 범위 판별은 기존 확장이 맡는다. */
export function indentGuides() {
	return [indentationMarkers({ colors: { light: GUIDE, dark: GUIDE, activeLight: ACTIVE_GUIDE, activeDark: ACTIVE_GUIDE } }), ViewPlugin.fromClass(class {
		current = ratio();
		media?: MediaQueryList;
		constructor(readonly view: EditorView) {
			this.listen();
			window.addEventListener('resize', this.refresh);
			view.scrollDOM.addEventListener('scroll', this.measure, { passive: true });
			this.measure();
		}
		update(u: ViewUpdate) { if (u.geometryChanged || u.viewportChanged) { this.measure(); } }
		readonly measure = () => this.view.requestMeasure({
			key: this,
			read: view => ({ pixel: 1 / (ratio() * view.scaleX), origin: view.contentDOM.getBoundingClientRect().left / view.scaleX + 2 }),
			write: ({ pixel, origin }, view) => {
				const css = view.dom.style;
				if (css.getPropertyValue('--indent-guide-pixel') !== `${pixel}px`) { css.setProperty('--indent-guide-pixel', `${pixel}px`); }
				if (css.getPropertyValue('--indent-guide-origin') !== `${origin}px`) { css.setProperty('--indent-guide-origin', `${origin}px`); }
			},
		});
		listen() {
			this.media?.removeEventListener('change', this.refresh);
			this.media = window.matchMedia(`(resolution: ${this.current}dppx)`);
			this.media.addEventListener('change', this.refresh);
		}
		readonly refresh = () => {
			if (this.current !== ratio()) { this.current = ratio(); this.listen(); }
			this.measure();
		};
		destroy() {
			this.media?.removeEventListener('change', this.refresh);
			window.removeEventListener('resize', this.refresh);
			this.view.scrollDOM.removeEventListener('scroll', this.measure);
		}
	})];
}
