// Git 변경 표시: 기준 내용(스테이지)과 지금 내용을 줄 단위로 비교해 줄 번호 옆 막대(추가·수정·삭제)와 오른쪽 끝 띠(파일 전체 위치)로 보여 준다
import { diff } from '@codemirror/merge';
import { RangeSetBuilder, StateEffect, StateField, Text, type Extension, type EditorState } from '@codemirror/state';
import { EditorView, GutterMarker, gutter, ViewPlugin, type ViewUpdate } from '@codemirror/view';

type Kind = 'added' | 'modified' | 'deleted';
/** 바뀐 줄 범위(1부터, 끝 포함). 삭제는 지워진 자리 바로 아래 줄 하나 */
type Range = { from: number; to: number; kind: Kind };

// 아주 큰 파일에서 비교가 오래 걸리면 덜 정밀한 비교로 넘어간다
const DIFF = { timeout: 300 };

/**
 * 줄 단위 비교(VS Code 줄 옆 변경 표시처럼): 내용이 같은 줄은 같은 글자로 바꿔 두 문자열을 비교한다.
 * 서로 다른 줄이 한 글자 범위(서로게이트 제외 약 6만 3천 개)를 넘으면 표시하지 않는다
 */
function lineChanges(base: Text, doc: Text): Range[] {
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
	return diff(a, b, DIFF).map(c => {
		if (c.fromB === c.toB) {
			const shift = bestShift(baseLines ??= [...base.iterLines()], c.fromA, c.toA);
			const at = Math.min(c.fromB + shift + 1, doc.lines);
			return { from: at, to: at, kind: 'deleted' };
		}
		if (c.fromA === c.toA) {
			const shift = bestShift(docLines ??= [...doc.iterLines()], c.fromB, c.toB);
			return { from: c.fromB + shift + 1, to: c.toB + shift, kind: 'added' };
		}
		return { from: c.fromB + 1, to: c.toB, kind: 'modified' };
	});
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
 * 내용이 그대로인 만큼 위아래로 밀어 본 자리 중 첫·끝 줄 들여쓰기 합이 가장 작은(블록의 시작과 끝에 가까운) 자리를 고른다. 같으면 원래 자리
 * lines는 그 줄들이 들어 있는 쪽(추가는 지금 내용, 삭제는 기준 내용), [from, to)는 바뀐 줄. 반환값은 밀 줄 수(음수는 위)
 */
function bestShift(lines: string[], from: number, to: number): number {
	let up = 0, down = 0;
	while (from - up > 0 && lines[from - up - 1] === lines[to - up - 1]) { up++; }
	while (to + down < lines.length && lines[from + down] === lines[to + down]) { down++; }
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

const setBase = StateEffect.define<Text | null>();
const refresh = StateEffect.define<null>();
/** 입력이 멈추고 이 시간 뒤에 다시 비교한다(긴 파일에서 입력마다 전체를 비교하면 느리다) */
const SETTLE_MS = 200;

// 입력 중에는 이전 표시를 그대로 두고(줄이 바뀐 만큼 어긋날 수 있어 범위만 문서 안으로 자른다) 멈춘 뒤 refresh로 다시 계산한다
const changes = StateField.define<{ base: Text; ranges: Range[] } | null>({
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

const settle = ViewPlugin.fromClass(class {
	timer: ReturnType<typeof setTimeout> | undefined;
	constructor(readonly view: EditorView) {}
	update(u: ViewUpdate) {
		if (u.docChanged && u.state.field(changes, false)) {
			clearTimeout(this.timer);
			this.timer = setTimeout(() => this.view.dispatch({ effects: refresh.of(null) }), SETTLE_MS);
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
		return Object.assign(document.createElement('div'), { className: `cm-change cm-change-${this.kind}` });
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

export const gitChanges: Extension = [changes, settle, changeGutter, overviewRuler];
