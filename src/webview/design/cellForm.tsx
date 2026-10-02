// 그리드 칸(헤더·본문·footer·subTotal) 더블클릭 때 문구 상자 아래 입력: 너비·높이 + 자주 고치는 속성
import { clsx } from 'clsx';
import type { ComponentDef } from '../../core/protocol';
import { setStyle, styleChanges } from '../../core/style';
import type { XmlNode } from '../../core/xmlModel';
import { ChoiceSelect } from '../ui/choiceSelect';
import { ComboInput } from '../ui/combo';

/**
 * 그리드 칸 더블클릭 때 문구 상자 아래 입력. options: 정의의 정해진 값(select), suggestions: 고를 값(직접 입력도),
 * numeric: 숫자만, styleHeight: 속성이 아니라 style의 height(px)
 */
type Field = { name: string; label: string; title: string; options?: string[]; suggestions?: string[]; numeric?: boolean; unit?: string; styleHeight?: boolean; placeholder?: string };
export type Form = { fields: Field[]; values: Record<string, string>; style?: string };

/** 그리드 칸에서 자주 고치는 속성(너비·높이 뒤) */
const CELL_PROPS = ['inputType', 'dataType', 'id', 'class', 'maxLength', 'maxByteLength', 'expression', 'colMerge'];
const NUMERIC = new Set(['maxLength', 'maxByteLength']);
/** 아래 입력 줄 높이(편집 상자가 화면 밖으로 안 나가게) */
export const FORM_HEIGHT = 170;

/** 그리드 칸: 너비(width, 병합 칸은 열 너비에 안 쓰여 없음)·높이(style height, 빈칸이면 지금 그려진 크기를 흐리게) + CELL_PROPS */
export function cellForm(n: XmlNode, def: ComponentDef | undefined, r: { width: number; height: number }, ids?: string[]): Form {
	const prop = (name: string) => def?.properties.find(p => p.name === name);
	const fields: Field[] = [
		...Number(n.attrs.colSpan) > 1 ? [] : [{ name: 'width', label: 'width', title: '너비(width)', numeric: true, unit: 'px', placeholder: String(Math.round(r.width)) }],
		{ name: 'height', label: 'height', title: '높이(style height)', numeric: true, unit: 'px', styleHeight: true, placeholder: String(Math.round(r.height)) },
		...CELL_PROPS.map(name => ({
			name, label: name, title: prop(name)?.description || name, numeric: NUMERIC.has(name), options: prop(name)?.options, suggestions: name === 'id' ? ids : undefined,
		})),
	];
	const height = styleChanges(undefined, n.attrs.style).height?.replace(/px$/, '') ?? '';
	return { fields, style: n.attrs.style, values: Object.fromEntries(fields.map(f => [f.name, f.styleHeight ? height : n.attrs[f.name] ?? ''])) };
}

/** 바뀐 것만(비우면 지움). 높이는 style의 height */
export function formAttrs(form: Form, draft: Record<string, string>): { name: string; value?: string }[] {
	return form.fields.filter(f => (draft[f.name] ?? '') !== form.values[f.name]).map(f => f.styleHeight
		? { name: 'style', value: setStyle(form.style, { height: draft[f.name] ? `${draft[f.name]}px` : undefined }) || undefined }
		: { name: f.name, value: draft[f.name] || undefined });
}

export function FormFields({ form, values, onChange }: { form: Form; values: Record<string, string>; onChange(v: Record<string, string>): void }) {
	return (
		<div className="edit-fields">
			{form.fields.map(f => {
				const value = values[f.name] ?? '';
				const set = (v: string) => onChange({ ...values, [f.name]: f.numeric ? v.replace(/\D/g, '') : v });
				return (
					<label key={f.name} title={f.title} className={clsx({ set: value !== '' })}>
						<span className="name">{f.label}</span>
						{f.options
							? <ChoiceSelect value={value} options={['', ...f.options]} aria-label={f.name} onChange={e => set(e.target.value)} />
							: f.suggestions?.length
								? <ComboInput value={value} options={f.suggestions} aria-label={f.name} onValue={set} onPick={set} />
								: <input value={value} placeholder={f.placeholder} aria-label={f.name} inputMode={f.numeric ? 'numeric' : undefined} onChange={e => set(e.target.value)} />}
						{f.unit && <span className="unit">{f.unit}</span>}
					</label>
				);
			})}
		</div>
	);
}
