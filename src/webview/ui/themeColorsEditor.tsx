// 테마 색 덮어쓰기 팝업(탭 줄 톱니바퀴): 지금 테마 위에 바꿀 색만. 바꾸는 대로 미리 보기·열린 코드 편집기에 칠하고, 확인하면 설정 codeThemeCustomizations에 저장
import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { Compartment } from '@codemirror/state';
import { isColor, readOverlay, type ColorKey, type ThemeOverlay, type TokenKind, type TokenStyle } from '../../core/codeTheme';
import { codeVars, editorBase, editorClass, readThemeColors, themeOf } from '../editor/themes';
import { javaSupport } from '../editor/java';
import { post, useEditorStore } from '../store';
import { PopupTitle, usePopupWindow } from './popupWindow';
import { Segmented } from './segmented';

const COLORS: [ColorKey, string][] = [
	['background', '배경'], ['foreground', '기본 글자'], ['caret', '커서'], ['selection', '선택 영역'],
	['lineHighlight', '현재 줄'], ['gutterBackground', '줄 번호 칸'], ['gutterForeground', '줄 번호'],
];
const TOKENS: [TokenKind, string][] = [
	['keyword', '키워드'], ['comment', '주석'], ['string', '문자열'], ['number', '숫자'], ['type', '타입·클래스'], ['function', '함수'],
	['annotation', '어노테이션'], ['modifier', '수식어·선언'], ['variable', '변수'], ['property', '속성·필드'], ['constant', '상수'],
	['operator', '연산자'], ['tag', '태그'], ['attribute', 'XML 속성'],
];
const FONTS = [['italic', 'I'], ['bold', 'B'], ['underline', 'U']] as const;
const SCOPES = ['지금 테마만', '모든 테마'];
const SAMPLE = '@Override\npublic String getName(int count) { // 이름\n    return "websquare" + count * 2 + true;\n}';

type Layers = { common: ThemeOverlay; own: ThemeOverlay };
const changedCount = (o: ThemeOverlay) => Object.keys(o.colors ?? {}).length + Object.keys(o.tokens ?? {}).length;

export function ThemeColorsEditor({ onClose }: { onClose(): void }) {
	const theme = useEditorStore(s => s.codeTheme);
	const [layers, setLayers] = useState<Layers>(() => ({ common: theme.common ?? {}, own: theme.own ?? {} }));
	const [scope, setScope] = useState(SCOPES[0]);
	const key: keyof Layers = scope === SCOPES[0] ? 'own' : 'common';
	const layer = layers[key];
	const { titleProps, resizeHandles, popupProps } = usePopupWindow({ onClose });
	// 바꾸는 대로 열린 코드 편집기에 칠한다. 닫으면(확인 없이) 원래대로
	useEffect(() => { useEditorStore.setState({ codeThemeDraft: layers }); }, [layers]);
	useEffect(() => () => useEditorStore.setState({ codeThemeDraft: undefined }), []);
	// "테마 기본": 지금 고치는 층을 뺀 색(이 테마만이면 공통까지, 모든 테마면 바탕만)
	const defaults = useMemo(() => readThemeColors({ ...theme, common: key === 'own' ? layers.common : undefined, own: undefined }), [theme, key, layers.common]);
	const previewState = { ...theme, ...layers };

	const preview = useRef<HTMLDivElement>(null);
	const previewView = useRef<{ view: EditorView; conf: Compartment }>(undefined);
	useEffect(() => {
		const conf = new Compartment();
		const view = new EditorView({ parent: preview.current!, doc: SAMPLE, extensions: [javaSupport, editorBase, EditorView.editable.of(false), conf.of(themeOf(previewState))] });
		previewView.current = { view, conf };
		return () => view.destroy();
	}, []);
	useEffect(() => { previewView.current?.view.dispatch({ effects: previewView.current.conf.reconfigure(themeOf(previewState)) }); }, [theme, layers]);

	const update = (change: (o: ThemeOverlay) => ThemeOverlay) => setLayers(current => ({ ...current, [key]: change(current[key]) }));
	const setColor = (name: ColorKey, value: string | undefined) => update(o => {
		const colors = { ...o.colors };
		if (value === undefined) { delete colors[name]; } else { colors[name] = value; }
		return { ...o, colors };
	});
	const setToken = (name: TokenKind, style: TokenStyle | undefined) => update(o => {
		const tokens = { ...o.tokens };
		if (style && (style.color !== undefined || style.fontStyle !== undefined)) { tokens[name] = style; } else { delete tokens[name]; }
		return { ...o, tokens };
	});
	const apply = () => {
		// 빈 칸·틀린 값은 빼고 저장(설정에 적는 것과 같은 정리)
		const common = readOverlay(layers.common), own = readOverlay(layers.own);
		post({ type: 'saveThemeCustomizations', common, own });
		// 설정 감시가 보낼 값과 같은 것을 먼저 반영(미리 보기를 걷을 때 원래 색이 깜빡이지 않게)
		useEditorStore.setState({ codeTheme: { ...theme, common, own } });
		onClose();
	};

	return <dialog {...popupProps} className="popup theme-colors-editor" aria-label="테마 색 덮어쓰기">
		<PopupTitle titleProps={titleProps} badge="Theme" onClose={onClose}>
			<span className="mono">{theme.label ?? theme.theme}</span><span className="popup-meta">· 바꾼 색 {changedCount(layer)}</span>
		</PopupTitle>
		<div className="form-sections">
			<section>
				<h3>적용 범위</h3>
				<div className="theme-scope">
					<Segmented aria-label="적용 범위" value={scope} options={SCOPES} onChange={setScope} />
					<span className="section-hint">바꾸는 대로 열린 코드 편집기에 바로 보여요</span>
				</div>
				<div ref={preview} className={`theme-preview ${editorClass(previewState)}`} style={codeVars(previewState)} />
			</section>
			<section>
				<h3>편집기</h3>
				<div className="theme-grid">
					{COLORS.map(([name, label]) => <ColorRow key={name} name={name} label={label} value={layer.colors?.[name]} fallback={defaults.colors[name]}
						onColor={value => setColor(name, value)} />)}
				</div>
			</section>
			<section>
				<h3>문법 색</h3>
				<div className="theme-grid">
					{TOKENS.map(([name, label]) => {
						const style = layer.tokens?.[name], base = defaults.tokens[name];
						return <ColorRow key={name} name={name} label={label} value={style?.color} fallback={base?.color}
							onColor={color => setToken(name, { ...style, color })}
							font={style?.fontStyle ?? base?.fontStyle ?? ''} fontChanged={style?.fontStyle !== undefined}
							// 테마 기본과 같아지면(켰다 끈 경우) 덮어쓰기에서 뺀다
							onFont={fontStyle => setToken(name, { ...style, fontStyle: fontStyle === (base?.fontStyle ?? '') ? undefined : fontStyle })}
							onReset={() => setToken(name, undefined)} />;
					})}
				</div>
			</section>
		</div>
		<div className="data-editor-actions">
			<button type="button" className="theme-settings-link" onClick={() => post({ type: 'settingsMenu', item: 'themeColors' })}>settings.json에서 열기</button>
			<button type="button" className="btn btn-secondary" onClick={() => setLayers(current => ({ ...current, [key]: {} }))}>모두 초기화</button>
			<button type="button" className="btn btn-secondary" onClick={onClose}>닫기</button>
			<button type="button" className="btn btn-primary" onClick={apply}>확인</button>
		</div>
		{resizeHandles}
	</dialog>;
}

/** 한 줄: 이름 · 색칸(누르면 색상 선택기) · 색 코드 입력 · (문법 색) I B U · 되돌리기 */
function ColorRow({ name, label, value, fallback, onColor, font, fontChanged, onFont, onReset }: {
	name: string; label: string; value?: string; fallback?: string; onColor(value: string | undefined): void;
	font?: string; fontChanged?: boolean; onFont?(fontStyle: string): void; onReset?(): void;
}) {
	const [text, setText] = useState(value ?? '');
	useEffect(() => setText(value ?? ''), [value]);
	const changed = value !== undefined || !!fontChanged;
	const shown = value ?? fallback;
	const commit = (next: string) => {
		const v = next.trim();
		if (!v) { onColor(undefined); } else if (isColor(v)) { onColor(v); } else { setText(value ?? ''); }
	};
	return <div className={`theme-row${changed ? ' changed' : ''}`}>
		<span className="theme-name">{label}</span>
		<label className="theme-swatch" style={{ background: shown }} title="색 고르기">
			{/* 색상 선택기는 반투명을 못 고른다: 고르면 #rrggbb, 반투명은 옆 칸에 #rrggbbaa로 */}
			<input type="color" aria-label={`${label} 색 고르기`} value={(shown ?? '#000000').slice(0, 7)} onChange={e => onColor(e.target.value)} />
		</label>
		<input className="theme-hex mono" aria-label={`${label} 색 코드`} data-name={name} value={text} placeholder="테마 기본" spellCheck={false}
			onChange={e => setText(e.target.value)} onBlur={e => commit(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { commit(e.currentTarget.value); } }} />
		{onFont ? <span className="theme-font" role="group" aria-label={`${label} 글꼴 모양`}>
			{FONTS.map(([style, mark]) => {
				const on = font?.split(/\s+/).includes(style) ?? false;
				return <button key={style} type="button" className={`font-${style}`} aria-pressed={on} title={style}
					onClick={() => onFont([...FONTS.map(([s]) => s).filter(s => s === style ? !on : font?.split(/\s+/).includes(s))].join(' '))}>{mark}</button>;
			})}
		</span> : <span />}
		{changed ? <button type="button" className="icon codicon codicon-discard theme-reset" title="테마 기본으로" aria-label={`${label} 되돌리기`} onClick={onReset ?? (() => onColor(undefined))} /> : <span />}
	</div>;
}
