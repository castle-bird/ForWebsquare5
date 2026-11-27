// Git 변경 표시: 기준 내용(스테이지)과 지금 내용을 줄 단위로 비교해 줄 번호 옆 막대(추가·수정·삭제)와 오른쪽 끝 띠(파일 전체 위치)로 보여 준다.
// 변경 막대를 클릭하면 VS Code Peek Diff 스타일의 인라인 비교 창(이전/다음 변경 이동·청크 되돌리기·닫기)을 연다
import { diff, presentableDiff } from '@codemirror/merge';
import { highlightingFor, language, syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateEffect, StateField, Text, type Extension, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutter, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { highlightTree, type Tag } from '@lezer/highlight';

type Kind = 'added' | 'modified' | 'deleted';
/** 바뀐 줄 범위(1부터, 끝 포함). 삭제는 지워진 자리 바로 아래 줄 하나 */
type Range = { from: number; to: number; kind: Kind };
/** 변경 청크 하나: from/to는 거터·미니맵 표시 범위(1부터), a0..a1·b0..b1은 기준·현재 문서의 0-based 반열림 줄 범위 */
type Hunk = Range & { a0: number; a1: number; b0: number; b1: number };
type ChangesData = { base: Text; ranges: Hunk[] };

// 아주 큰 파일에서 비교가 오래 걸리면 덜 정밀한 비교로 넘어간다
const DIFF = { timeout: 300 };
const MAX_HIGHLIGHT_LEN = 8000;
const MAX_WORD_DIFF_LEN = 20000;
const KIND_LABEL: Record<Kind, string> = { modified: '수정', added: '추가', deleted: '삭제' };

/**
 * 줄 단위 비교(VS Code 줄 옆 변경 표시처럼): 내용이 같은 줄은 같은 글자로 바꿔 두 문자열을 비교한다.
 * 서로 다른 줄이 한 글자 범위(서로게이트 제외 약 6만 3천 개)를 넘으면 표시하지 않는다
 */
function lineChanges(base: Text, doc: Text): Hunk[] {
	const ids = new Map<string, number>();
	const encode = (text: Text) => {
		const out: string[] = [];
		for (const line of text.iterLines()) {
			let id = ids.get(line);
			if (id === undefined) {
				ids.set(line, id = ids.size);
			}
			out.push(String.fromCharCode(id < 0xD800 ? id : id + 0x800));
		}
		return out.join('');
	};
	const a = encode(base), b = encode(doc);
	if (ids.size > 0xFFFF - 0x800) {
		return [];
	}
	let baseLines: string[] | undefined, docLines: string[] | undefined;
	const raw = diff(a, b, DIFF);
	const out: Hunk[] = [];
	let prevA = 0, prevB = 0;
	for (let i = 0; i < raw.length; i++) {
		const c = raw[i];
		const nextA = i + 1 < raw.length ? raw[i + 1].fromA : base.lines;
		const nextB = i + 1 < raw.length ? raw[i + 1].fromB : doc.lines;
		const maxUp = Math.min(c.fromA - prevA, c.fromB - prevB);
		const maxDown = Math.min(nextA - c.toA, nextB - c.toB);
		let hunk: Hunk;
		if (c.fromB === c.toB) {
			const shift = bestShift(baseLines ??= [...base.iterLines()], c.fromA, c.toA, maxUp, maxDown);
			const a0 = c.fromA + shift, a1 = c.toA + shift, b0 = c.fromB + shift;
			const at = Math.min(b0 + 1, doc.lines);
			hunk = { from: at, to: at, kind: 'deleted', a0, a1, b0, b1: b0 };
		} else if (c.fromA === c.toA) {
			const shift = bestShift(docLines ??= [...doc.iterLines()], c.fromB, c.toB, maxUp, maxDown);
			const a0 = c.fromA + shift, b0 = c.fromB + shift, b1 = c.toB + shift;
			hunk = { from: b0 + 1, to: b1, kind: 'added', a0, a1: a0, b0, b1 };
		} else {
			hunk = { from: c.fromB + 1, to: c.toB, kind: 'modified', a0: c.fromA, a1: c.toA, b0: c.fromB, b1: c.toB };
		}
		out.push(hunk);
		prevA = hunk.a1;
		prevB = hunk.b1;
	}
	return out;
}

const indentOf = (line: string) => {
	let width = 0;
	for (const ch of line) {
		if (ch === ' ') { width++; } else if (ch === '	') { width += 4; } else { break; }
	}
	return line.trim() ? width : 0;
};

/**
 * 같은 줄이 반복되면 같은 추가·삭제를 여러 자리로 풀이할 수 있다(<row>…</row> 뒤에 <row>…</row>를 넣으면 비교 결과가 한 줄 아래로 밀리는 식).
 * 내용이 그대로인 만큼 위아래로 밀어 본 자리 중 첫·끝 줄 들여쓰기 합이 가장 작은(블록의 시작과 끝에 가까운) 자리를 고른다. 같으면 원래 자리.
 * maxUp·maxDown은 이웃 변경과 겹치지 않는 범위로 제한한다
 */
function bestShift(lines: string[], from: number, to: number, maxUp: number, maxDown: number): number {
	let up = 0, down = 0;
	while (up < maxUp && from - up > 0 && lines[from - up - 1] === lines[to - up - 1]) { up++; }
	while (down < maxDown && to + down < lines.length && lines[from + down] === lines[to + down]) { down++; }
	let best = 0, bestScore = Infinity;
	for (let k = -up; k <= down; k++) {
		const score = indentOf(lines[from + k]) + indentOf(lines[to + k - 1]);
		if (score < bestScore || (score === bestScore && Math.abs(k) < Math.abs(best))) {
			best = k;
			bestScore = score;
		}
	}
	return best;
}

/** 0-based 반열림 줄 범위 [l0, l1)의 텍스트(끝 줄바꿈 제외) */
function sliceLines(text: Text, l0: number, l1: number): string {
	return l0 < l1 ? text.sliceString(text.line(l0 + 1).from, text.line(l1).to) : '';
}

/** 이 청크의 Peek 위젯을 끼워 넣을 문서 위치와 방향(수정·추가·파일 끝 삭제는 아래, 중간 삭제는 삭제된 자리 위) */
function hunkWidgetAnchor(doc: Text, hunk: Hunk): { pos: number; side: -1 | 1 } {
	if (hunk.b0 < hunk.b1) {
		return { pos: doc.line(Math.min(hunk.to, doc.lines)).to, side: 1 };
	}
	if (hunk.b0 < doc.lines) {
		return { pos: doc.line(hunk.b0 + 1).from, side: -1 };
	}
	return { pos: doc.line(doc.lines).to, side: 1 };
}

/** 이 청크를 Git 기준 내용으로 되돌린다 */
function revertHunk(view: EditorView, base: Text, hunk: Hunk): void {
	if (view.state.readOnly) { return; }
	const { doc } = view.state;
	const { a0, a1, b0, b1 } = hunk;
	let from: number, to: number, insert: string;
	if (a0 < a1 && b0 < b1) {
		from = doc.line(b0 + 1).from;
		to = doc.line(b1).to;
		insert = sliceLines(base, a0, a1);
	} else if (a0 === a1 && b0 < b1) {
		if (b1 < doc.lines) {
			from = doc.line(b0 + 1).from;
			to = doc.line(b1 + 1).from;
		} else if (b0 > 0) {
			from = doc.line(b0).to;
			to = doc.line(b1).to;
		} else {
			from = 0;
			to = doc.length;
		}
		insert = '';
	} else if (a0 < a1 && b0 === b1) {
		const orig = sliceLines(base, a0, a1);
		if (b0 < doc.lines) {
			from = to = doc.line(b0 + 1).from;
			insert = `${orig}\n`;
		} else {
			from = to = doc.length;
			insert = `\n${orig}`;
		}
	} else {
		return;
	}
	view.dispatch({ changes: { from, to, insert }, userEvent: 'revert' });
}

type SpanRange = readonly [number, number];
type SyntaxSpan = readonly [number, number, string];

/** 문법 트리를 [from, to, cssClass] 배열로 뽑는다(텍스트 기준 0-based 오프셋) */
function collectSyntax(state: EditorState, text: string, docOffset?: number): SyntaxSpan[] {
	if (!text || text.length > MAX_HIGHLIGHT_LEN) { return []; }
	const spans: SyntaxSpan[] = [];
	const highlighter = { style: (tags: readonly Tag[]) => highlightingFor(state, tags) };
	if (docOffset !== undefined) {
		highlightTree(syntaxTree(state), highlighter, (from, to, cls) => {
			if (cls) { spans.push([from - docOffset, to - docOffset, cls]); }
		}, docOffset, docOffset + text.length);
		return spans;
	}
	const lang = state.facet(language);
	if (!lang) { return []; }
	highlightTree(lang.parser.parse(text), highlighter, (from, to, cls) => {
		if (cls) { spans.push([from, to, cls]); }
	});
	return spans;
}

/** 여러 줄 텍스트에 문법 강조 + 낱말 diff 강조를 겹쳐 Peek diff 줄 DOM을 만든다 */
function renderDiffLines(
	container: HTMLElement,
	kind: 'del' | 'add',
	text: string,
	startLine: number,
	syntax: SyntaxSpan[],
	words: SpanRange[],
): void {
	const wordCls = kind === 'del' ? 'cm-git-peek-word-del' : 'cm-git-peek-word-add';
	const sign = kind === 'del' ? '-' : '+';
	let lineNo = startLine;
	let si = 0, wi = 0;

	const makeRow = (n: number) => {
		const row = document.createElement('div');
		row.className = `cm-git-peek-line cm-git-peek-${kind}`;
		const gutterEl = document.createElement('span');
		gutterEl.className = 'cm-git-peek-gutter';
		const oldLn = document.createElement('span');
		oldLn.className = 'cm-git-peek-ln';
		const newLn = document.createElement('span');
		newLn.className = 'cm-git-peek-ln';
		if (kind === 'del') { oldLn.textContent = String(n); } else { newLn.textContent = String(n); }
		const signEl = document.createElement('span');
		signEl.className = 'cm-git-peek-sign';
		signEl.textContent = sign;
		gutterEl.append(oldLn, newLn, signEl);
		const code = document.createElement('span');
		code.className = 'cm-git-peek-code';
		row.append(gutterEl, code);
		container.appendChild(row);
		return code;
	};

	let code = makeRow(lineNo);
	let lineStart = 0;
	let lineEnd = text.indexOf('\n');
	if (lineEnd < 0) { lineEnd = text.length; }
	const isWholeLineWord = (ls: number, le: number) => {
		if (ls >= le) { return false; }
		while (wi < words.length && words[wi][1] <= ls) { wi++; }
		return wi < words.length && words[wi][0] <= ls && words[wi][1] >= le;
	};
	let skipWord = isWholeLineWord(lineStart, lineEnd);

	for (let pos = 0; pos < text.length;) {
		if (text.charCodeAt(pos) === 10) {
			if (!code.firstChild) { code.appendChild(document.createElement('br')); }
			lineNo++;
			code = makeRow(lineNo);
			pos++;
			lineStart = pos;
			lineEnd = text.indexOf('\n', pos);
			if (lineEnd < 0) { lineEnd = text.length; }
			skipWord = isWholeLineWord(lineStart, lineEnd);
			continue;
		}
		while (si < syntax.length && syntax[si][1] <= pos) { si++; }
		while (wi < words.length && words[wi][1] <= pos) { wi++; }
		let stop = lineEnd;
		let synCls = '';
		if (si < syntax.length) {
			const [sf, st, sc] = syntax[si];
			if (sf <= pos) { synCls = sc; stop = Math.min(stop, st); } else { stop = Math.min(stop, sf); }
		}
		let inWord = false;
		if (!skipWord && wi < words.length) {
			const [wf, wt] = words[wi];
			if (wf <= pos) { inWord = true; stop = Math.min(stop, wt); } else { stop = Math.min(stop, wf); }
		}
		const chunk = text.slice(pos, stop);
		const cls = synCls && inWord ? `${synCls} ${wordCls}` : synCls || (inWord ? wordCls : '');
		if (cls) {
			const span = document.createElement('span');
			span.className = cls;
			span.textContent = chunk;
			code.appendChild(span);
		} else {
			code.appendChild(document.createTextNode(chunk));
		}
		pos = stop;
	}
	if (!code.firstChild) { code.appendChild(document.createElement('br')); }
}

const setBase = StateEffect.define<Text | null>();
const refresh = StateEffect.define<null>();
const setPeek = StateEffect.define<number | null>();
/** 입력이 멈추고 이 시간 뒤에 다시 비교한다(긴 파일에서 입력마다 전체를 비교하면 느리다) */
const SETTLE_MS = 200;

function closePeek(view: EditorView): void {
	if (view.state.field(peekField, false)?.peek) {
		view.dispatch({ effects: setPeek.of(null) });
	}
}

function openPeekIndex(view: EditorView, index: number): void {
	const data = view.state.field(changes, false);
	if (!data || index < 0 || index >= data.ranges.length) { return; }
	const { pos } = hunkWidgetAnchor(view.state.doc, data.ranges[index]);
	view.dispatch({
		effects: [
			setPeek.of(index),
			EditorView.scrollIntoView(pos, { y: 'center' }),
		],
	});
}

function togglePeekAtLine(view: EditorView, lineNo: number): void {
	const data = view.state.field(changes, false);
	if (!data) { return; }
	const index = data.ranges.findIndex(r => lineNo >= r.from && lineNo <= r.to);
	if (index < 0) { return; }
	const current = view.state.field(peekField, false)?.peek;
	if (current && current.index === index) {
		closePeek(view);
		return;
	}
	openPeekIndex(view, index);
}

class PeekWidget extends WidgetType {
	constructor(
		readonly base: Text,
		readonly hunk: Hunk,
		readonly index: number,
		readonly total: number,
		readonly oldText: string,
		readonly newText: string,
		readonly docOffset: number,
		readonly readOnly: boolean,
		readonly rev: number,
	) {
		super();
	}

	eq(other: WidgetType): boolean {
		return other instanceof PeekWidget
			&& other.index === this.index
			&& other.total === this.total
			&& other.hunk.kind === this.hunk.kind
			&& other.hunk.a0 === this.hunk.a0
			&& other.hunk.a1 === this.hunk.a1
			&& other.hunk.b0 === this.hunk.b0
			&& other.hunk.b1 === this.hunk.b1
			&& other.oldText === this.oldText
			&& other.newText === this.newText
			&& other.readOnly === this.readOnly
			&& other.rev === this.rev;
	}

	toDOM(view: EditorView): HTMLElement {
		const { hunk, index, total, oldText, newText, readOnly } = this;
		const root = document.createElement('div');
		root.className = `cm-git-peek cm-git-peek-${hunk.kind}`;
		root.setAttribute('role', 'region');
		root.setAttribute('aria-label', 'Git 변경 비교');
		root.tabIndex = -1;
		root.addEventListener('keydown', e => {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				closePeek(view);
				view.focus();
			}
		});

		// VS Code Peek View 스타일 헤더 바
		const head = document.createElement('div');
		head.className = 'cm-git-peek-head';
		const title = document.createElement('div');
		title.className = 'cm-git-peek-title';
		const kindEl = document.createElement('span');
		kindEl.className = 'cm-git-peek-kind';
		kindEl.textContent = KIND_LABEL[hunk.kind];
		const countEl = document.createElement('span');
		countEl.className = 'cm-git-peek-count';
		countEl.textContent = `${index + 1} / ${total}`;
		title.append(kindEl, countEl);

		const delCount = hunk.a1 - hunk.a0;
		const addCount = hunk.b1 - hunk.b0;
		if (delCount > 0 || addCount > 0) {
			const stats = document.createElement('span');
			stats.className = 'cm-git-peek-stats';
			if (delCount > 0) {
				const d = document.createElement('span');
				d.className = 'cm-git-peek-stat-del';
				d.textContent = `-${delCount}`;
				stats.appendChild(d);
			}
			if (addCount > 0) {
				const a = document.createElement('span');
				a.className = 'cm-git-peek-stat-add';
				a.textContent = `+${addCount}`;
				stats.appendChild(a);
			}
			title.appendChild(stats);
		}

		const actions = document.createElement('div');
		actions.className = 'cm-git-peek-actions';
		const makeBtn = (name: string, icon: string, label: string, disabled: boolean, onClick: () => void, extraCls = '') => {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.name = name;
			btn.className = extraCls ? `cm-git-peek-btn ${extraCls}` : 'cm-git-peek-btn';
			btn.title = label;
			btn.setAttribute('aria-label', label);
			btn.disabled = disabled;
			const ic = document.createElement('span');
			ic.className = `codicon codicon-${icon}`;
			ic.setAttribute('aria-hidden', 'true');
			btn.appendChild(ic);
			btn.addEventListener('mousedown', e => e.preventDefault());
			btn.addEventListener('click', e => {
				e.preventDefault();
				e.stopPropagation();
				if (!btn.disabled) { onClick(); }
			});
			return btn;
		};

		const multi = total > 1;
		actions.append(
			makeBtn('prev', 'arrow-up', '이전 변경 사항', !multi, () => openPeekIndex(view, (index - 1 + total) % total)),
			makeBtn('next', 'arrow-down', '다음 변경 사항', !multi, () => openPeekIndex(view, (index + 1) % total)),
			Object.assign(document.createElement('span'), { className: 'cm-git-peek-divider' }),
			makeBtn('revert', 'discard', '이 변경 사항을 Git 기준으로 되돌립니다', readOnly, () => {
				view.dispatch({ effects: refresh.of(null) });
				const latest = view.state.field(changes, false);
				const active = view.state.field(peekField, false)?.peek;
				const currentHunk = latest && active ? latest.ranges[active.index] : undefined;
				if (latest && currentHunk) {
					revertHunk(view, latest.base, currentHunk);
					view.focus();
				}
			}, 'cm-git-peek-revert'),
			makeBtn('close', 'close', '닫기 (Esc)', false, () => { closePeek(view); view.focus(); }, 'cm-git-peek-close'),
		);
		head.append(title, actions);

		// 인라인 Diff 본문(삭제된 원본 줄 + 현재 변경 줄, 낱말 단위 차이·문법 강조 포함)
		const body = document.createElement('div');
		body.className = 'cm-git-peek-body';
		const lines = document.createElement('div');
		lines.className = 'cm-git-peek-lines';
		const lnDigits = Math.max(2, String(Math.max(hunk.a1, hunk.b1)).length);
		lines.style.setProperty('--ln-ch', `${lnDigits}ch`);

		let delWords: SpanRange[] = [];
		let addWords: SpanRange[] = [];
		if (hunk.a0 < hunk.a1 && hunk.b0 < hunk.b1 && oldText.length + newText.length <= MAX_WORD_DIFF_LEN) {
			const wd = presentableDiff(oldText, newText, DIFF);
			delWords = wd.filter(c => c.fromA < c.toA).map(c => [c.fromA, c.toA] as const);
			addWords = wd.filter(c => c.fromB < c.toB).map(c => [c.fromB, c.toB] as const);
		}
		if (hunk.a0 < hunk.a1) {
			renderDiffLines(lines, 'del', oldText, hunk.a0 + 1, collectSyntax(view.state, oldText), delWords);
		}
		if (hunk.b0 < hunk.b1) {
			renderDiffLines(lines, 'add', newText, hunk.b0 + 1, collectSyntax(view.state, newText, this.docOffset), addWords);
		}

		body.appendChild(lines);
		root.append(head, body);
		return root;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

// 입력 중에는 이전 표시를 그대로 두고(줄이 바뀐 만큼 어긋날 수 있어 범위만 문서 안으로 자른다) 멈춘 뒤 refresh로 다시 계산한다
const changes = StateField.define<ChangesData | null>({
	create: () => null,
	update(value, tr) {
		for (const e of tr.effects) {
			if (e.is(setBase)) {
				return e.value && { base: e.value, ranges: lineChanges(e.value, tr.state.doc) };
			}
			if (e.is(refresh) && value) {
				return { base: value.base, ranges: lineChanges(value.base, tr.state.doc) };
			}
		}
		return value;
	},
});

type PeekCursor = { index: number; anchor: number; rev: number };
type PeekFieldState = { peek: PeekCursor | null; deco: DecorationSet };

function buildPeekDeco(state: EditorState, peek: PeekCursor | null): DecorationSet {
	if (!peek) { return Decoration.none; }
	const data = state.field(changes, false);
	const hunk = data?.ranges[peek.index];
	if (!data || !hunk) { return Decoration.none; }
	const { doc } = state;
	// 입력 직후 아직 refresh 전이라 이전 줄 범위가 문서 끝을 넘기면 잠시 그리지 않는다
	if (hunk.b1 > doc.lines || hunk.b0 > doc.lines) { return Decoration.none; }
	const { pos, side } = hunkWidgetAnchor(doc, hunk);
	const oldText = sliceLines(data.base, hunk.a0, hunk.a1);
	const newText = sliceLines(doc, hunk.b0, hunk.b1);
	const docOffset = hunk.b0 < hunk.b1 ? doc.line(hunk.b0 + 1).from : 0;
	const widget = new PeekWidget(data.base, hunk, peek.index, data.ranges.length, oldText, newText, docOffset, state.readOnly, peek.rev);
	return Decoration.set([Decoration.widget({ widget, block: true, side }).range(pos)]);
}

const peekField = StateField.define<PeekFieldState>({
	create: () => ({ peek: null, deco: Decoration.none }),
	update(value, tr) {
		let peek = value.peek;
		let dirty = false;
		const data = tr.state.field(changes, false);

		for (const e of tr.effects) {
			if (e.is(setPeek)) {
				dirty = true;
				if (e.value === null || !data || e.value < 0 || e.value >= data.ranges.length) {
					peek = null;
				} else {
					const { pos } = hunkWidgetAnchor(tr.state.doc, data.ranges[e.value]);
					peek = { index: e.value, anchor: pos, rev: (peek?.rev ?? 0) + 1 };
				}
			}
		}

		if (!dirty && peek) {
			if (tr.isUserEvent('revert')) {
				peek = null;
				dirty = true;
			} else if (tr.effects.some(e => e.is(setBase) || e.is(refresh))) {
				dirty = true;
				if (!data || data.ranges.length === 0) {
					peek = null;
				} else {
					const mapped = Math.min(tr.changes.mapPos(peek.anchor), tr.state.doc.length);
					const lineNo = tr.state.doc.lineAt(mapped).number;
					const idx = data.ranges.findIndex(r => lineNo >= r.from && lineNo <= r.to);
					if (idx < 0) {
						peek = null;
					} else {
						const { pos } = hunkWidgetAnchor(tr.state.doc, data.ranges[idx]);
						peek = { index: idx, anchor: pos, rev: peek.rev + 1 };
					}
				}
			} else if (tr.docChanged) {
				peek = { ...peek, anchor: tr.changes.mapPos(peek.anchor) };
				dirty = true;
			} else if (tr.reconfigured) {
				peek = { ...peek, rev: peek.rev + 1 };
				dirty = true;
			}
		}

		if (!dirty) { return value; }
		return { peek, deco: buildPeekDeco(tr.state, peek) };
	},
	provide: f => EditorView.decorations.from(f, v => v.deco),
});

const settle = ViewPlugin.fromClass(class {
	timer: ReturnType<typeof setTimeout> | undefined;
	constructor(readonly view: EditorView) {}
	syncPeekWidth() {
		this.view.requestMeasure({
			read: v => {
				const sc = v.scrollDOM;
				const gutterW = v.dom.querySelector<HTMLElement>('.cm-gutters')?.offsetWidth ?? 0;
				const padR = parseFloat(getComputedStyle(sc).paddingRight) || 0;
				const bg = getComputedStyle(v.dom).backgroundColor;
				return { left: gutterW, width: Math.max(220, sc.clientWidth - gutterW - padR), bg };
			},
			write: ({ left, width, bg }) => {
				this.view.dom.style.setProperty('--git-peek-left', `${left}px`);
				this.view.dom.style.setProperty('--git-peek-width', `${width}px`);
				if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
					this.view.dom.style.setProperty('--git-peek-bg', bg);
				}
			},
		});
	}
	update(u: ViewUpdate) {
		const hadPeek = !!u.startState.field(peekField, false)?.peek;
		const hasPeek = !!u.state.field(peekField, false)?.peek;
		if (hasPeek && (!hadPeek || u.geometryChanged || u.transactions.some(tr => tr.reconfigured))) {
			this.syncPeekWidth();
		}
		if (u.docChanged && u.state.field(changes, false)) {
			clearTimeout(this.timer);
			if (u.transactions.some(tr => tr.isUserEvent('revert'))) {
				// 청크 되돌리기 직후에는 기다리지 않고 변경 막대·미니맵을 즉시 갱신한다
				queueMicrotask(() => this.view.dispatch({ effects: refresh.of(null) }));
			} else {
				this.timer = setTimeout(() => this.view.dispatch({ effects: refresh.of(null) }), SETTLE_MS);
			}
		}
	}
	destroy() {
		clearTimeout(this.timer);
	}
});

/** 기준 내용을 바꾸는 트랜잭션 효과. 기준이 없으면(Git 밖·추적 안 함) null로 표시를 지운다 */
export const baseEffect = (text: string | undefined) => setBase.of(text === undefined ? null : Text.of(text.split(/\r\n?|\n/)));

/** 바뀐 줄 범위(미니맵도 씀) */
export const changedRanges = (state: EditorState): Range[] => state.field(changes, false)?.ranges.filter(r => r.to <= state.doc.lines) ?? [];

/** 비교 결과가 바뀌면 다른 값(미니맵 다시 그리기 판단용) */
export const changesVersion = (state: EditorState) => state.field(changes, false);

class ChangeMarker extends GutterMarker {
	constructor(readonly kind: Kind) {
		super();
	}
	eq(other: GutterMarker) {
		return other instanceof ChangeMarker && other.kind === this.kind;
	}
	toDOM() {
		return Object.assign(document.createElement('div'), {
			className: `cm-change cm-change-${this.kind}`,
			title: '클릭하여 Git 변경 비교 · 되돌리기',
		});
	}
}
const MARKERS = { added: new ChangeMarker('added'), modified: new ChangeMarker('modified'), deleted: new ChangeMarker('deleted') };

const changeGutter = gutter({
	class: 'cm-changes-gutter',
	markers: view => {
		const builder = new RangeSetBuilder<GutterMarker>();
		let last = 0;
		for (const { from, to, kind } of changedRanges(view.state)) {
			// 한 줄에 표시 하나(삭제 바로 아래 줄이 바뀐 줄이면 앞의 것)
			for (let line = Math.max(from, last + 1); line <= to; line++) {
				const pos = view.state.doc.line(line).from;
				builder.add(pos, pos, MARKERS[kind]);
				last = line;
			}
		}
		return builder.finish();
	},
	domEventHandlers: {
		mousedown(view, line, event) {
			if ((event as MouseEvent).button !== 0) { return false; }
			const lineNo = view.state.doc.lineAt(line.from).number;
			if (!changedRanges(view.state).some(r => lineNo >= r.from && lineNo <= r.to)) { return false; }
			event.preventDefault();
			togglePeekAtLine(view, lineNo);
			return true;
		},
	},
});

/** 오른쪽 끝 띠: 스크롤바 위에 파일 전체에서의 변경 위치(VS Code 개요 눈금자처럼). 클릭은 그대로 스크롤바로 간다 */
const overviewRuler = ViewPlugin.fromClass(class {
	readonly dom: HTMLElement;
	constructor(view: EditorView) {
		this.dom = view.dom.appendChild(Object.assign(document.createElement('div'), { className: 'cm-change-ruler' }));
		this.draw(view);
	}
	update(u: ViewUpdate) {
		if (u.docChanged || u.geometryChanged || u.startState.field(changes, false) !== u.state.field(changes, false)) {
			this.draw(u.view);
		}
	}
	draw(view: EditorView) {
		// 레이아웃은 측정 단계에서 읽고 쓰기 단계에서 그린다(CodeMirror 규칙)
		view.requestMeasure({
			read: v => {
				// 띠 전체 = 스크롤 영역 전체. 내용이 편집기보다 짧으면 편집기 높이(줄 위치와 띠 위치가 맞게).
				// 줄 위치는 문서 기준이라 첫 줄 위 여백(padding 등)만큼 더한다
				const offset = v.documentTop - v.dom.getBoundingClientRect().top + v.scrollDOM.scrollTop;
				const height = Math.max(v.contentHeight, v.scrollDOM.clientHeight), doc = v.state.doc;
				return changedRanges(v.state).map(({ from, to, kind }) => {
					const top = offset + v.lineBlockAt(doc.line(from).from).top, bottom = offset + v.lineBlockAt(doc.line(to).from).bottom;
					return { kind, top: top / height * 100, height: (bottom - top) / height * 100 };
				});
			},
			write: marks => this.dom.replaceChildren(...marks.map(m => {
				const mark = document.createElement('div');
				mark.className = `cm-change-mark cm-change-${m.kind}`;
				mark.style.top = `${m.top}%`;
				if (m.kind !== 'deleted') {
					mark.style.height = `${m.height}%`;
				}
				return mark;
			})),
		});
	}
	destroy() {
		this.dom.remove();
	}
});

const closeDiffOnEsc = keymap.of([{
	key: 'Escape',
	run: view => {
		if (!view.state.field(peekField, false)?.peek) { return false; }
		closePeek(view);
		return true;
	},
}]);

export const gitChanges: Extension = [changes, peekField, settle, changeGutter, overviewRuler, closeDiffOnEsc];
