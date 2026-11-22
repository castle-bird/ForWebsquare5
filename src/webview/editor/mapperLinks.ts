// Mapper ↔ 매퍼 XML 줄 옆 이동 아이콘과 정의 이동 Ctrl+hover 밑줄·커서 표시
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, ViewPlugin, gutter, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { MapperLinkMark } from '../../core/mapperLink';
import { posAt } from './lint';

interface ResolvedMark {
	from: number;
	to: number;
	direction: 'xml' | 'java';
	targetFile: string;
	id?: string;
}

const setMapperMarks = StateEffect.define<MapperLinkMark[]>();
/** 확장이 보낸 매퍼 링크 목록을 편집기에 반영하는 효과 */
export const mapperLinksEffect = (items: MapperLinkMark[]) => setMapperMarks.of(items);

const mapperMarksField = StateField.define<ResolvedMark[]>({
	create: () => [],
	update(value, tr) {
		for (const e of tr.effects) {
			if (e.is(setMapperMarks)) {
				const doc = tr.state.doc;
				return e.value.map(m => {
					const from = posAt(doc, m.line, m.ch);
					const to = Math.min(doc.length, from + m.length);
					return { from, to, direction: m.direction, targetFile: m.targetFile, id: m.id };
				}).filter(m => m.from < m.to).sort((a, b) => a.from - b.from);
			}
		}
		if (tr.docChanged && value.length) {
			return value.map(m => ({
				...m,
				from: tr.changes.mapPos(m.from, 1),
				to: tr.changes.mapPos(m.to, -1),
			})).filter(m => m.from < m.to);
		}
		return value;
	},
});

const SVG_NS = 'http://www.w3.org/2000/svg';

/** IntelliJ 스타일 원형 배지(가운데 M) SVG DOM 생성 */
function badgeSvg(): SVGSVGElement {
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('width', '14');
	svg.setAttribute('height', '14');
	svg.setAttribute('aria-hidden', 'true');
	const circle = document.createElementNS(SVG_NS, 'circle');
	circle.setAttribute('cx', '8');
	circle.setAttribute('cy', '8');
	circle.setAttribute('r', '6.5');
	circle.setAttribute('fill', 'currentColor');
	circle.setAttribute('fill-opacity', '0.18');
	circle.setAttribute('stroke', 'currentColor');
	circle.setAttribute('stroke-width', '1.25');
	const letter = document.createElementNS(SVG_NS, 'path');
	letter.setAttribute('d', 'M5.25 10.75V5.35L8 8.65l2.75-3.3v5.4');
	letter.setAttribute('fill', 'none');
	letter.setAttribute('stroke', 'currentColor');
	letter.setAttribute('stroke-width', '1.4');
	letter.setAttribute('stroke-linecap', 'round');
	letter.setAttribute('stroke-linejoin', 'round');
	svg.append(circle, letter);
	return svg;
}

const tooltipOf = (direction: 'xml' | 'java', targetFile: string, id?: string) => {
	const prefix = direction === 'xml' ? '매퍼 XML로 이동' : 'Mapper로 이동';
	return id ? `${prefix}: ${targetFile} · ${id}` : `${prefix}: ${targetFile}`;
};

class MapperGutterMarker extends GutterMarker {
	constructor(readonly direction: 'xml' | 'java', readonly targetFile: string, readonly id?: string) {
		super();
	}
	eq(other: GutterMarker) {
		return other instanceof MapperGutterMarker && other.direction === this.direction
			&& other.targetFile === this.targetFile && other.id === this.id;
	}
	toDOM() {
		const tip = tooltipOf(this.direction, this.targetFile, this.id);
		const btn = Object.assign(document.createElement('button'), {
			type: 'button',
			className: `cm-mapper-icon cm-mapper-to-${this.direction}`,
			title: tip,
		});
		btn.setAttribute('aria-label', tip);
		btn.append(badgeSvg());
		return btn;
	}
}

/** 한 줄에 여러 링크가 있으면 id가 있는 메서드·문을 우선한다 */
function lineMark(state: EditorState, lineFrom: number, lineTo: number): ResolvedMark | undefined {
	const onLine = state.field(mapperMarksField, false)?.filter(m => m.from >= lineFrom && m.from <= lineTo) ?? [];
	return onLine.find(m => m.id !== undefined) ?? onLine[0];
}

/** 줄 옆 매퍼 이동 아이콘 gutter. 링크가 없는 파일에서는 너비 0으로 숨긴다 */
export function mapperLinks(onJump: (view: EditorView, pos: number) => void): Extension {
	const hasLinks = EditorView.editorAttributes.compute([mapperMarksField], (s): Record<string, string> =>
		s.field(mapperMarksField).length ? { class: 'cm-has-mapper-links' } : {});
	const mapperGutter = gutter({
		class: 'cm-mapper-gutter',
		markers: view => {
			const builder = new RangeSetBuilder<GutterMarker>();
			const byLine = new Map<number, { pos: number; mark: ResolvedMark }>();
			for (const mark of view.state.field(mapperMarksField)) {
				const line = view.state.doc.lineAt(mark.from);
				const prev = byLine.get(line.number);
				if (!prev || (prev.mark.id === undefined && mark.id !== undefined)) {
					byLine.set(line.number, { pos: line.from, mark });
				}
			}
			for (const { pos, mark } of [...byLine.values()].sort((a, b) => a.pos - b.pos)) {
				builder.add(pos, pos, new MapperGutterMarker(mark.direction, mark.targetFile, mark.id));
			}
			return builder.finish();
		},
		domEventHandlers: {
			mousedown: (view, line, e) => {
				if ((e as MouseEvent).button !== 0 || !lineMark(view.state, line.from, line.to)) {
					return false;
				}
				e.preventDefault();
				return true;
			},
			click: (view, line, e) => {
				const mark = (e as MouseEvent).button === 0 ? lineMark(view.state, line.from, line.to) : undefined;
				if (!mark) {
					return false;
				}
				e.preventDefault();
				onJump(view, mark.from);
				return true;
			},
		},
	});
	return [mapperMarksField, hasLinks, mapperGutter];
}

const setHoverRange = StateEffect.define<{ from: number; to: number } | null>();
const hoverMark = Decoration.mark({ class: 'cm-def-hover' });

const hoverDecoField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(value, tr) {
		for (const e of tr.effects) {
			if (e.is(setHoverRange)) {
				return e.value && e.value.from < e.value.to ? Decoration.set([hoverMark.range(e.value.from, e.value.to)]) : Decoration.none;
			}
		}
		return tr.docChanged ? Decoration.none : value;
	},
	provide: f => EditorView.decorations.from(f),
});

const NON_LINK_NODE = /^(?:LineComment|BlockComment|Comment|String|StringLiteral|TextBlock|CharacterLiteral|Number|IntegerLiteral|FloatingPointLiteral|AttributeName|TagName)$/;
const KEYWORDS = new Set([
	'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue',
	'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto',
	'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package',
	'private', 'protected', 'public', 'record', 'return', 'sealed', 'short', 'static', 'strictfp', 'super',
	'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'var', 'void', 'volatile',
	'while', 'yield', 'true', 'false', 'null',
]);

/** Ctrl(macOS Cmd) 누른 채 마우스를 올린 정의 이동 대상에 밑줄·포인터 커서 표시 */
export function definitionHover(options: {
	remote: boolean;
	isXml: () => boolean;
	hasDefinition?: (state: EditorState, pos: number) => boolean;
}): Extension {
	const rangeAt = (view: EditorView, pos: number): { from: number; to: number } | null => {
		const mark = view.state.field(mapperMarksField, false)?.find(m => pos >= m.from && pos <= m.to);
		if (mark) {
			return { from: mark.from, to: mark.to };
		}
		if (options.hasDefinition) {
			const word = view.state.wordAt(pos);
			return word && options.hasDefinition(view.state, pos) ? { from: word.from, to: word.to } : null;
		}
		if (options.remote && !options.isXml()) {
			const word = view.state.wordAt(pos);
			if (!word) { return null; }
			const text = view.state.sliceDoc(word.from, word.to);
			if (!/^[A-Za-z_$]/.test(text) || KEYWORDS.has(text)) { return null; }
			if (NON_LINK_NODE.test(syntaxTree(view.state).resolveInner(pos, 0).name)) { return null; }
			return { from: word.from, to: word.to };
		}
		return null;
	};

	const rangeAtCoords = (view: EditorView, x: number, y: number): { from: number; to: number } | null => {
		const pos = view.posAtCoords({ x, y });
		if (pos === null) { return null; }
		const range = rangeAt(view, pos);
		if (!range) { return null; }
		const left = view.coordsAtPos(range.from), right = view.coordsAtPos(range.to);
		if (left && right && Math.abs(left.top - right.top) < 2) {
			if (x < left.left - 2 || x > right.right + 2 || y < left.top - 2 || y > right.bottom + 2) {
				return null;
			}
		}
		return range;
	};

	const plugin = ViewPlugin.fromClass(class {
		lastMouse: { x: number; y: number } | null = null;
		active: { from: number; to: number } | null = null;

		constructor(readonly view: EditorView) {
			window.addEventListener('keydown', this.onKeyDown);
			window.addEventListener('keyup', this.onKeyUp);
			window.addEventListener('blur', this.onBlur);
		}

		set(next: { from: number; to: number } | null) {
			if (this.active?.from === next?.from && this.active?.to === next?.to) {
				return;
			}
			this.active = next;
			this.view.dispatch({ effects: setHoverRange.of(next) });
		}

		onKeyDown = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && this.lastMouse) {
				this.set(rangeAtCoords(this.view, this.lastMouse.x, this.lastMouse.y));
			} else if (this.active && (e.altKey || e.shiftKey)) {
				this.set(null);
			}
		};

		onKeyUp = (e: KeyboardEvent) => {
			if (this.active && (e.key === 'Control' || e.key === 'Meta' || (!e.ctrlKey && !e.metaKey))) {
				this.set(null);
			}
		};

		onBlur = () => {
			this.lastMouse = null;
			this.set(null);
		};

		update(u: ViewUpdate) {
			if (u.docChanged) {
				this.active = null;
			}
		}

		destroy() {
			window.removeEventListener('keydown', this.onKeyDown);
			window.removeEventListener('keyup', this.onKeyUp);
			window.removeEventListener('blur', this.onBlur);
		}
	}, {
		eventHandlers: {
			mousemove(e, view) {
				this.lastMouse = { x: e.clientX, y: e.clientY };
				if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
					this.set(rangeAtCoords(view, e.clientX, e.clientY));
				} else if (this.active) {
					this.set(null);
				}
			},
			mouseleave() {
				this.lastMouse = null;
				this.set(null);
			},
		},
	});

	return [hoverDecoField, plugin];
}
