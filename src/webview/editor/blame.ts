// Git blame: 커서 줄 끝에 "홍길동 · 3일 전"만 흐리게(VS Code 줄 끝 blame처럼). 줄별 표는 확장이 문서 버전과 함께 보낸다.
// 편집하면 줄이 어긋나므로 다음 표가 올 때까지(입력이 멈춘 뒤 확장이 다시 구함) 숨긴다
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { Blame } from '../../core/blame';

const setBlame = StateEffect.define<Blame | null>();
export const blameEffect = (data: Blame | undefined) => setBlame.of(data ?? null);

const blameField = StateField.define<Blame | null>({
	create: () => null,
	update(value, tr) {
		for (const e of tr.effects) {
			if (e.is(setBlame)) { return e.value; }
		}
		return tr.docChanged ? null : value;
	},
});

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
const relative = new Intl.RelativeTimeFormat('ko', { numeric: 'always' });
/** "3일 전" 같은 지난 시간(1분 안이면 방금) */
export function ago(seconds: number, now = Date.now() / 1000) {
	const passed = Math.max(0, now - seconds);
	const [unit, size] = UNITS.find(([, s]) => passed >= s) ?? [];
	return unit ? relative.format(-Math.floor(passed / size!), unit) : '방금';
}

class BlameText extends WidgetType {
	constructor(readonly text: string) {
		super();
	}
	eq(other: BlameText) {
		return other.text === this.text;
	}
	toDOM() {
		return Object.assign(document.createElement('span'), { className: 'cm-blame', textContent: this.text });
	}
	ignoreEvent() {
		return false;
	}
}

const cursorBlame = EditorView.decorations.compute(['selection', blameField], state => {
	const b = state.field(blameField), line = state.doc.lineAt(state.selection.main.head), i = line.number - 1;
	if (!b || b.author[i] === undefined) { return Decoration.none; }
	const text = b.author[i] < 0 ? '커밋 안 됨' : `${b.authors[b.author[i]]} · ${ago(b.time[i])}`;
	return Decoration.set([Decoration.widget({ widget: new BlameText(text), side: 1 }).range(line.to)]);
});

export const blame: Extension = [blameField, cursorBlame];
