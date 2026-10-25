// 현재 디자인 화면을 서버(WAS)·엔진 없이 브라우저에서 보는 페이지. 캔버스와 같은 Shadow DOM 구조로 그리고,
// 로컬 미리보기 서버(previewServer.ts)가 보내는 새 화면을 받아 스크롤을 유지한 채 바꾼다
export interface PreviewPage {
	title: string;
	/** 캔버스 `.wse-page`의 HTML(편집용 속성 제거됨) */
	html: string;
	/** 프로젝트 CSS(Shadow DOM용으로 바꾼 것)와 캔버스 기본 CSS. url()은 미리보기 서버가 읽을 수 있는 주소여야 한다 */
	css: string[];
	/** 외부 웹 폰트 @import(https만) */
	imports?: string[];
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const httpsOnly = (imports: string[] = []) => imports.filter(href => /^https:\/\//i.test(href));

const styleTags = (css: string[]) => css.map(text => `<style>${text.replace(/<\/style/gi, '<\\/style')}</style>`).join('\n');
const viewMarkup = (html: string) => `<div class="wse-view">${html}</div>`;

/** Shadow DOM 안에 들어갈 마크업(스타일 + 화면). 처음 페이지와 갱신이 같은 것을 쓴다 */
export const shadowMarkup = ({ html, css }: Pick<PreviewPage, 'html' | 'css'>) => `${styleTags(css)}\n${viewMarkup(html)}`;

/** 갱신 메시지(SSE data). withStyles가 아니면 화면만 보내고 브라우저는 스타일을 그대로 둔다(CSS를 다시 읽지 않게) */
export const updatePayload = (page: PreviewPage, withStyles = true) => JSON.stringify({
	view: viewMarkup(page.html), title: page.title,
	...withStyles && { styles: styleTags(page.css), imports: httpsOnly(page.imports) },
});

/** 브라우저 쪽: 서버가 보내는 새 화면으로 바꾼다(스크롤 유지). 끊기면 제목에 표시 */
const LIVE_SCRIPT = `(() => {
	const host = document.getElementById('host');
	const links = new Set([...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.getAttribute('href')));
	let title = document.title;
	const source = new EventSource('events');
	source.onmessage = e => {
		const next = JSON.parse(e.data);
		const root = host.shadowRoot;
		const old = root.querySelector('.wse-page');
		const top = old ? old.scrollTop : 0, left = old ? old.scrollLeft : 0;
		for (const href of next.imports || []) {
			if (!links.has(href)) {
				links.add(href);
				const link = document.createElement('link');
				link.rel = 'stylesheet';
				link.href = href;
				document.head.append(link);
			}
		}
		const view = root.querySelector('.wse-view');
		if (next.styles !== undefined || !view) {
			root.innerHTML = (next.styles || '') + '\\n' + next.view;
		} else {
			const fresh = document.createElement('template');
			fresh.innerHTML = next.view;
			view.replaceWith(fresh.content);
		}
		const page = root.querySelector('.wse-page');
		if (page) { page.scrollTop = top; page.scrollLeft = left; }
		title = document.title = next.title;
	};
	source.onerror = () => { document.title = '(연결 끊김) ' + title; };
	source.onopen = () => { document.title = title; };
})();`;

export function pageHtml(page: PreviewPage, nonce: string): string {
	const links = httpsOnly(page.imports).map(href => `<link rel="stylesheet" href="${escapeAttr(href)}">`).join('\n');
	return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data: https:; style-src 'unsafe-inline' https:; font-src 'self' data: https:">
<title>${page.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>
<style>html, body { margin: 0; height: 100%; } #host { height: 100%; }</style>
${links}
</head>
<body>
<div id="host"><template shadowrootmode="open">
${shadowMarkup(page)}
</template></div>
<script nonce="${nonce}">${LIVE_SCRIPT}</script>
</body>
</html>
`;
}
