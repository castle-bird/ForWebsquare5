// 편집 결과(codeAck)를 받기 전 입력은 모아 뒀다가 한 번에 보낸다 (빠르게 쳐도 버전이 어긋나지 않게)
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { search } from '@codemirror/search';
import { ChangeSet, Compartment, EditorSelection, EditorState, Prec, Transaction, countColumn, type Extension, type Text } from '@codemirror/state';
import { hoverTooltip, keymap, type Command, type Tooltip } from '@codemirror/view';
import { indentLess, indentMore } from '@codemirror/commands';
import { acceptCompletion, autocompletion, type CompletionContext, type CompletionSource } from '@codemirror/autocomplete';
import { getIndentUnit, indentUnit, type LanguageSupport } from '@codemirror/language';
import { vsCodeDark } from '@fsegurai/codemirror-theme-vscode-dark';
import { vsCodeLight } from '@fsegurai/codemirror-theme-vscode-light';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { diff } from '@codemirror/merge';
import type { CodeChange, CodeTarget, ToExtension, ToWebview } from '../../core/protocol';
import type { LintSource } from '@codemirror/lint';
import { fromRemote, lintFor, remoteProblemsChanged, type LintMode } from './lint';
import { THEMES } from './themes';
import { baseEffect, gitChanges } from './changes';
import { remoteCompletion } from './remoteCompletion';
import { notInComment } from './docComment';
import type { CodeThemeId } from '../../core/codeTheme';
import { isModKey } from '../keys';
import { useEditorStore } from '../store';

const theme = new Compartment(), readOnlyConf = new Compartment(), wrapConf = new Compartment(), langConf = new Compartment();

/** 마우스를 올린 자리의 설명(WebSquare API 등). 없으면 null */
export type HoverSource = (view: EditorView, pos: number, side: -1 | 1) => Tooltip | null;

/**
 * 지금 내용을 next로 바꾸는 편집을 바뀐 곳만 잘게(글자 단위 비교, 아주 크면 300ms 뒤 덜 정밀하게).
 * 한 번에 크게 바꾸면 그 안의 커서·선택이 바뀐 범위 시작으로 튄다(포맷 뒤 커서가 위로 감). 잘게 바꾸면 바뀌지 않은 글자에 붙어 남는다
 */
const changesTo = (editor: EditorView, next: string) => {
	const doc = editor.state.doc.toString(), target = editor.state.toText(next).toString();
	return diff(doc, target, { timeout: 300 }).map(c => ({ from: c.fromA, to: c.toA, insert: target.slice(c.fromB, c.toB) }));
};
const vsTheme = () => document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast-light') ? vsCodeLight : vsCodeDark;
const themeOf = (id: CodeThemeId) => id === 'vscode' ? vsTheme() : THEMES[id];
// 웹뷰 우클릭 메뉴(package.json webview/context)에 "코드 편집기 테마…"를 붙이는 표시. 잘라내기·복사·붙여넣기는 그대로
const MENU_CONTEXT = JSON.stringify({ webviewSection: 'codeEditor' });

// 들여쓰기 가이드 색은 VS Code 테마 색(밝음·어두움 모두 같은 변수). 옛 VS Code는 번호 없는 이름만 있다
const GUIDE = 'var(--vscode-editorIndentGuide-background1, var(--vscode-editorIndentGuide-background))';
const ACTIVE_GUIDE = 'var(--vscode-editorIndentGuide-activeBackground1, var(--vscode-editorIndentGuide-activeBackground))';
const indentGuides = indentationMarkers({ colors: { light: GUIDE, dark: GUIDE, activeLight: ACTIVE_GUIDE, activeDark: ACTIVE_GUIDE } });

/** Tab(VS Code처럼): 선택이 없으면 커서 자리에 다음 들여쓰기 칸까지 공백, 선택이 있으면 그 줄들을 들여쓴다. Shift+Tab은 줄 내어쓰기 */
const insertIndent: Command = view => {
	const { state } = view;
	if (state.readOnly) {
		return false;
	}
	if (state.selection.ranges.some(r => !r.empty)) {
		return indentMore(view);
	}
	const unit = getIndentUnit(state);
	view.dispatch(state.update(state.changeByRange(range => {
		const line = state.doc.lineAt(range.head);
		const insert = ' '.repeat(unit - countColumn(line.text.slice(0, range.head - line.from), state.tabSize) % unit);
		return { changes: { from: range.head, insert }, range: EditorSelection.cursor(range.head + insert.length) };
	}), { scrollIntoView: true, userEvent: 'input.indent' }));
	return true;
};

const keys = Prec.high(keymap.of([{ key: 'Tab', run: acceptCompletion }, { key: 'Tab', run: insertIndent, shift: indentLess }]));

// 들여쓰기 단위는 파일과 상관없이 공백 4칸(포맷과 같음, CodeMirror 기본은 2칸). Tab·자동 들여쓰기·들여쓰기 가이드 간격이 이 단위를 따른다
const indent = indentUnit.of('    ');

// Ctrl+F 찾기·바꾸기 창은 위에(VS Code처럼). 기본은 아래
const searchTop = search({ top: true });

const completion = autocompletion({
	// 기본 100ms 기다림 없이 VS Code처럼 바로(연결 탭은 결과가 완전하면 이어 치는 글자를 다시 묻지 않고 거른다)
	activateOnTypingDelay: 0,
	positionInfo(view, list, _option, info, space) {
		const spaceLeft = list.left - space.left, spaceRight = space.right - list.right;
		const left = spaceRight < Math.min(info.right - info.left, spaceLeft);
		const maxHeight = Math.max(160, Math.min(360, view.dom.getBoundingClientRect().bottom - list.top - 8));
		return {
			style: `top: 0px; max-width: ${Math.min(500, left ? spaceLeft : spaceRight)}px; max-height: ${maxHeight}px;`,
			class: `cm-completionInfo-${left ? 'left' : 'right'}`,
		};
	},
});

export interface CodeEditorHandle {
	appendAndFocus(text: string, cursorOffset: number): void;
	focusRange(from: number, to: number): void;
}

export const CodeEditor = forwardRef<CodeEditorHandle, {
	target: CodeTarget; lang: LanguageSupport; complete: CompletionSource; hover?: HoverSource; lint?: LintMode; text: string; version: number;
	/** VS Code 언어 확장의 자동완성을 먼저 쓴다(연결 탭). 없으면 complete */
	remote?: boolean;
	readOnly?: boolean; notes?: (string | undefined)[]; post(msg: ToExtension): void;
}>(function CodeEditor({ target, lang, complete, hover, lint, text, version, remote = false, readOnly = false, notes = [], post }, ref) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView>(null);
	const source = useRef(complete);
	const hoverSource = useRef(hover);
	const languageOf = useRef<(l: LanguageSupport) => Extension>(() => []);
	const sync = useRef<{ base: number; inFlight: boolean; remote: boolean; conflict: boolean; queued?: [ChangeSet, Text]; formatting?: Text; formatAfter?: boolean }>(
		{ base: version, inFlight: false, remote: false, conflict: false });
	const [conflict, setConflict] = useState(false);
	/** VS Code가 낸 문제(연결 탭)와 그 연결 파일 버전 */
	const diagnostics = useEditorStore(s => s.diagnostics[target]);
	const remoteProblems = useRef(diagnostics);
	const codeTheme = useEditorStore(s => s.codeTheme);
	const gitBase = useEditorStore(s => s.gitBases[target]);
	const wordWrap = useEditorStore(s => s.codeOptions.wordWrap);
	const themeId = useRef(codeTheme);

	const send = (changes: ChangeSet, doc: Text) => {
		const at = (pos: number) => {
			const line = doc.lineAt(pos);
			return [line.number - 1, pos - line.from];
		};
		const list: CodeChange[] = [];
		changes.iterChanges((from, to, _fromB, _toB, inserted) => {
			const [fromLine, fromCh] = at(from), [toLine, toCh] = at(to);
			list.push({ fromLine, fromCh, toLine, toCh, insert: inserted.toString() });
		});
		sync.current.inFlight = true;
		post({ type: 'setCode', target, version: sync.current.base, changes: list });
	};

	const load = (next: string, v: number) => {
		const editor = view.current!, s = sync.current;
		const changes = changesTo(editor, next);
		s.remote = true;
		try {
			if (changes.length) {
				editor.dispatch({ changes, annotations: Transaction.addToHistory.of(false) });
			}
		} finally {
			s.remote = false;
		}
		s.base = v;
	};

	const format = (editor: EditorView) => {
		const s = sync.current;
		s.formatAfter = s.inFlight;
		if (!s.inFlight && !s.conflict && !editor.state.readOnly) {
			s.formatting = editor.state.doc;
			post({ type: 'format', target, version: s.base });
		}
	};

	useEffect(() => {
		// 보낸 편집이 모두 반영돼 확장 문서와 내용이 같아질 때까지 잠깐 기다린다(최대 1초)
		const synced = async (context: CompletionContext) => {
			const s = sync.current;
			for (let i = 0; i < 50 && (s.inFlight || s.queued) && !context.aborted; i++) {
				await new Promise(r => setTimeout(r, 20));
			}
			return s.inFlight || s.queued || s.conflict ? undefined : s.base;
		};
		const local: CompletionSource = context => source.current(context);
		// 주석 안에서는 자동완성 없음(. 뒤 포함)
		const autocomplete = notInComment(remote ? remoteCompletion(target, post, synced, local) : local);
		// 언어와 그 자동완성은 함께 바꾼다(SQL 방언 설정이 바뀌면 언어가 새로 온다)
		languageOf.current = l => [l, l.language.data.of({ autocomplete })];
		// 연결 탭 문법 검사 = VS Code가 그 파일에 낸 문제. 보낸 편집이 반영돼 같은 버전의 결과가 올 때까지 잠깐 기다리고(최대 2초), 안 오면 마지막 결과
		const remoteLint: LintSource | undefined = remote ? async view => {
			const s = sync.current;
			for (let i = 0; i < 40 && (s.inFlight || s.queued || remoteProblems.current?.version !== s.base); i++) {
				await new Promise(r => setTimeout(r, 50));
			}
			return remoteProblems.current ? fromRemote(view.state.doc, remoteProblems.current.items) : [];
		} : undefined;
		const editor = new EditorView({
			parent: host.current!,
			doc: text,
			extensions: [
				basicSetup, searchTop, keys, completion, indent, indentGuides, lintFor(lint, remoteLint), gitChanges,
				langConf.of(languageOf.current(lang)),
				wrapConf.of(wordWrap ? EditorView.lineWrapping : []),
				hoverTooltip((view, pos, side) => hoverSource.current?.(view, pos, side) ?? null),
				theme.of(themeOf(codeTheme)),
				readOnlyConf.of(EditorState.readOnly.of(readOnly)),
				// CodeMirror가 넣는 <style>이 웹뷰 CSP를 통과하도록
				EditorView.cspNonce.of(document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? ''),
				// 실행 취소·다시 실행은 CodeMirror만: VS Code 웹뷰는 키를 VS Code에도 넘겨서 문서까지 한 번 더 되돌리고
				// 그러면 CodeMirror가 보낸 되돌리기가 옛 버전 기준이 돼 충돌한다. 키 전달은 window에서 받으므로 편집기에서 멈춘다.
				// (handler는 키맵이 먼저 처리하면 안 불리므로 항상 불리는 observer로)
				EditorView.domEventObservers({
					keydown: e => {
						if (isModKey(e, 'z') || isModKey(e, 'y')) {
							e.stopPropagation();
						}
					},
				}),
				EditorView.theme({
					'&': { height: '100%' },
					'.cm-scroller': { fontFamily: 'var(--vscode-editor-font-family)', fontSize: 'var(--vscode-editor-font-size)' },
				}),
				EditorView.updateListener.of(u => {
					const s = sync.current;
					if (!u.docChanged || s.remote || s.conflict) {
						return;
					}
					if (s.inFlight) {
						s.queued = s.queued ? [s.queued[0].compose(u.changes), s.queued[1]] : [u.changes, u.startState.doc];
					} else {
						send(u.changes, u.startState.doc);
					}
				}),
			],
		});
		view.current = editor;
		// VS Code 테마를 따라갈 때만 VS Code 밝음/어두움 전환을 따른다
		const observer = new MutationObserver(() => themeId.current === 'vscode' && editor.dispatch({ effects: theme.reconfigure(vsTheme()) }));
		observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
		const onMessage = ({ data }: MessageEvent<ToWebview>) => {
			const s = sync.current;
			// 숨은 탭(display:none)이면 offsetParent가 없다
			if (data.type === 'formatKey') {
				if (editor.dom.offsetParent) {
					format(editor);
				}
				return;
			}
			if (data.type === 'formatted' && data.target === target) {
				const changes = data.text !== undefined && s.formatting === editor.state.doc ? changesTo(editor, data.text) : [];
				s.formatting = undefined;
				if (changes.length) {
					editor.dispatch({ changes, userEvent: 'format' });
				}
				return;
			}
			if (data.type !== 'codeAck' || data.target !== target) {
				return;
			}
			s.inFlight = false;
			if (!data.ok) {
				s.conflict = true;
				s.queued = undefined;
				s.formatAfter = false;
				setConflict(true);
				return;
			}
			s.base = data.version;
			if (s.queued) {
				const [changes, doc] = s.queued;
				s.queued = undefined;
				send(changes, doc);
			} else if (s.formatAfter) {
				format(editor);
			}
		};
		window.addEventListener('message', onMessage);
		return () => {
			window.removeEventListener('message', onMessage);
			observer.disconnect();
			editor.destroy();
		};
	}, []); // 편집기는 한 번만 만들고 아래 effect들로 갱신

	useImperativeHandle(ref, () => ({
		appendAndFocus(text, cursorOffset) {
			const editor = view.current;
			if (!editor) {
				return;
			}
			const end = editor.state.doc.length;
			const pos = end + cursorOffset;
			editor.dispatch({ changes: { from: end, insert: text }, selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
			editor.focus();
		},
		focusRange(from, to) {
			const editor = view.current;
			if (!editor) {
				return;
			}
			editor.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
			editor.focus();
		},
	}), []);

	useEffect(() => {
		source.current = complete;
	}, [complete]);
	useEffect(() => {
		hoverSource.current = hover;
	}, [hover]);
	// 처음 값은 편집기를 만들 때 이미 넣었다
	const applied = useRef({ lang, wordWrap });
	useEffect(() => {
		if (applied.current.lang !== lang) {
			applied.current.lang = lang;
			view.current?.dispatch({ effects: langConf.reconfigure(languageOf.current(lang)) });
		}
	}, [lang]);
	useEffect(() => {
		if (applied.current.wordWrap !== wordWrap) {
			applied.current.wordWrap = wordWrap;
			view.current?.dispatch({ effects: wrapConf.reconfigure(wordWrap ? EditorView.lineWrapping : []) });
		}
	}, [wordWrap]);
	useEffect(() => {
		view.current?.dispatch({ effects: baseEffect(gitBase) });
	}, [gitBase]);
	useEffect(() => {
		remoteProblems.current = diagnostics;
		view.current?.dispatch({ effects: remoteProblemsChanged.of(null) });
	}, [diagnostics]);
	useEffect(() => {
		if (themeId.current !== codeTheme) {
			themeId.current = codeTheme;
			view.current?.dispatch({ effects: theme.reconfigure(themeOf(codeTheme)) });
		}
	}, [codeTheme]);
	useEffect(() => {
		view.current?.dispatch({ effects: readOnlyConf.reconfigure(EditorState.readOnly.of(readOnly)) });
	}, [readOnly]);
	// 다른 곳(Design·VS Code)에서 바뀐 문서. 보낸 편집이 처리 중이면 그 결과(ack)가 기준이라 건너뛴다.
	useEffect(() => {
		const s = sync.current;
		if (!s.inFlight && !s.conflict && version > s.base) {
			load(text, version);
		}
	}, [text, version]);

	return <div className={codeTheme === 'vscode' ? 'code-editor' : 'code-editor custom-theme'} data-vscode-context={MENU_CONTEXT}>
		{notes.filter(Boolean).map(n => <div key={n} className="code-banner">{n}</div>)}
		{conflict && <div className="code-banner">원본이 다른 곳에서 바뀌어 이후 입력은 반영되지 않았습니다. 필요한 부분을 복사한 뒤 다시 불러와 주세요.
			<button onClick={() => {
				load(text, version);
				sync.current.conflict = false;
				setConflict(false);
			}}>다시 불러오기</button></div>}
		<div ref={host} className="code-host" />
	</div>;
});
