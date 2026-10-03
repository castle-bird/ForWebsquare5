import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { cleanPath, linkTarget, type LinkTab } from '../../core/links';
import type { LinkState, ToExtension } from '../../core/protocol';
import { CodeEditor } from '../editor/codeEditor';
import { linkLanguage } from '../editor/linkLanguages';
import { isModKey } from '../keys';
import { post, useEditorStore } from '../store';
import { Menu } from './menu';
import { FileInput } from './fileInput';
import type { TabHint } from './tabs';

const hintOf = (state: LinkState | undefined): TabHint => ({
	title: !state?.path ? '연결된 파일 없음 (눌러서 연결, 우클릭 메뉴)' : state.text === undefined ? `파일을 찾지 못함: ${state.path}` : state.path,
	dirty: state?.dirty,
});

/** 아래 탭에 붙일 연결 탭들: 탭 내용·툴팁(저장 안 함 ●)·우클릭 메뉴(열기·변경·해제·삭제) */
export function useLinkTabs(activeTab: string, loading: ReactNode) {
	const links = useEditorStore(s => s.links);
	const tabs = useEditorStore(s => s.linkTabs);
	const [menu, setMenu] = useState<{ x: number; y: number; tab: LinkTab }>();
	const onTabMenu = (name: string, e: MouseEvent) => {
		const tab = tabs.find(t => t.label === name);
		if (tab) {
			e.preventDefault();
			setMenu({ x: e.clientX, y: e.clientY, tab });
		}
	};
	const run = (msg: ToExtension) => {
		setMenu(undefined);
		post(msg);
	};
	const kind = menu?.tab.id ?? '', linked = !!links[kind]?.path;
	return {
		labels: tabs.map(t => t.label),
		keys: Object.fromEntries(tabs.map(t => [t.label, `link:${t.id}`])),
		items: Object.fromEntries(tabs.map(t => [t.label,
			links[t.id] ? <LinkedFile tab={t} state={links[t.id]} active={activeTab === t.label} /> : loading])),
		hints: Object.fromEntries(tabs.map(t => [t.label, hintOf(links[t.id])])),
		onTabMenu,
		menu: menu && <Menu key={`${menu.x},${menu.y}`} x={menu.x} y={menu.y} onClose={() => setMenu(undefined)}>
			<button role="menuitem" onClick={() => run({ type: 'openLink', kind })}>VS Code에서 열기</button>
			<button role="menuitem" onClick={() => run({ type: 'link', kind })}>{linked ? '다른 파일로 변경…' : '파일 연결…'}</button>
			<button role="menuitem" disabled={!linked} onClick={() => run({ type: 'unlink', kind })}>연결 해제</button>
			<button role="menuitem" onClick={() => run({ type: 'renameTab', kind })}>탭 이름 변경…</button>
			<button role="menuitem" onClick={() => run({ type: 'removeTab', kind })}>탭 삭제…</button>
		</Menu>,
	};
}

/** 연결 탭: 연결 전·파일이 없으면 경로 입력, 연결되면 그 파일 편집기 */
function LinkedFile({ tab, state, active }: { tab: LinkTab; state: LinkState; active: boolean }) {
	const linked = state.text !== undefined, kind = tab.id;
	const schema = useEditorStore(s => s.xmlSchemas[kind]);
	const dialect = useEditorStore(s => s.codeOptions.sqlDialect);
	const language = useMemo(() => state.path ? linkLanguage(state.path, schema, dialect) : undefined, [state.path, schema, dialect]);
	useEffect(() => {
		if (!active) {
			return;
		}
		// VS Code 웹뷰는 키를 window에서 VS Code로 넘긴다. 그러면 Ctrl+S는 화면 XML 저장, Ctrl+Z는 화면 XML 되돌리기라
		// 이 탭에서는 window 캡처 단계에서 멈춘다. 편집기(CodeMirror) 안의 Ctrl+Z는 편집기가 처리하고 직접 멈춘다
		const onKey = (e: KeyboardEvent) => {
			if (isModKey(e, 's') && !e.shiftKey) {
				e.preventDefault();
				e.stopPropagation();
				if (linked) {
					post({ type: 'saveLink', kind });
				}
			} else if ((isModKey(e, 'z') || isModKey(e, 'y')) && !(e.target as Element).closest?.('.cm-editor')) {
				e.stopPropagation();
			}
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	}, [active, linked, kind]);
	return linked && language && state.version !== undefined
		? <CodeEditor key={state.path} target={linkTarget(kind)} {...language} remote text={state.text!} version={state.version} post={post} />
		: <LinkPicker tab={tab} missing={state.path} />;
}

function LinkPicker({ tab, missing }: { tab: LinkTab; missing?: string }) {
	const [value, setValue] = useState('');
	const files = useEditorStore(s => s.linkFiles[tab.id]);
	const exts = useEditorStore(s => s.linkExts);
	const problem = useEditorStore(s => s.linkProblems[tab.id]);
	const change = (next: string) => {
		setValue(next);
		useEditorStore.setState(s => ({ linkProblems: { ...s.linkProblems, [tab.id]: undefined } }));
	};
	return <div className="link-picker">
		<form onSubmit={e => {
			e.preventDefault();
			if (cleanPath(value)) {
				post({ type: 'link', kind: tab.id, path: value });
			}
		}}>
			<h3>{tab.label} 파일 연결</h3>
			{missing && <p className="warning" title={missing}>파일을 찾지 못했습니다: {missing}</p>}
			{problem && <p className="warning" role="alert">{problem}</p>}
			<p className="link-picker-hint">작업 폴더 안의 {exts.join('·')} 파일. 상대 경로는 작업 폴더 기준입니다.</p>
			<div className="link-picker-row">
				<FileInput files={files} value={value} onChange={change} label={`${tab.label} 파일 경로`}
					placeholder="파일 이름으로 검색 또는 경로"
					// 입력칸에 들어올 때마다 새로 받는다(파일이 생기거나 지워졌을 수 있다)
					onFocus={() => post({ type: 'findFiles', kind: tab.id })}
					onChoose={file => { setValue(file); post({ type: 'link', kind: tab.id, path: file }); }} />
				<button type="submit" className="btn btn-primary" disabled={!cleanPath(value)}>연결</button>
				<button type="button" className="btn btn-secondary" onClick={() => post({ type: 'link', kind: tab.id })}>찾아보기…</button>
			</div>
		</form>
	</div>;
}
