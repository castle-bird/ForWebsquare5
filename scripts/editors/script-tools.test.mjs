import assert from 'node:assert/strict';

export default async function ({ page }) {
	// 지연 응답은 커서가 바뀌는 즉시 무효화하고, Esc는 표시 전·예약 중 요청도 취소한다.
	assert.deepEqual(await page.evaluate(async () => {
		const { EditorView, showTooltip, signatureHelp } = window.testTools;
		const pending = [], info = { label: 'f(value)', params: [[2, 7]], index: 1, count: 1 };
		const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
		const view = new EditorView({ extensions: [EditorView.cspNonce.of('test'), signatureHelp(() => new Promise(resolve => pending.push(resolve)), () => document.createElement('div'))] });
		const shown = () => view.state.facet(showTooltip).some(Boolean);
		const escape = () => view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		const trigger = () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'f(' }, selection: { anchor: 2 }, userEvent: 'input.type' });
		try {
			trigger(); await tick();
			view.dispatch({ selection: { anchor: 0 } });
			pending[0](info); await tick();
			const staleHidden = !shown();
			escape(); await tick(150);
			const waitingCancelled = pending.length === 1 && !shown();
			trigger(); await tick(); pending.at(-1)(info); await tick();
			const initiallyShown = shown();
			view.dispatch({ selection: { anchor: 1 } }); escape(); await tick(150);
			const scheduledCancelled = pending.length === 2 && !shown();
			trigger(); await tick(); escape(); pending.at(-1)(info); await tick();
			return { staleHidden, waitingCancelled, initiallyShown, scheduledCancelled, escapedResponseHidden: !shown() };
		} finally { view.destroy(); }
	}), { staleHidden: true, waitingCancelled: true, initiallyShown: true, scheduledCancelled: true, escapedResponseHidden: true });
	assert.deepEqual(await page.evaluate(() => {
		const { EditorState, scriptTools, scriptLanguage } = window.testTools;
		const make = text => EditorState.create({ doc: text, extensions: [scriptLanguage] });
		const text = '/** Local docs */\nfunction local(value) {}\nlocal(1);';
		const tools = scriptTools(undefined, [], {}), state = make(text), pos = text.lastIndexOf('1');
		const first = tools.signature(state, pos)?.label;
		const moved = state.update({ selection: { anchor: pos } }).state;
		const repeated = tools.signature(moved, pos)?.label;
		const definition = tools.definition(moved, text.lastIndexOf('local') + 2);
		const edited = state.update({ changes: { from: text.indexOf('value'), to: text.indexOf('value') + 5, insert: 'changed' } }).state;
		const changed = tools.signature(edited, edited.doc.toString().lastIndexOf('1'))?.label;
		const moduleText = '/** Module docs */\napp.run = function(old) {};';
		const call = make('app.run(1);');
		const original = scriptTools(undefined, [], {}, [{ path: '/common.js', text: moduleText }]);
		const replaced = scriptTools(undefined, [], {}, [{ path: '/common.js', text: moduleText.replace('old', 'newValue') }]);
		return { first, repeated, definition, changed, moduleBefore: original.signature(call, 8)?.label, moduleAfter: replaced.signature(call, 8)?.label };
	}), { first: 'local(value)', repeated: 'local(value)', definition: { from: 27, to: 32 }, changed: 'local(changed)', moduleBefore: 'run(old)', moduleAfter: 'run(newValue)' });
	console.log('Script tools: 문서 캐시 갱신·공통 JS 교체·힌트 지연 응답·Esc 취소 passed');
}
