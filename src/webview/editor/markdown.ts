// 언어 서버 설명(VS Code MarkdownString, Javadoc 변환 결과)을 자동완성 설명 창에 그린다.
// 그 정도에 나오는 것만: 코드 블록(```), 인라인 코드, 굵게·기울임, 목록, 제목, 링크(글자만), 백슬래시 이스케이프.
// innerHTML 없이 DOM을 만들어 설명 안의 HTML이 그대로 실행되지 않게 한다

const INLINE = /\\([\\`*_[\]()#+\-.!<>|~])|`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|\*(?!\s)(.+?)\*|_(?!\s)(.+?)_|\[([^\]]*)\]\([^)]*\)/g;

function inline(parent: HTMLElement, text: string) {
	let at = 0;
	for (const m of text.matchAll(INLINE)) {
		parent.append(text.slice(at, m.index));
		at = m.index + m[0].length;
		const [, escaped, code, bold, bold2, em, em2, link] = m;
		if (escaped !== undefined) {
			parent.append(escaped);
		} else if (code !== undefined) {
			parent.append(Object.assign(document.createElement('code'), { textContent: code }));
		} else if (bold !== undefined || bold2 !== undefined) {
			inline(parent.appendChild(document.createElement('strong')), bold ?? bold2);
		} else if (em !== undefined || em2 !== undefined) {
			inline(parent.appendChild(document.createElement('em')), em ?? em2);
		} else {
			inline(parent, link);
		}
	}
	parent.append(text.slice(at));
}

/** highlight: 코드 블록 글자를 색 입힌 노드로(없으면 글자 그대로) */
/** 목록 항목 줄: 들여쓰기·내용 */
const LIST_ITEM = /^(\s*)(?:[*+-]|\d+\.)\s+(.*)$/;

export function renderMarkdown(source: string, highlight?: (text: string) => Node): HTMLElement {
	const root = Object.assign(document.createElement('div'), { className: 'md' });
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
	// 목록은 들여쓰기로 중첩(Javadoc: Parameters: 아래 각 파라미터)
	let paragraph: string[] = [], lists: { indent: number; el: HTMLElement }[] = [];
	const flush = () => {
		if (paragraph.length) {
			inline(root.appendChild(document.createElement('p')), paragraph.join(' '));
			paragraph = [];
		}
		lists = [];
	};
	for (let i = 0; i < lines.length; i++) {
		// HTML 주석(`<!-- -->`)은 안 보인다. Java 언어 서버가 목록 사이에 넣는데, 그 줄에서 목록을 끊으면 뒤 파라미터가 목록 밖으로 나간다
		const line = lines[i].replace(/<!--.*?-->/g, '');
		if (!line.trim() && lines[i].trim()) {
			continue;
		}
		const fence = /^\s*```/.exec(line);
		if (fence) {
			flush();
			const code: string[] = [];
			while (++i < lines.length && !/^\s*```/.test(lines[i])) {
				code.push(lines[i]);
			}
			const el = root.appendChild(document.createElement('pre')).appendChild(document.createElement('code'));
			el.append(highlight ? highlight(code.join('\n')) : code.join('\n'));
			continue;
		}
		const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
		const item = LIST_ITEM.exec(line);
		if (!line.trim()) {
			// 빈 줄 뒤에 목록 항목이 이어지면 같은 목록(느슨한 목록). Java 언어 서버는 파라미터 사이에 빈 줄·주석 줄을 넣는다
			const next = lines.slice(i + 1).map(l => l.replace(/<!--.*?-->/g, '')).find(l => l.trim());
			if (lists.length && !paragraph.length && next !== undefined && LIST_ITEM.test(next)) {
				continue;
			}
			flush();
		} else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
			flush();
			root.appendChild(document.createElement('hr'));
		} else if (heading) {
			flush();
			inline(root.appendChild(document.createElement('h4')), heading[1]);
		} else if (item) {
			if (paragraph.length) {
				const keep = lists;
				flush();
				lists = keep;
			}
			const indent = item[1].length;
			while (lists.length && indent < lists.at(-1)!.indent) {
				lists.pop();
			}
			const top = lists.at(-1);
			if (!top || indent > top.indent) {
				const parent = top?.el.lastElementChild ?? root;
				lists.push({ indent, el: parent.appendChild(document.createElement('ul')) });
			}
			inline(lists.at(-1)!.el.appendChild(document.createElement('li')), item[2]);
		} else if (lists.length && /^\s+/.test(line)) {
			// 목록 항목이 다음 줄로 이어짐
			const last = lists.at(-1)!.el.lastElementChild as HTMLElement;
			last.append(' ');
			inline(last, line.trim());
		} else {
			lists = [];
			paragraph.push(line.trim());
		}
	}
	flush();
	return root;
}
