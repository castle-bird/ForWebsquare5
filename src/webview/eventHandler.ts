// Event 탭 Script 버튼·서브미션 핸들러: scwin.{id}_{이벤트} 함수가 있으면 그 자리로, 없으면 뼈대를 만들어 Script 끝에 넣는다
import { useEffect, useRef, type RefObject } from 'react';
import type { ComponentDef, ScriptApi } from '../core/protocol';
import { defOf, type XmlNode } from '../core/xmlModel';
import type { CodeEditorHandle } from './editor/codeEditor';
import { post, type Doc } from './store';

export function useEventHandler({ doc, defs, events, scriptRef, editAttr, showScript }: {
	doc?: Doc; defs?: ComponentDef[]; events?: ScriptApi; scriptRef: RefObject<CodeEditorHandle | null>;
	editAttr(name: string, value: string | undefined, index?: number): void; showScript(): void;
}) {
	// editAttr(ev:*)로 만든 문서 버전이 이 Script 편집기에 반영된 뒤에야 그 위에 안전하게 이어서 넣을 수 있다.
	// 바로 이어서 넣으면 이 편집기가 들고 있는 옛 버전으로 보내 "원본이 다른 곳에서 바뀜" 충돌이 난다.
	const pendingScaffold = useRef<{ text: string; cursorOffset: number } | null>(null);
	useEffect(() => {
		const p = pendingScaffold.current;
		if (p) {
			pendingScaffold.current = null;
			requestAnimationFrame(() => scriptRef.current?.appendAndFocus(p.text, p.cursorOffset));
		}
	}, [doc?.version, scriptRef]);

	/** 연결한(또는 만든) 핸들러 이름. ID가 없거나 Script를 고칠 수 없으면 undefined */
	return (target: XmlNode, eventName: string, current = target.attrs[`ev:${eventName}`]): string | undefined => {
		const handler = current?.trim() || (target.attrs.id && `scwin.${target.attrs.id}_${eventName}`);
		if (!handler) {
			post({ type: 'warn', message: 'ID부터 입력해주세요. (Script 함수 이름이 scwin.{ID}_{이벤트})' });
			return undefined;
		}
		if (!doc || doc.script.note) {
			return undefined;
		}
		showScript();
		const attr = `ev:${eventName}`, attrChanges = target.attrs[attr] !== handler;
		const text = doc.script.text;
		const definition = new RegExp(`(?<![\\w$.])${handler.replace(/[.$]/g, '\\$&')}\\s*=(?!=)`);
		const defined = text.search(definition);
		if (defined >= 0 || !/^[\w$]+(\.[\w$]+)*$/.test(handler)) {
			// 위치는 편집기 글자에서 다시 찾는다(원문이 CRLF면 편집기와 위치가 다르다)
			requestAnimationFrame(() => scriptRef.current?.focusFound(code => {
				const at = defined >= 0 ? code.search(definition) : code.indexOf(handler);
				return at >= 0 ? { from: at, to: at + handler.length } : undefined;
			}));
			if (attrChanges) { editAttr(attr, handler, target.index); }
			return handler;
		}
		const def = defOf(target, defs);
		const fromDoc = def && events?.[`WebSquare.uiplugin.${def.realType}`]?.find(e => e.name === eventName)?.params?.map(p => p.name);
		const fromDef = def?.events.find(e => e.name === eventName)?.signature.match(/\(([^)]*)\)/)?.[1];
		const params = fromDoc ?? fromDef?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
		const head = `${handler} = function(${params.join(', ')}) {\n\t`;
		const lead = text.length ? '\n' : '';
		const scaffold = { text: `${lead}${head}\n};\n`, cursorOffset: lead.length + head.length };
		if (attrChanges) {
			pendingScaffold.current = scaffold;
			editAttr(attr, handler, target.index);
		} else {
			requestAnimationFrame(() => scriptRef.current?.appendAndFocus(scaffold.text, scaffold.cursorOffset));
		}
		return handler;
	};
}
