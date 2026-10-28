import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { isScreen, parseXml } from '../core/xmlModel';
import { errorMessage } from '../core/errors';
import { GENERATED_DIRS, findWebRoot, serial } from '../project/paths';
import { convert, disposeWpack, publish, readWpackConfig, warmWpack } from '../project/wpack';
import { offerSetup, resolvePath } from './setup';

const wpackQueues = new Map<string, Promise<unknown>>();
/** 파일마다 마지막으로 변환한 XML: 저장과 디스크 변경 감시가 같은 내용을 두 번 변환하지 않게 */
const wpackDone = new Map<string, string>();
let warnedNoWpack = false;
const NOT_SCREEN_DIR = new RegExp(`[\\\\/](${GENERATED_DIRS})[\\\\/]`, 'i');

export function registerWpack(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument(doc => void wpackConvert(doc.uri, doc.getText())),
		watchScreenFiles(),
		{ dispose: disposeWpack },
	);
}

/**
 * 작업 폴더의 XML이 디스크에서 바뀌면(AI·다른 프로그램·Git) 저장 이벤트가 없으므로 디스크 내용으로 변환한다.
 * 문서를 읽고 쓰는 것(다시 읽기·저장·충돌 알림)은 VS Code가 평소처럼 하고, 저장 안 한 편집이 있는 파일은 건드리지 않는다(저장할 때 변환된다)
 */
function watchScreenFiles(): vscode.Disposable {
	const watcher = vscode.workspace.createFileSystemWatcher('**/*.xml');
	const timers = new Map<string, NodeJS.Timeout>();
	const onDisk = (uri: vscode.Uri) => {
		// 작업 폴더 기준으로 본다: 작업 폴더 자체가 D:\build\… 같은 곳에 있어도 거르지 않게
		if (uri.scheme !== 'file' || NOT_SCREEN_DIR.test(`/${vscode.workspace.asRelativePath(uri, false)}`)) {
			return;
		}
		const key = uri.toString();
		clearTimeout(timers.get(key));
		// 한 번 쓰기에 이벤트가 여러 번 올 수 있어 잠깐 모은다
		timers.set(key, setTimeout(() => void (async () => {
			timers.delete(key);
			if (vscode.workspace.textDocuments.some(d => d.isDirty && d.uri.toString() === key)) {
				return;
			}
			try {
				const disk = (await readFile(uri.fsPath, 'utf8')).replace(/^\uFEFF/, '');
				await wpackConvert(uri, disk, true);
			} catch {
				// 지워졌거나 아직 쓰는 중: 다음 변경 때 다시
			}
		})(), 30));
	};
	watcher.onDidChange(onDisk);
	watcher.onDidCreate(onDisk);
	// 첫 변환도 바로 되게, 시작이 끝난 뒤 작업 폴더의 웹 루트 변환기를 미리 띄운다
	// 제외 폴더를 위 목록보다 적게 둔다: 개발팩 웹 루트는 `bin` 아래(…\bin\websquare)에 있다
	const warm = setTimeout(() => void Promise.resolve(vscode.workspace.findFiles('**/websquare/config.xml', '**/{node_modules,.metadata,WEB-INF}/**', 1)).then(async ([config]) => {
		const webRoot = config && path.dirname(path.dirname(config.fsPath));
		if (webRoot && await readWpackConfig(webRoot).catch(() => undefined)) {
			await warmWpack(await resolvePath('wpackExecutable', config, webRoot));
		}
	}).catch(() => undefined), 3000);
	return { dispose: () => { watcher.dispose(); timers.forEach(clearTimeout); clearTimeout(warm); } };
}

/** fromDisk: 파일 감시로 읽은 내용. 방금 저장해서 이미 변환한 내용이면 건너뛰고, 읽을 수 없는 XML은 알리지 않는다(쓰는 중일 수 있다). 저장은 매번 변환 */
async function wpackConvert(uri: vscode.Uri, xml: string, fromDisk = false): Promise<void> {
	const file = uri.fsPath;
	if (uri.scheme !== 'file' || !/\.xml$/i.test(file)) {
		return;
	}
	const webRoot = await findWebRoot(file);
	const config = webRoot && await readWpackConfig(webRoot).catch(() => undefined);
	if (!webRoot || !config) {
		return;
	}
	const rel = path.relative(webRoot, file);
	const top = rel.split(path.sep)[0];
	if (rel.startsWith('..') || ['WEB-INF', 'META-INF', config.destRoot, '_wpackbabel_'].includes(top)) {
		return;
	}
	try {
		if (!isScreen(parseXml(xml))) {
			return;
		}
	} catch (e) {
		if (!fromDisk) {
			void vscode.window.showWarningMessage(`wpack 변환 건너뜀 (${path.basename(file)}): ${errorMessage(e)}`);
		}
		return;
	}
	const exe = await resolvePath('wpackExecutable', uri, webRoot);
	if (!exe) {
		if (!warnedNoWpack) {
			warnedNoWpack = true;
			void offerSetup('wpackExecutable', 'wpack 변환기를 찾지 못해 저장 시 변환을 건너뜁니다.', uri, webRoot);
		}
		return;
	}
	const name = path.basename(file);
	await serial(wpackQueues, file, async () => {
		if (fromDisk && wpackDone.get(file) === xml) {
			return;
		}
		wpackDone.set(file, xml);
		await publish(webRoot, config, rel, xml, await convert(exe, config, rel, xml));
		vscode.window.setStatusBarMessage(`$(check) wpack: ${name}`, 3000);
	}).catch(e => {
		if (wpackDone.get(file) === xml) {
			wpackDone.delete(file);
		}
		void vscode.window.showErrorMessage(`wpack 변환 실패 (${name}): ${errorMessage(e)}`);
	});
}
