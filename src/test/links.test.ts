import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { cleanPath, DEFAULT_LINK_EXTS, DEFAULT_LINK_TABS, linkIdOf, linkProblem, moveTab, newTabId, orderTabs, readLinkExts, readLinkTabs, tabNameProblem } from '../core/links';
import { doctypeOf, parseDtd } from '../core/dtd';
import { xmlSchemaOf } from '../vscode/xmlSchema';
import { zipSync } from 'fflate';
import type { LinkState, ToWebview } from '../core/protocol';
import { LinkedFiles, registerLinks } from '../vscode/links';
import { linkTabs, saveLinkTabs } from '../vscode/linkTabs';
import { stagedText } from '../vscode/gitBase';
import { execFileSync } from 'child_process';
import { waitFor, SCREEN } from './helpers';

suite('links', () => {
	test('경로 입력 정리·연결 가능 검사', () => {
		assert.strictEqual(cleanPath('  "C:\\a b\\A.java" '), 'C:\\a b\\A.java');
		assert.strictEqual(cleanPath("'src/A.java'"), 'src/A.java');
		// 기본: 모든 탭이 웹 개발 파일(HTML·CSS·JS·Java·XML)을 받는다
		for (const file of ['/w/A.JAVA', '/w/a.xml', '/w/a.html', '/w/a.htm', '/w/a.css', '/w/a.js', '/w/a.sql']) {
			assert.strictEqual(linkProblem(file, true, DEFAULT_LINK_EXTS), undefined, file);
		}
		assert.match(linkProblem('/w/a.txt', true, DEFAULT_LINK_EXTS)!, /\.java·\.xml·\.html·\.htm·\.css·\.js·\.sql/);
		assert.match(linkProblem('/w/A.java', false, DEFAULT_LINK_EXTS)!, /작업 폴더/);
		// 설정: 점 없이·대문자·*.로 적어도 되고, 쓸 값이 없으면 기본값
		assert.deepStrictEqual(readLinkExts(['jsp', '.SQL', '*.java', 'jsp', '', 3, 'a b']), ['.jsp', '.sql', '.java']);
		assert.deepStrictEqual(readLinkExts([]), DEFAULT_LINK_EXTS);
		assert.deepStrictEqual(readLinkExts(undefined), DEFAULT_LINK_EXTS);
		assert.strictEqual(linkProblem('/w/a.jsp', true, readLinkExts(['jsp'])), undefined);
	});

	// 직접 쓴 작은 DTD(실제 MyBatis DTD 모양: 엔티티·선택지·주석)
	const DTD = `<!-- test -->
<!ENTITY % flag "(true|false)">
<!ELEMENT mapper (select* | update*)+>
<!ATTLIST mapper namespace CDATA #IMPLIED>
<!ELEMENT select (#PCDATA | if)*>
<!ATTLIST select
id CDATA #REQUIRED
useCache %flag; #IMPLIED
statementType (STATEMENT|PREPARED) "PREPARED"
>
<!ELEMENT update (#PCDATA)*>
<!ELEMENT if (#PCDATA)*>
<!ATTLIST if test CDATA #REQUIRED>`;
	const EXPECTED = [
		{ name: 'mapper', children: ['select', 'update'], attributes: [{ name: 'namespace' }], top: true },
		{ name: 'select', children: ['if'], attributes: [{ name: 'id' }, { name: 'useCache', values: ['true', 'false'] }, { name: 'statementType', values: ['STATEMENT', 'PREPARED'] }] },
		{ name: 'update', children: [], attributes: [] },
		{ name: 'if', children: [], attributes: [{ name: 'test' }] },
	];

	test('DTD: DOCTYPE 읽기, 요소·자식·속성·정해진 값(엔티티 풀기)', () => {
		assert.deepStrictEqual(doctypeOf('<?xml version="1.0"?>\n<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "https://mybatis.org/dtd/mybatis-3-mapper.dtd">'),
			{ root: 'mapper', system: 'https://mybatis.org/dtd/mybatis-3-mapper.dtd' });
		assert.deepStrictEqual(doctypeOf("<!DOCTYPE a SYSTEM 'a.dtd'>"), { root: 'a', system: 'a.dtd' });
		assert.strictEqual(doctypeOf('<mapper/>'), undefined);
		assert.deepStrictEqual(parseDtd(DTD, 'mapper'), EXPECTED);
	});

	test('DTD 스키마: 로컬 DTD 파일, 없으면 Maven 저장소 mybatis jar 안의 같은 이름 DTD', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-dtd-'));
		fs.writeFileSync(path.join(dir, 'local.dtd'), DTD);
		assert.deepStrictEqual((await xmlSchemaOf(path.join(dir, 'a.xml'), '<!DOCTYPE mapper SYSTEM "local.dtd"><mapper/>'))?.elements, EXPECTED);
		const home = process.env.HOME, profile = process.env.USERPROFILE;
		const jarDir = path.join(dir, '.m2', 'repository', 'org', 'mybatis', 'mybatis', '3.5.0');
		fs.mkdirSync(jarDir, { recursive: true });
		fs.writeFileSync(path.join(jarDir, 'mybatis-3.5.0.jar'), zipSync({ 'org/apache/ibatis/builder/xml/ws5-test-mapper.dtd': new TextEncoder().encode(DTD) }));
		process.env.HOME = process.env.USERPROFILE = dir;
		try {
			const found = await xmlSchemaOf(path.join(dir, 'b.xml'), '<!DOCTYPE mapper PUBLIC "-//x//EN" "https://example.org/dtd/ws5-test-mapper.dtd"><mapper/>');
			assert.deepStrictEqual(found?.elements, EXPECTED);
			assert.ok(found?.source.endsWith('mybatis-3.5.0.jar'));
			assert.strictEqual(await xmlSchemaOf(path.join(dir, 'c.xml'), '<!DOCTYPE mapper SYSTEM "https://example.org/none.dtd"><mapper/>'), undefined, '못 찾으면 없음');
		} finally {
			process.env.HOME = home;
			process.env.USERPROFILE = profile;
		}
	});

	test('탭 목록: 저장값 검사, 이름 중복·고정 탭 이름 거부, 새 id, 편집 대상 접두사', () => {
		assert.strictEqual(readLinkTabs(undefined), DEFAULT_LINK_TABS);
		assert.strictEqual(readLinkTabs([{ id: 1 }]), DEFAULT_LINK_TABS, '모양이 틀리면 기본');
		assert.deepStrictEqual(readLinkTabs([]), [], '전부 지운 상태는 그대로');
		assert.deepStrictEqual(readLinkTabs([{ id: 'controller', label: 'C', exts: ['.java'] }]), [{ id: 'controller', label: 'C' }], '예전 판의 탭별 확장자는 버림');
		assert.strictEqual(tabNameProblem(' DTO ', DEFAULT_LINK_TABS), undefined);
		for (const name of ['', '  ', 'source', 'Design', 'controller', 'x'.repeat(31)]) {
			assert.ok(tabNameProblem(name, DEFAULT_LINK_TABS), `거부: "${name}"`);
		}
		assert.strictEqual(newTabId(DEFAULT_LINK_TABS), 'tab1');
		assert.strictEqual(newTabId([...DEFAULT_LINK_TABS, { id: 'tab1', label: 'A' }]), 'tab2');
		assert.strictEqual(linkIdOf('link:tab1'), 'tab1');
		assert.strictEqual(linkIdOf('source'), undefined);
	});

	test('변경 표시 기준: Git 저장소의 스테이지 내용, 저장소 밖이면 undefined', async function () {
		this.timeout(30000);
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-git-'));
		const file = path.join(dir, 'A.java');
		fs.writeFileSync(file, 'class A {}\n');
		assert.strictEqual(await stagedText(vscode.Uri.file(file)), undefined, '저장소 밖');
		const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
		try {
			git('init', '-q');
			git('add', 'A.java');
		} catch {
			this.skip(); // git이 없는 환경
		}
		fs.writeFileSync(file, 'class A { int x; }\n');
		type GitApi = { openRepository(root: vscode.Uri): Promise<unknown> };
		const api = (await vscode.extensions.getExtension<{ getAPI(v: 1): GitApi }>('vscode.git')?.activate())?.getAPI(1);
		if (!api) {
			this.skip();
		}
		await api!.openRepository(vscode.Uri.file(dir));
		assert.strictEqual((await stagedText(vscode.Uri.file(file)))?.replace(/\r\n/g, '\n'), 'class A {}\n', '작업 중 내용이 아니라 스테이지 내용');
	});

	test('탭 순서: 저장된 순서대로, 모르는 이름은 무시하고 새 탭은 뒤에', () => {
		assert.deepStrictEqual(orderTabs(['D', 'S', 'C', 'M'], ['M', 'x', 'D']), ['M', 'D', 'S', 'C']);
		assert.deepStrictEqual(moveTab(['A', 'B', 'C', 'D'], 'D', 'A', false), ['D', 'A', 'B', 'C']);
		assert.deepStrictEqual(moveTab(['A', 'B', 'C', 'D'], 'A', 'C', true), ['B', 'C', 'A', 'D']);
		assert.deepStrictEqual(moveTab(['A', 'B'], 'A', 'zz', true), ['A', 'B']);
	});

	// 확장의 저장소 대신 메모리 저장소
	const memento = () => {
		const values = new Map<string, unknown>();
		return {
			keys: () => [...values.keys()],
			get: (key: string, fallback?: unknown) => values.has(key) ? values.get(key) : fallback,
			update: async (key: string, value: unknown) => { if (value === undefined) { values.delete(key); } else { values.set(key, value); } },
		} as vscode.Memento;
	};
	const context = { workspaceState: memento(), globalState: memento(), subscriptions: [] as vscode.Disposable[] };
	suiteSetup(() => registerLinks(context as unknown as vscode.ExtensionContext));
	suiteTeardown(() => context.subscriptions.forEach(s => s.dispose()));
	const linked = async (saved: (dir: string) => Record<string, string>, onPost?: (msg: ToWebview) => void) => {
		// vscode.Uri.fsPath는 Windows 드라이브 문자를 소문자로 바꾸므로 같은 꼴로 맞춘다
		const dir = vscode.Uri.file(fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-links-'))).fsPath;
		const screen = path.join(dir, 'A.xml'), java = path.join(dir, 'AController.java');
		fs.writeFileSync(screen, SCREEN);
		fs.writeFileSync(java, 'class A {}\n');
		const key = `websquare5-editor.links:${screen}`;
		await context.workspaceState.update(key, saved(dir));
		const sent: LinkState[] = [];
		const links = new LinkedFiles(await vscode.workspace.openTextDocument(vscode.Uri.file(screen)), async msg => {
			if (msg.type === 'linked') { sent.push(msg); }
			onPost?.(msg);
			return true;
		});
		const last = (kind: string) => sent.filter(m => m.kind === kind).at(-1);
		return { dir, screen, java, key, links, last };
	};

	test('VS Code가 연결 파일에 낸 문제(언어 서버 등)를 그 파일 버전과 함께 웹뷰로', async () => {
		const problems: Extract<ToWebview, { type: 'diagnostics' }>[] = [];
		const { java, links, last } = await linked(dir => ({ controller: path.join(dir, 'AController.java') }), msg => { if (msg.type === 'diagnostics') { problems.push(msg); } });
		const collection = vscode.languages.createDiagnosticCollection('ws5-test');
		try {
			await links.reload();
			const version = last('controller')!.version!;
			collection.set(vscode.Uri.file(java), [Object.assign(new vscode.Diagnostic(new vscode.Range(0, 6, 0, 7), '문법 오류', vscode.DiagnosticSeverity.Error), { source: 'Java' })]);
			for (let i = 0; i < 40 && !problems.some(p => p.items.length); i++) {
				await new Promise(r => setTimeout(r, 50));
			}
			const sent = problems.filter(p => p.items.length).at(-1)!;
			assert.strictEqual(sent.target, 'link:controller');
			assert.strictEqual(sent.version, version, '그 파일의 지금 버전');
			assert.deepStrictEqual(sent.items.filter(i => i.source === 'Java'), [{ fromLine: 0, fromCh: 6, toLine: 0, toCh: 7, severity: 'error', message: '문법 오류', source: 'Java' }]);
		} finally {
			collection.dispose();
			await links.dispose();
		}
	});

	test('연결 파일을 보내고, 본 버전에서만 고치고, 저장은 그 파일만', async () => {
		const { screen, java, links, last } = await linked(dir => ({ controller: path.join(dir, 'AController.java') }));
		try {
			await links.reload();
			const first = last('controller')!;
			assert.strictEqual(first.text, 'class A {}\n');
			assert.strictEqual(first.dirty, false);
			assert.deepStrictEqual(last('service'), { type: 'linked', kind: 'service' }, '연결 안 된 탭');
			const change = [{ fromLine: 0, fromCh: 9, toLine: 0, toCh: 9, insert: ' int x; ' }];
			const result = await links.edit('controller', first.version!, change);
			assert.ok(result.ok && result.version > first.version!);
			assert.strictEqual((await links.edit('controller', first.version!, change)).ok, false, '옛 버전 편집은 거부');
			await links.saveLink('controller');
			assert.strictEqual(fs.readFileSync(java, 'utf8'), 'class A { int x; }\n');
			assert.strictEqual(vscode.workspace.textDocuments.find(d => d.uri.fsPath === screen)?.isDirty, false, '화면 XML은 그대로');
		} finally {
			await links.dispose();
		}
	});

	test('파일이 없으면 경로만, 연결 해제하면 빈 상태. 작업 폴더 밖·다른 확장자는 연결하지 않음', async () => {
		const { dir, java, key, links, last } = await linked(dir => ({ controller: path.join(dir, 'AController.java'), mapper: path.join(dir, 'gone.java') }));
		try {
			await links.reload();
			assert.deepStrictEqual(last('mapper'), { type: 'linked', kind: 'mapper', path: vscode.Uri.file(path.join(dir, 'gone.java')).fsPath });
			await links.unlink('mapper');
			assert.ok(await waitFor(() => last('mapper')?.path === undefined));
			assert.deepStrictEqual(context.workspaceState.get(key), { controller: java });
			await links.link('mybatis', java);
			await links.link('service', java);
			assert.deepStrictEqual(context.workspaceState.get(key), { controller: java }, '다른 확장자·이미 다른 탭에 연결된 파일은 거부');
		} finally {
			await links.dispose();
		}
	});

	test('탭 추가·삭제: 열린 화면에 새 목록을 보내고, 지운 탭의 연결은 끊고 저장소에서도 지운다', async () => {
		const tabsSent: unknown[] = [];
		const { java, key, links, last } = await linked(dir => ({ controller: path.join(dir, 'AController.java') }), msg => msg.type === 'linkTabs' && tabsSent.push(msg));
		try {
			await links.reload();
			const custom = { id: 'tab1', label: 'DTO' };
			await saveLinkTabs([...linkTabs(), custom]);
			assert.ok(await waitFor(() => last('tab1') !== undefined), '새 탭 상태 전송');
			assert.deepStrictEqual((tabsSent.at(-1) as { tabs: unknown }).tabs, [...DEFAULT_LINK_TABS, custom]);
			await saveLinkTabs(linkTabs().filter(t => t.id !== 'controller'));
			assert.ok(await waitFor(() => (tabsSent.at(-1) as { tabs: { id: string }[] }).tabs.every(t => t.id !== 'controller')));
			assert.deepStrictEqual(context.workspaceState.get(key), {}, '지운 탭의 연결 정보 삭제');
			const result = await links.edit('controller', 1, [{ fromLine: 0, fromCh: 0, toLine: 0, toCh: 0, insert: 'x' }]);
			assert.strictEqual(result.ok, false, '지운 탭으로는 편집 안 됨');
			assert.strictEqual(vscode.workspace.textDocuments.find(d => d.uri.fsPath === java)?.getText() ?? 'class A {}\n', 'class A {}\n');
		} finally {
			await saveLinkTabs(DEFAULT_LINK_TABS);
			await links.dispose();
		}
	});

	test('연결 탭에서 고친 파일을 VS Code가 배경 탭으로 열면, 연결 탭에서 저장할 때 그 탭을 닫는다', async function () {
		this.timeout(10000);
		const { java, links, last } = await linked(dir => ({ controller: path.join(dir, 'AController.java') }));
		const tabsOf = () => vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputText && t.input.uri.fsPath === java);
		try {
			await links.reload();
			assert.ok((await links.edit('controller', last('controller')!.version!, [{ fromLine: 0, fromCh: 0, toLine: 0, toCh: 0, insert: '// x\n' }])).ok);
			// VS Code가 저장 안 한 파일을 여는 데 걸리는 시간(이 동작이 없는 버전이면 탭이 안 생기고, 그때는 닫을 것도 없다)
			const opened = await waitFor(() => tabsOf().length > 0);
			await links.saveLink('controller');
			if (opened) {
				assert.ok(await waitFor(() => tabsOf().length === 0), '저장하면 배경 탭이 닫힘');
			}
			assert.strictEqual(fs.readFileSync(java, 'utf8'), '// x\nclass A {}\n');
		} finally {
			await links.dispose();
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		}
	});

	test('VS Code에서 파일 이름을 바꾸면 연결도 따라간다', async () => {
		const { dir, java, key, links, last } = await linked(dir => ({ controller: path.join(dir, 'AController.java') }));
		try {
			await links.reload();
			const moved = path.join(dir, 'BController.java');
			const edit = new vscode.WorkspaceEdit();
			edit.renameFile(vscode.Uri.file(java), vscode.Uri.file(moved));
			assert.ok(await vscode.workspace.applyEdit(edit));
			assert.ok(await waitFor(() => last('controller')?.path === vscode.Uri.file(moved).fsPath));
			assert.deepStrictEqual(context.workspaceState.get(key), { controller: moved });
		} finally {
			await links.dispose();
		}
	});
});
