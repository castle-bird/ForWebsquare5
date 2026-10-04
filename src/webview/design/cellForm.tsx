// 그리드 칸(헤더·본문·footer·subTotal) 더블클릭 때 문구 상자 아래 입력: 너비·높이 + 자주 고치는 속성
import { clsx } from 'clsx';
import type { ComponentDef } from '../../core/protocol';
import { setStyle, styleChanges } from '../../core/style';
import type { XmlNode } from '../../core/xmlModel';
import { ComboInput } from '../ui/combo';

/**
 * 그리드 칸 더블클릭 때 문구 상자 아래 입력. suggestions: 고를 값(정의의 정해진 값 포함, 직접 입력도),
 * numeric: 숫자만, styleHeight: 속성이 아니라 style의 height(px)
 */
type Field = { name: string; label: string; title: string; suggestions?: string[]; numeric?: boolean; unit?: string; styleHeight?: boolean; placeholder?: string };
/** part: 칸 종류(헤더 칸 등, 편집 상자 위에 표시) */
export type Form = { fields: Field[]; values: Record<string, string>; style?: string; part: string };

/** 그리드 칸에서 자주 고치는 속성(너비·높이 뒤). 자주 쓰는 것부터 두 개씩: id·class, inputType·dataType, maxLength·maxByteLength, 나머지 */
const CELL_PROPS = ['id', 'class', 'inputType', 'dataType', 'maxLength', 'maxByteLength', 'expression', 'colMerge'];
const NUMERIC = new Set(['maxLength', 'maxByteLength']);
/** 아래 입력 줄 높이(편집 상자가 화면 밖으로 안 나가게) */
export const FORM_HEIGHT = 430;
/** 아래 입력 줄이 있을 때 편집 상자 너비: 칸 너비를 따르되 넓은 칸(긴 헤더)에서도 이 이상 안 커짐 */
export const FORM_WIDTH = { min: 400, max: 480 };

/** 칸이 들어 있는 그리드 부분 → 편집 상자 위 표시 */
const PARTS: Record<string, string> = { header: '헤더 칸', gBody: '본문 칸', footer: 'footer 칸', subTotal: 'subTotal 칸' };

/**
 * 그리드 칸: 너비(width, 병합 칸은 열 너비에 안 쓰여 없음)·높이(style height, 빈칸이면 지금 그려진 크기를 흐리게) + CELL_PROPS.
 * path: 그 칸까지의 노드들(칸 종류를 찾는다)
 */
export function cellForm(n: XmlNode, def: ComponentDef | undefined, r: { width: number; height: number }, ids: string[] | undefined, path: XmlNode[]): Form {
	const prop = (name: string) => def?.properties.find(p => p.name === name);
	const fields: Field[] = [
		...Number(n.attrs.colSpan) > 1 ? [] : [{ name: 'width', label: 'width', title: '너비(width)', numeric: true, unit: 'px', placeholder: String(Math.round(r.width)) }],
		{ name: 'height', label: 'height', title: '높이(style height)', numeric: true, unit: 'px', styleHeight: true, placeholder: String(Math.round(r.height)) },
		...CELL_PROPS.map(name => ({
			name, label: name, title: prop(name)?.description || name, numeric: NUMERIC.has(name), suggestions: name === 'id' ? ids : prop(name)?.options,
		})),
	];
	const height = styleChanges(undefined, n.attrs.style).height?.replace(/px$/, '') ?? '';
	const part = path.map(a => PARTS[a.tag.slice(a.tag.indexOf(':') + 1)]).reverse().find(Boolean) ?? '그리드 칸';
	return { fields, style: n.attrs.style, part, values: Object.fromEntries(fields.map(f => [f.name, f.styleHeight ? height : n.attrs[f.name] ?? ''])) };
}

/** 바뀐 것만(비우면 지움). 높이는 style의 height */
export function formAttrs(form: Form, draft: Record<string, string>): { name: string; value?: string }[] {
	return form.fields.filter(f => (draft[f.name] ?? '') !== form.values[f.name]).map(f => f.styleHeight
		? { name: 'style', value: setStyle(form.style, { height: draft[f.name] ? `${draft[f.name]}px` : undefined }) || undefined }
		: { name: f.name, value: draft[f.name] || undefined });
}

/** 편집 상자 위: 칸 종류·id·단축키 */
export function FormHeader({ form }: { form: Form }) {
	return <>
		<span className="edit-chip">{form.part}</span>
		{form.values.id && <span className="edit-id">{form.values.id}</span>}
		<span className="edit-hint">Enter 적용 · Esc 취소</span>
	</>;
}

/** 크기(너비·높이)와 속성 묶음. 이름은 입력칸 위, 값이 있으면 이름을 강조 */
export function FormFields({ form, values, onChange }: { form: Form; values: Record<string, string>; onChange(v: Record<string, string>): void }) {
	const field = (f: Field) => {
		const value = values[f.name] ?? '';
		const set = (v: string) => onChange({ ...values, [f.name]: f.numeric ? v.replace(/\D/g, '') : v });
		return (
			<label key={f.name} title={f.title} className={clsx({ set: value !== '' })}>
				<span className="name">{f.label}</span>
				<span className="edit-control">
					{f.suggestions?.length
							? <ComboInput value={value} options={f.suggestions} aria-label={f.name} onValue={set} onPick={set} />
							: <input value={value} placeholder={f.placeholder} aria-label={f.name} inputMode={f.numeric ? 'numeric' : undefined} onChange={e => set(e.target.value)} />}
					{f.unit && <span className="unit">{f.unit}</span>}
				</span>
			</label>
		);
	};
	const groups: [string, Field[]][] = [['크기', form.fields.filter(f => f.unit)], ['속성', form.fields.filter(f => !f.unit)]];
	return (
		<div className="edit-fields">
			{groups.map(([title, fields]) => fields.length > 0 && <section key={title}>
				<p className="edit-section">{title}</p>
				<div className="edit-grid">{fields.map(field)}</div>
			</section>)}
		</div>
	);
}
