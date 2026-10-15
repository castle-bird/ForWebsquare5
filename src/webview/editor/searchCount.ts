// Ctrl+F 검색창: 찾을 말 입력칸 옆에 지금 몇 번째/찾은 개수(VS Code처럼 "2/10"). 아직 찾은 곳으로 간 적이 없으면 "?/10", 없으면 "결과 없음".
// VS Code처럼 편집기를 클릭해 커서가 찾은 곳을 벗어나도 찾을 말·문서가 그대로면 마지막 순번을 둔다(Enter는 커서 다음으로 간다).
// 찾을 말·문서·선택이 바뀔 때만 센다. 아주 많으면 LIMIT까지만 세고 "+"를 붙인다
import { getSearchQuery, searchPanelOpen, type SearchQuery } from '@codemirror/search';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { EditorState, Text } from '@codemirror/state';

const LIMIT = 9999;

/** 찾은 개수(LIMIT에서 멈춤)와 선택이 찾은 곳이면 그 순번(아니면 0). 찾을 말이 없으면 undefined */
function countMatches(state: EditorState, query: SearchQuery): { current: number; total: number } | undefined {
	if (!query.valid) {
		return undefined;
	}
	const { from, to } = state.selection.main;
	const cursor = query.getCursor(state);
	let total = 0, current = 0;
	for (let r = cursor.next(); !r.done && total < LIMIT; r = cursor.next()) {
		total++;
		if (r.value.from === from && r.value.to === to) {
			current = total;
		}
	}
	return { current, total };
}

export const searchCount = ViewPlugin.fromClass(class {
	readonly label = document.createElement('span');
	query?: SearchQuery;
	/** 마지막으로 머문 순번과 그때의 찾을 말·문서 */
	last?: { query: SearchQuery; doc: Text; current: number };

	constructor(readonly view: EditorView) {
		this.label.className = 'cm-search-count';
		this.label.setAttribute('aria-live', 'polite');
		this.schedule();
	}

	update(u: ViewUpdate) {
		const query = getSearchQuery(u.state);
		if (u.docChanged || u.selectionSet || !this.query?.eq(query) || searchPanelOpen(u.startState) !== searchPanelOpen(u.state)) {
			this.schedule();
		}
	}

	/** 검색창은 이 업데이트가 끝난 뒤 붙으므로 측정 차례에 넣는다 */
	schedule() {
		this.view.requestMeasure({
			key: this,
			read: view => {
				const { state } = view;
				const query = this.query = getSearchQuery(state);
				const found = searchPanelOpen(state) ? countMatches(state, query) : undefined;
				// 검색창이 닫혔거나 찾을 말이 비었으면 표시 없음
				if (!found) {
					return undefined;
				}
				if (!found.total) {
					return '결과 없음';
				}
				const kept = this.last && this.last.query.eq(query) && this.last.doc === state.doc ? this.last.current : 0;
				const current = found.current || kept;
				this.last = current ? { query, doc: state.doc, current } : undefined;
				return `${current || '?'}/${found.total}${found.total >= LIMIT ? '+' : ''}`;
			},
			write: (text, view) => {
				const field = view.dom.querySelector('.cm-search [main-field]');
				if (text === undefined || !field) {
					this.label.remove();
					return;
				}
				if (this.label.previousElementSibling !== field) {
					field.after(this.label);
				}
				this.label.textContent = text;
			},
		});
	}

	destroy() {
		this.label.remove();
	}
});
