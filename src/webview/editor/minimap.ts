// 코드 편집기 미니맵(막대형): 글자 대신 낱말마다 그 색의 막대를 그린다(VS Code minimap.renderCharacters: false처럼).
// 큰 흐름·오류 위치 보기용. 미니맵에 보이는 줄만 그리고(문서 크기와 상관없이 수백 줄), 문법 색은 편집기가 이미 읽어 둔 만큼만 쓴다
// (전체를 다시 읽게 하지 않는다). 입력은 잠깐 멈춘 뒤, 스크롤은 프레임당 한 번 다시 그린다. 숨은 탭은 그리지 않는다
import { highlightingFor, syntaxTree } from '@codemirror/language';
import { forEachDiagnostic } from '@codemirror/lint';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { getStyleTags } from '@lezer/highlight';
import { capturePointer } from '../ui/pointerCapture';

/** 미니맵 폭(CSS px). 글자 하나 1px, 줄 하나 LINE px */
export const MINIMAP_WIDTH = 72;
const LINE = 2;
const PAD = 4;
/** 입력이 이만큼 멈추면 다시 그림 */
const TYPING_DELAY = 150;
/** 오류·경고 색: 오른쪽 끝 표시, 줄 배경 */
const MARK = { error: '#f14c4c', other: '#cca700' };
const LINE_TINT = { error: 'rgba(244, 71, 71, .35)', other: 'rgba(204, 167, 0, .3)' };
const severity = (d: { severity: string }) => d.severity === 'error' ? 'error' : 'other';
/** 탭은 다음 탭 칸까지 */
const nextColumn = (col: number, ch: string | undefined, tab: number) => ch === '\t' ? col + tab - col % tab : col + 1;

const minimapPlugin = ViewPlugin.fromClass(class {
	readonly dom: HTMLElement;
	readonly canvas: HTMLCanvasElement;
	readonly slider: HTMLElement;
	/** 그린 범위(첫 줄 번호)와 줄 수 */
	start = 1;
	frame = 0;
	timer = 0;
	/** 테마가 바뀌면 비움: 문법 class → 색 */
	colors = new Map<string, string>();
	probe: HTMLElement;
	readonly onScroll = () => this.schedule();
	drag?: { y: number; top: number; scale: number };
	/** 그린 오류 표시(바뀌면 다시 그림) */
	problems = '';
	/** 막대를 미리 그려 둔 그림(보이는 줄 위아래로 한 화면씩 더). 스크롤은 여기서 잘라 붙이기만 한다 */
	tile = document.createElement('canvas');
	tileStart = 0;
	tileRows = 0;
	/** 그림을 다시 그려야 함(문서·테마·오류·크기가 바뀜) */
	stale = true;
	/** 스크롤바 폭·기본 글자색: 크기·테마가 바뀔 때만 잰다(스크롤마다 레이아웃·스타일 계산을 하지 않게) */
	scrollbar = 0;
	textColor = '';
	/** 입력 중(이 시각까지)에는 그림을 새로 그리지 않고 있던 것을 쓴다: 키마다 높이·화면 범위가 바뀌어 그리기가 불려도 */
	typingUntil = 0;

	constructor(readonly view: EditorView) {
		this.dom = document.createElement('div');
		this.dom.className = 'cm-minimap';
		this.canvas = this.dom.appendChild(document.createElement('canvas'));
		this.slider = this.dom.appendChild(Object.assign(document.createElement('div'), { className: 'cm-minimap-slider' }));
		this.probe = Object.assign(document.createElement('span'), { className: 'cm-minimap-probe' });
		view.dom.appendChild(this.dom);
		view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
		this.dom.addEventListener('pointerdown', this.onDown);
		this.schedule();
	}

	update(u: ViewUpdate) {
		if (u.transactions.some(tr => tr.reconfigured)) { this.colors.clear(); this.textColor = ''; this.stale = true; }
		if (u.geometryChanged) { this.textColor = ''; this.stale = true; }
		if (u.docChanged) {
			this.stale = true;
			// 입력 중에는 막대 자리만 맞추고(슬라이더) 다시 그리기는 잠깐 뒤에
			this.typingUntil = performance.now() + TYPING_DELAY;
			clearTimeout(this.timer);
			this.timer = window.setTimeout(() => this.schedule(), TYPING_DELAY);
		} else if (problemsOf(u.state) !== this.problems) {
			this.stale = true;
			this.schedule();
		} else if (u.geometryChanged || u.viewportChanged || u.transactions.some(tr => tr.reconfigured)) {
			this.schedule();
		}
	}

	schedule() {
		if (this.frame) { return; }
		this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
	}

	/** 미니맵 배치: 문서가 다 들어가면 1번 줄부터, 아니면 슬라이더가 스크롤 비율만큼 내려가고 그 밑에 보이는 줄이 오게 */
	layout() {
		const v = this.view, sc = v.scrollDOM, height = this.dom.clientHeight, total = v.state.doc.lines;
		const rows = Math.floor(height / LINE);
		const top = v.lineBlockAtHeight(sc.scrollTop), bottom = v.lineBlockAtHeight(sc.scrollTop + sc.clientHeight);
		const first = v.state.doc.lineAt(top.from).number, last = v.state.doc.lineAt(bottom.from).number;
		const sliderRows = Math.max(1, last - first + 1);
		if (total <= rows) {
			return { start: 1, rows, sliderTop: (first - 1) * LINE, sliderHeight: sliderRows * LINE, fits: true };
		}
		const range = Math.max(1, sc.scrollHeight - sc.clientHeight), ratio = Math.min(1, sc.scrollTop / range);
		const sliderHeight = sliderRows * LINE, sliderTop = Math.round(ratio * (height - sliderHeight));
		const start = Math.max(1, Math.min(total - rows + 1, first - Math.round(sliderTop / LINE)));
		return { start, rows, sliderTop: (first - start) * LINE, sliderHeight, fits: false };
	}

	draw() {
		const v = this.view;
		// 숨은 탭(display:none): 보일 때 크기가 바뀌며 다시 불린다
		if (!v.dom.offsetParent) { return; }
		if (!this.textColor) {
			this.textColor = getComputedStyle(v.contentDOM).color;
			// 스크롤바 왼쪽, 스크롤 영역 높이만(위 검색창 같은 패널을 가리지 않게). 스크롤바 폭은 테마·OS마다 다름
			const sc = v.scrollDOM;
			this.scrollbar = sc.offsetWidth - sc.clientWidth;
			Object.assign(this.dom.style, { right: `${this.scrollbar}px`, top: `${sc.offsetTop}px`, bottom: `${v.dom.clientHeight - sc.offsetTop - sc.offsetHeight}px` });
		}
		const { start, rows, sliderTop, sliderHeight } = this.layout();
		this.start = start;
		Object.assign(this.slider.style, { top: `${sliderTop}px`, height: `${sliderHeight}px` });
		const ratio = window.devicePixelRatio || 1, width = this.dom.clientWidth, height = this.dom.clientHeight;
		if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
			// 보이는 크기는 CSS(100%)가 미니맵에 맞춘다: clientHeight는 반올림이라 배율 125% 등에서 px로 박으면 1px 미만 삐져나가 바깥 스크롤이 생긴다
			Object.assign(this.canvas, { width: Math.round(width * ratio), height: Math.round(height * ratio) });
			this.stale = true;
		}
		const total = v.state.doc.lines;
		const typing = performance.now() < this.typingUntil && this.tileRows > 0;
		if ((this.stale && !typing) || start < this.tileStart || start + rows > this.tileStart + this.tileRows) {
			this.paintTile(Math.max(1, start - rows), Math.min(total, start + rows * 2), width, ratio);
		}
		const g = this.canvas.getContext('2d')!;
		g.setTransform(1, 0, 0, 1, 0, 0);
		g.clearRect(0, 0, this.canvas.width, this.canvas.height);
		const y = (start - this.tileStart) * LINE * ratio, h = Math.min(rows * LINE * ratio, this.tile.height - y);
		if (h > 0) { g.drawImage(this.tile, 0, y, this.tile.width, h, 0, 0, this.tile.width, h); }
		// 오른쪽 끝: 파일 전체에서의 오류·경고 위치(미니맵이 다 안 들어가도 보이게)
		g.setTransform(ratio, 0, 0, ratio, 0, 0);
		forEachDiagnostic(v.state, (d, dFrom) => {
			g.fillStyle = MARK[severity(d)];
			g.fillRect(width - 3, Math.min(height - 3, (v.state.doc.lineAt(dFrom).number - 1) / total * height), 3, 3);
		});
	}

	/**
	 * first~last 줄의 막대를 미리 그림에 그린다. 그림이 그대로 쓸 만하면(내용이 안 바뀜) 겹치는 줄은 옮겨 붙이고 새로 보이는 줄만 그린다
	 * (스크롤로 범위를 벗어날 때 한 프레임이 길어지지 않게)
	 */
	paintTile(first: number, last: number, width: number, ratio: number) {
		const old = this.tile, oldFirst = this.tileStart, oldLast = this.tileStart + this.tileRows - 1;
		const reuse = !this.stale && this.tileRows > 0 && old.width === Math.round(width * ratio) && first <= oldLast && last >= oldFirst;
		const tile = document.createElement('canvas');
		Object.assign(tile, { width: Math.round(width * ratio), height: Math.max(1, Math.round((last - first + 1) * LINE * ratio)) });
		const g = tile.getContext('2d')!;
		if (reuse) {
			g.drawImage(old, 0, (first - oldFirst) * LINE * ratio);
			if (first < oldFirst) { this.paintLines(g, first, first, oldFirst - 1, width, ratio); }
			if (last > oldLast) { this.paintLines(g, first, oldLast + 1, last, width, ratio); }
		} else {
			this.paintLines(g, first, first, last, width, ratio);
		}
		this.tile = tile;
		this.stale = false;
		this.problems = problemsOf(this.view.state);
		this.tileStart = first;
		this.tileRows = last - first + 1;
	}

	/** 그림(첫 줄 top) 위에 a~b 줄의 막대를 그린다 */
	paintLines(g: CanvasRenderingContext2D, top: number, a: number, b: number, width: number, ratio: number) {
		const v = this.view, doc = v.state.doc, tab = v.state.tabSize, cols = width - PAD - 4;
		g.setTransform(ratio, 0, 0, ratio, 0, 0);
		g.globalAlpha = 1;
		const from = doc.line(a).from, to = doc.line(b).to;
		// 오류·경고 줄: 옅은 배경
		forEachDiagnostic(v.state, (d, dFrom) => {
			if (dFrom < from || dFrom > to) { return; }
			g.fillStyle = LINE_TINT[severity(d)];
			g.fillRect(0, (doc.lineAt(dFrom).number - top) * LINE, width, LINE);
		});
		const columnAt = (line: { from: number; text: string }, pos: number) => {
			let col = 0;
			for (let i = 0, limit = pos - line.from; i < limit && i < line.text.length; i++) { col = nextColumn(col, line.text[i], tab); }
			return col;
		};
		// 1) 기본 글자색 막대(공백 없는 덩어리마다)
		g.globalAlpha = .6;
		g.fillStyle = this.textColor;
		for (let n = a; n <= b; n++) {
			const line = doc.line(n), y = (n - top) * LINE;
			let col = 0, run = -1;
			for (let i = 0; i <= line.text.length && col <= cols; i++) {
				const ch = line.text[i];
				const space = ch === undefined || ch === ' ' || ch === '\t';
				if (space && run >= 0) { g.fillRect(PAD + run, y, col - run, LINE - .5); run = -1; }
				else if (!space && run < 0) { run = col; }
				col = nextColumn(col, ch, tab);
			}
		}
		// 2) 문법 색: 이미 읽은 문법 트리에서 이 범위만. 안쪽 노드가 바깥 위에 덮인다
		g.globalAlpha = .9;
		syntaxTree(v.state).iterate({
			from, to,
			enter: node => {
				const style = getStyleTags(node);
				const cls = style && highlightingFor(v.state, style.tags);
				if (!cls) { return; }
				g.fillStyle = this.color(cls);
				const s = Math.max(node.from, from), e = Math.min(node.to, to);
				for (let n = doc.lineAt(s).number, endLine = doc.lineAt(e).number; n <= endLine; n++) {
					const line = doc.line(n), s0 = Math.max(s, line.from), e0 = Math.min(e, line.to);
					// 앞뒤 공백은 빼고(문자열·주석 안 공백은 그대로 막대)
					const text = line.text.slice(s0 - line.from, e0 - line.from), lead = text.length - text.trimStart().length, trail = text.length - text.trimEnd().length;
					if (lead === text.length) { continue; }
					const c0 = columnAt(line, s0 + lead), c1 = Math.min(cols, columnAt(line, e0 - trail));
					if (c1 > c0) { g.fillRect(PAD + c0, (n - top) * LINE, c1 - c0, LINE - .5); }
				}
			},
		});
		g.globalAlpha = 1;
	}

	/** 문법 class의 글자색: 편집기(테마 범위) 안, 편집 영역 밖에 잠깐 넣어 잰다(편집 영역은 CodeMirror가 변화를 지켜봄). 테마가 바뀌면 다시 */
	color(cls: string) {
		let c = this.colors.get(cls);
		if (!c) {
			this.probe.className = `cm-minimap-probe ${cls}`;
			this.dom.appendChild(this.probe);
			c = getComputedStyle(this.probe).color;
			this.probe.remove();
			this.colors.set(cls, c);
		}
		return c;
	}

	/** 슬라이더 끌기: 스크롤. 다른 곳 클릭: 그 줄이 가운데 오게 */
	readonly onDown = (e: PointerEvent) => {
		if (e.button !== 0) { return; }
		e.preventDefault();
		const v = this.view, sc = v.scrollDOM, rect = this.dom.getBoundingClientRect(), y = e.clientY - rect.top;
		const { sliderTop, sliderHeight, fits } = this.layout();
		if (y < sliderTop || y > sliderTop + sliderHeight) {
			const line = Math.min(v.state.doc.lines, Math.max(1, this.start + Math.floor(y / LINE)));
			const block = v.lineBlockAt(v.state.doc.line(line).from);
			sc.scrollTop = block.top - sc.clientHeight / 2;
		}
		const total = v.state.doc.lines;
		// 끈 픽셀 → 스크롤: 다 들어가면 줄 비율, 아니면 슬라이더가 움직일 수 있는 거리 비율
		const scale = fits ? sc.scrollHeight / (total * LINE) : Math.max(1, sc.scrollHeight - sc.clientHeight) / Math.max(1, rect.height - sliderHeight);
		this.drag = { y: e.clientY, top: sc.scrollTop, scale };
		capturePointer({ currentTarget: this.dom, pointerId: e.pointerId });
		this.dom.classList.add('dragging');
		const stop = new AbortController(), { signal } = stop;
		const up = () => { this.drag = undefined; this.dom.classList.remove('dragging'); stop.abort(); };
		this.dom.addEventListener('pointermove', ev => { if (this.drag) { sc.scrollTop = this.drag.top + (ev.clientY - this.drag.y) * this.drag.scale; } }, { signal });
		this.dom.addEventListener('pointerup', up, { signal });
		this.dom.addEventListener('pointercancel', up, { signal });
	};

	destroy() {
		cancelAnimationFrame(this.frame);
		clearTimeout(this.timer);
		this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
		this.dom.remove();
	}
});

/** 오류·경고 위치 요약(몇 개 안 됨): 바뀌었으면 다시 그린다 */
function problemsOf(state: EditorView['state']) {
	let sig = '';
	forEachDiagnostic(state, (d, from) => { sig += `${from}${d.severity[0]},`; });
	return sig;
}

/** 켜면: 미니맵 + 그 폭만큼 내용 오른쪽 여백(줄바꿈도 그 앞에서) */
export const minimap = [minimapPlugin, EditorView.theme({ '.cm-scroller': { paddingRight: `${MINIMAP_WIDTH}px` } })];
