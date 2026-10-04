// 파라미터 힌트(VS Code Signature Help처럼): 괄호·쉼표를 치거나 괄호가 든 자동완성을 고르거나 Ctrl+Shift+Space를 누르면
// 커서 위에 함수 모양과 지금 파라미터를 띄운다. 떠 있는 동안 입력·커서 이동마다 다시 물어 지금 파라미터를 바꾸고,
// 결과가 없으면(괄호 밖) 닫는다. Esc로 닫음
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, keymap, showTooltip, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { SignatureInfo } from '../../core/protocol';

/** pos 자리의 파라미터 힌트를 묻는다(trigger: 방금 친 글자). 없으면 undefined */
export type SignatureSource = (view: EditorView, pos: number, trigger?: string) => Promise<SignatureInfo | undefined> | SignatureInfo | undefined;
/** 설명(마크다운)을 그리는 함수: 편집기 테마 색을 입히려고 view를 받는다 */
export type DocRenderer = (view: EditorView, markdown: string) => HTMLElement;

type Shown = { pos: number; info: SignatureInfo } | null;
const setSignature = StateEffect.define<Shown>();

/** 떠 있는 동안 다시 물을 때 기다림(입력이 멈추면) */
const UPDATE_DELAY = 120;

export function signatureHelp(ask: SignatureSource, renderDoc: DocRenderer): Extension {
	const field = StateField.define<Shown>({
		create: () => null,
		update(value, tr) {
			for (const e of tr.effects) {
				if (e.is(setSignature)) {
					return e.value;
				}
			}
			return value && tr.docChanged ? { ...value, pos: tr.changes.mapPos(value.pos) } : value;
		},
		provide: f => showTooltip.from(f, v => v && { pos: v.pos, above: true, create: view => ({ dom: signatureDom(view, v.info, renderDoc) }) }),
	});
	const requester = ViewPlugin.fromClass(class {
		/** 늦게 온 옛 결과는 버린다 */
		seq = 0;
		timer?: number;
		constructor(readonly view: EditorView) {}
		update(u: ViewUpdate) {
			let trigger: string | undefined, start = false;
			for (const tr of u.transactions) {
				const typed = tr.isUserEvent('input.type'), completed = tr.isUserEvent('input.complete');
				tr.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => {
					// `(`는 괄호 자동 닫기로 `()`가 한 번에 들어온다
					const text = inserted.toString(), typedTrigger = typed ? /([(,])\)?$/.exec(text) : null;
					if (typedTrigger) {
						start = true;
						trigger = typedTrigger[1];
					} else if (completed && text.includes('(')) {
						start = true;
					}
				});
			}
			if (start) {
				this.schedule(trigger, 0);
			} else if (u.state.field(field) && (u.docChanged || u.selectionSet)) {
				this.schedule(undefined, UPDATE_DELAY);
			}
		}
		schedule(trigger: string | undefined, delay: number) {
			clearTimeout(this.timer);
			this.timer = window.setTimeout(() => void this.ask(trigger), delay);
		}
		async ask(trigger?: string) {
			const seq = ++this.seq, view = this.view;
			const info = await Promise.resolve(ask(view, view.state.selection.main.head, trigger)).catch(() => undefined);
			if (seq !== this.seq || (!info && !view.state.field(field))) {
				return;
			}
			view.dispatch({ effects: setSignature.of(info ? { pos: view.state.selection.main.head, info } : null) });
		}
		destroy() {
			clearTimeout(this.timer);
			this.seq++;
		}
	});
	return [field, requester, keymap.of([
		{ key: 'Mod-Shift-Space', run: view => (view.plugin(requester)?.schedule(undefined, 0), true) },
		{ key: 'Escape', run: view => {
			if (!view.state.field(field)) {
				return false;
			}
			view.plugin(requester)!.seq++;
			view.dispatch({ effects: setSignature.of(null) });
			return true;
		} },
	])];
}

function signatureDom(view: EditorView, info: SignatureInfo, renderDoc: DocRenderer): HTMLElement {
	const el = (tag: string, className: string, text = '') => Object.assign(document.createElement(tag), { className, textContent: text });
	const dom = el('div', 'ws-hover ws-signature');
	const head = dom.appendChild(el('div', 'ws-sig-label'));
	if (info.count > 1) {
		head.append(el('span', 'ws-sig-count', `${info.index}/${info.count}`));
	}
	const [from, to] = info.active !== undefined ? info.params[info.active] ?? [0, 0] : [0, 0];
	head.append(info.label.slice(0, from));
	if (to > from) {
		head.append(el('strong', 'ws-sig-active', info.label.slice(from, to)));
	}
	head.append(info.label.slice(to));
	for (const doc of [info.paramDoc, info.doc]) {
		if (doc?.trim()) {
			dom.append(renderDoc(view, doc));
		}
	}
	return dom;
}
