// 현재 디자인 화면을 브라우저로 보기: 로컬 미리보기 서버(project/previewServer.ts)가 캔버스 스냅샷을 내보내고,
// 에디터에서 고치면 열린 브라우저 화면이 따라 바뀐다. 화면(패널)마다 하나
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { BrowserPage } from '../core/protocol';
import { PreviewServer, type Preview } from '../project/previewServer';

const server = new PreviewServer();

/** 확장을 끌 때: 열린 미리보기와 서버를 모두 끝낸다 */
export const disposeBrowserPreviews = () => server.dispose();

export class BrowserPreview {
	private opened?: Promise<Preview>;
	private preview?: Preview;
	/** 마지막으로 받은 CSS(주소 바꾼 것)·외부 폰트 */
	private css: string[] = [];
	private imports: string[] = [];

	/** notify: 미리보기가 시작·종료되면(브라우저를 닫은 경우 포함) 웹뷰에 알린다 */
	constructor(private readonly document: vscode.TextDocument, private readonly webview: vscode.Webview,
		private readonly webRoot: string, private readonly notify: (on: boolean) => void, private readonly engineRoot?: string) {}

	/** 처음이면 서버에 등록하고, 이미 열려 있으면 같은 주소를 다시 연다 */
	async open(page: BrowserPage): Promise<void> {
		this.opened ??= server.open(this.webRoot, () => { this.opened = this.preview = undefined; this.notify(false); }, this.engineRoot)
			.then(preview => { this.preview = preview; this.notify(true); return preview; })
			.catch(e => { this.opened = undefined; throw e; });
		const preview = await this.opened;
		this.update(page);
		await vscode.env.openExternal(vscode.Uri.parse(preview.url));
	}

	/** 에디터에서 화면이 바뀔 때: 열린 브라우저에 새 화면을 보낸다. css가 없으면 지난번 CSS 그대로(같은 배열이라 서버가 화면만 보낸다) */
	update(page: Pick<BrowserPage, 'html'> & Partial<BrowserPage>): void {
		const preview = this.preview;
		if (!preview) { return; }
		// 캔버스 CSS·그림 주소는 웹뷰 전용 주소라 브라우저가 못 읽는다: 웹 루트·설치본 엔진 주소를 미리보기 서버의 파일 경로로 바꾼다
		const uriPrefix = (dir: string) => this.webview.asWebviewUri(vscode.Uri.file(dir)).toString().replace(/\/$/, '') + '/';
		const replacements: [string, string][] = [[uriPrefix(this.webRoot), `${preview.fileBase}/`]];
		if (this.engineRoot && preview.engineBase) {
			replacements.push([uriPrefix(this.engineRoot), `${preview.engineBase}/`]);
		}
		replacements.sort((a, b) => b[0].length - a[0].length);
		const local = (text: string) => replacements.reduce((out, [from, to]) => out.split(from).join(to), text);
		if (page.css) {
			this.css = page.css.map(local);
			this.imports = page.imports ?? [];
		}
		const name = path.basename(this.document.fileName, path.extname(this.document.fileName));
		preview.publish({ title: `${name} - 미리보기`, html: local(page.html), css: this.css, imports: this.imports });
	}

	dispose(): void {
		this.preview?.close();
		this.opened = this.preview = undefined;
	}
}
