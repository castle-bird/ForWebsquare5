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

export function renderMarkdown(source: string): HTMLElement {
	const root = Object.assign(document.createElement('div'), { className: 'md' });
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
	let paragraph: string[] = [], list: HTMLElement | undefined;
	const flush = () => {
		if (paragraph.length) {
			inline(root.appendChild(document.createElement('p')), paragraph.join(' '));
			paragraph = [];
		}
		list = undefined;
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const fence = /^\s*```/.exec(line);
		if (fence) {
			flush();
			const code: string[] = [];
			while (++i < lines.length && !/^\s*```/.test(lines[i])) {
				code.push(lines[i]);
			}
			root.appendChild(document.createElement('pre')).appendChild(Object.assign(document.createElement('code'), { textContent: code.join('\n') }));
			continue;
		}
		const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
		const item = /^\s*(?:[*+-]|\d+\.)\s+(.*)$/.exec(line);
		if (!line.trim()) {
			flush();
		} else if (heading) {
			flush();
			inline(root.appendChild(document.createElement('h4')), heading[1]);
		} else if (item) {
			if (paragraph.length) {
				const keep = list;
				flush();
				list = keep;
			}
			list ??= root.appendChild(document.createElement('ul'));
			inline(list.appendChild(document.createElement('li')), item[1]);
		} else if (list && /^\s+/.test(line)) {
			// 목록 항목이 다음 줄로 이어짐
			const last = list.lastElementChild as HTMLElement;
			last.append(' ');
			inline(last, line.trim());
		} else {
			list = undefined;
			paragraph.push(line.trim());
		}
	}
	flush();
	return root;
}
