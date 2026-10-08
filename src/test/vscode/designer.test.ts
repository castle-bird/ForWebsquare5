import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { isScreen, parseXml } from '../../core/xmlModel';
import { openFrame, VIEW_TYPE } from '../../extension';
import { clearAutoCache, resolvePath } from '../../vscode/setup';
import { waitFor, SCREEN } from '../helpers';

suite('xmlModel', () => {
	test('트리·순서·위치·속성', () => {
		const root = parseXml(SCREEN)!;
		const flat: string[] = [];
		const walk = (n: typeof root) => { flat.push(`${n.index}:${n.tag}`); n.children.forEach(walk); };
		walk(root);
		assert.deepStrictEqual(flat, ['0:html', '1:head', '2:w2:dataCollection', '3:w2:dataMap', '4:script', '5:body', '6:xf:group', '7:w2:textbox']);

		const group = root.children[1].children[0];
		assert.strictEqual(group.attrs.title, 'a < b');
		assert.ok(SCREEN.slice(group.start, group.end).startsWith('<xf:group id="grp_main"'));
		assert.ok(SCREEN.slice(group.start, group.end).endsWith('</xf:group>'));
		const textbox = group.children[0];
		assert.strictEqual(SCREEN.slice(textbox.start, textbox.end), '<w2:textbox id="tbx_title" label="한글"/>');
		assert.strictEqual(root.children[0].children[1].text, 'if (a < b) { scwin.x = "<tag>"; }', 'CDATA 텍스트');
		assert.strictEqual(group.text, undefined, '공백뿐이면 없음');
	});

	test('빈 문서', () => {
		assert.strictEqual(parseXml(''), undefined);
	});
});

suite('designer', () => {
	test('웹 루트 안 화면 XML은 폴더와 상관없이 디자이너로, 다른 XML은 텍스트 편집기 그대로', async function () {
		this.timeout(20000); // 탭 전환을 기다린다
		// 웹 루트 = websquare/config.xml 있는 폴더. 화면은 ui가 아닌 cm/xml 아래에 둔다
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-'));
		fs.mkdirSync(path.join(dir, 'websquare'));
		fs.writeFileSync(path.join(dir, 'websquare', 'config.xml'), '<WebSquare/>');
		fs.mkdirSync(path.join(dir, 'cm', 'xml'), { recursive: true });
		const screen = path.join(dir, 'cm', 'xml', 'TEST001.xml');
		fs.writeFileSync(screen, SCREEN);
		const other = path.join(dir, 'cm', 'xml', 'mapper.xml');
		fs.writeFileSync(other, '<mapper namespace="x"/>');

		const activeInput = () => vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(screen));
		await waitFor(() => activeInput() instanceof vscode.TabInputCustom);
		const input = activeInput();
		assert.ok(input instanceof vscode.TabInputCustom, '화면 XML이 디자이너로 바뀌지 않음');
		assert.strictEqual(input.viewType, VIEW_TYPE);
		// 이 화면의 텍스트 탭만 센다(다른 테스트 파일이 연 탭은 상관없음)
		assert.strictEqual(vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputText && t.input.uri.toString() === vscode.Uri.file(screen).toString()).length, 0, '텍스트 탭은 닫힘');

		// 디자이너에서 "텍스트 편집기로 다시 열기"를 하면 다시 디자이너로 되돌리지 않는다 (루프 방지)
		await vscode.commands.executeCommand('workbench.action.reopenTextEditor');
		await new Promise(r => setTimeout(r, 1500));
		assert.ok(activeInput() instanceof vscode.TabInputText, '다시 열기 → 텍스트는 그대로 텍스트');

		await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(other));
		await new Promise(r => setTimeout(r, 1000));
		assert.ok(activeInput() instanceof vscode.TabInputText, '다른 XML은 텍스트 편집기');
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('연결 화면 열기: wframe src를 화면 기준으로 풀어 디자이너 새 탭으로', async function () {
		this.timeout(20000);
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-open-'));
		fs.mkdirSync(path.join(dir, 'websquare'));
		fs.writeFileSync(path.join(dir, 'websquare', 'config.xml'), '<WebSquare/>');
		fs.mkdirSync(path.join(dir, 'ui'));
		fs.writeFileSync(path.join(dir, 'ui', 'SUB.xml'), SCREEN);
		const main = path.join(dir, 'ui', 'MAIN.xml');
		fs.writeFileSync(main, '<html xmlns:w2="http://www.inswave.com/websquare"><body><w2:wframe src="SUB.xml?x=1"/></body></html>');
		// 문서만 열고(탭 없음) wframe(노드 2번)의 src를 화면 위치 기준으로 푼다. ?쿼리는 무시
		await openFrame(await vscode.workspace.openTextDocument(vscode.Uri.file(main)), 2, dir);
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		assert.ok(input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE, '디자이너로 열림');
		assert.strictEqual(input.uri.fsPath.toLowerCase(), path.join(dir, 'ui', 'SUB.xml').toLowerCase());
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('isScreen: 최상위 html + 웹스퀘어 namespace(접두사 무관)', () => {
		assert.ok(isScreen(parseXml(SCREEN)));
		assert.ok(isScreen(parseXml('<html xmlns:ws="http://www.inswave.com/websquare"/>')), '접두사가 w2가 아니어도');
		assert.ok(!isScreen(parseXml('<html xmlns="http://www.w3.org/1999/xhtml"/>')), '일반 XHTML');
		assert.ok(!isScreen(parseXml('<WebSquare xmlns:w2="http://www.inswave.com/websquare"/>')), '엔진 설정');
	});

	test('환경 설정: 명령 등록, Eclipse 설치 폴더 미지정이면 도구 3개 못 찾음', async () => {
		assert.ok((await vscode.commands.getCommands(true)).includes('websquare5-editor.setup'));
		const outside = vscode.Uri.file(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-setup-')), 'A.xml'));
		for (const key of ['componentDefinitionFile', 'wpackExecutable', 'apiDocumentationPath'] as const) {
			assert.strictEqual(await resolvePath(key, outside), undefined, `${key}: Eclipse 폴더 미지정`);
		}
	});

	test('환경 설정: Eclipse 설치 폴더만 지정하면 그 밑에서 이름 상관없이 도구 3개 자동 탐색', async () => {
		// 플러그인 폴더 이름을 임의로 지어 이름 가정이 없음을 확인
		const eclipseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-eclipse-'));
		const configDir = path.join(eclipseRoot, 'weird.plugin.name_1.0', 'config', '9.9.9.9');
		fs.mkdirSync(configDir, { recursive: true });
		fs.writeFileSync(path.join(configDir, 'WebSquareConfig.xml'), '<WebSquare/>');
		const wpackDir = path.join(eclipseRoot, 'another.plugin', 'node', 'node_modules', 'w-pack');
		fs.mkdirSync(wpackDir, { recursive: true });
		fs.writeFileSync(path.join(wpackDir, 'index.js'), '');
		const apiDir = path.join(eclipseRoot, 'help.plugin', 'html', 'websquare', 'html');
		fs.mkdirSync(path.join(apiDir, '$p'), { recursive: true });
		fs.writeFileSync(path.join(apiDir, 'index.html'), '');

		const uri = vscode.Uri.file(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-setup-')), 'A.xml'));
		const config = vscode.workspace.getConfiguration('websquare5-editor');
		await config.update('eclipseInstallPath', eclipseRoot, vscode.ConfigurationTarget.Global);
		try {
			assert.strictEqual(await resolvePath('componentDefinitionFile', uri), path.join(configDir, 'WebSquareConfig.xml'));
			assert.strictEqual(await resolvePath('wpackExecutable', uri), path.join(wpackDir, 'index.js'));
			assert.strictEqual(await resolvePath('apiDocumentationPath', uri), apiDir);
			// 예전 PC·옛 개발팩 경로처럼 없는 경로가 저장돼 있으면 무시하고 자동 탐색
			await config.update('apiDocumentationPath', path.join(eclipseRoot, 'gone', 'docs', 'API'), vscode.ConfigurationTarget.Global);
			assert.strictEqual(await resolvePath('apiDocumentationPath', uri), apiDir, '없는 설정 경로 → 자동 탐색');
			// 있는 경로면 설정값이 우선
			await config.update('apiDocumentationPath', eclipseRoot, vscode.ConfigurationTarget.Global);
			assert.strictEqual(await resolvePath('apiDocumentationPath', uri), eclipseRoot, '있는 설정 경로 우선');
		} finally {
			await config.update('apiDocumentationPath', undefined, vscode.ConfigurationTarget.Global);
			await config.update('eclipseInstallPath', undefined, vscode.ConfigurationTarget.Global);
		}
	});

	test('환경 설정: 자동 탐색은 폴더당 한 번만 뒤지고, 설정이 바뀌면 다시 뒤진다', async () => {
		const eclipseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-eclipse-'));
		const wpackDir = path.join(eclipseRoot, 'plugin', 'w-pack');
		fs.mkdirSync(wpackDir, { recursive: true });
		fs.writeFileSync(path.join(wpackDir, 'index.js'), '');
		const uri = vscode.Uri.file(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-setup-')), 'A.xml'));
		const config = vscode.workspace.getConfiguration('websquare5-editor');
		await config.update('eclipseInstallPath', eclipseRoot, vscode.ConfigurationTarget.Global);
		try {
			assert.strictEqual(await resolvePath('wpackExecutable', uri), path.join(wpackDir, 'index.js'));
			// 도구 위치는 실행 중 안 바뀐다는 전제 — 폴더가 사라져도 같은 세션에선 캐시된 경로를 그대로 돌려준다(다시 뒤지지 않음)
			fs.rmSync(wpackDir, { recursive: true, force: true });
			assert.strictEqual(await resolvePath('wpackExecutable', uri), path.join(wpackDir, 'index.js'), '캐시된 경로 유지');
			// 설정이 바뀌면(registerSetup의 onDidChangeConfiguration) 캐시를 비워 다시 뒤진다
			clearAutoCache();
			assert.strictEqual(await resolvePath('wpackExecutable', uri), undefined, '캐시를 비우면 실제로 없는 경로를 다시 확인');
		} finally {
			await config.update('eclipseInstallPath', undefined, vscode.ConfigurationTarget.Global);
		}
	});
});
