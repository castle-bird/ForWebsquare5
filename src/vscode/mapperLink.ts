// Mapper 인터페이스 ↔ MyBatis 매퍼 XML 정의로 이동(Ctrl+클릭·F12), 줄 옆 아이콘·호버 안내·CodeLens. Java·MyBatis 확장 없이 작업 폴더 파일 글자에서 찾는다
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	isLikelyJavaMapper, javaHitAt, javaPlace, lineColAt, parseJavaMapper, parseXmlMapper, xmlHitAt, xmlPlace,
	type MapperLinkMark, type Named,
} from '../core/mapperLink';
import { mapLimit } from '../project/paths';

/** 빌드 산출물·의존성 폴더는 찾지 않는다 */
const EXCLUDE = '{**/target/**,**/build/**,**/bin/**,**/out/**,**/node_modules/**,**/.git/**}';
const MAX_FILES = 20000;
const CONCURRENCY = 32;
const MAPPER_PATH_HINT = /mapper|sql|mybatis|dao|query|repository/i;
const OPEN_CMD = 'for-websquare5.openMapperTarget';

/** 파일마다 읽은 매퍼 XML namespace(수정 시각이 같으면 다시 읽지 않는다). 매퍼가 아니면 '' */
const namespaces = new Map<string, { mtime: number; namespace: string }>();
/** 같은 문서·같은 버전의 중복 링크 계산을 합친다 */
const resolvedCache = new Map<string, { version: number; promise: Promise<ResolvedMapperLink[]> }>();

interface ResolvedMapperLink extends MapperLinkMark {
	targetUri: vscode.Uri;
	targetRange: vscode.Range;
}

/** 열린 문서(저장 안 한 편집 포함)를 먼저 읽고, 열려 있지 않으면 디스크에서 읽는다 */
async function readText(uri: vscode.Uri): Promise<string> {
	const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
	return open ? open.getText() : new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

async function namespaceOf(uri: vscode.Uri): Promise<string> {
	const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
	if (open?.isDirty) {
		const text = open.getText();
		return text.includes('<mapper') ? parseXmlMapper(text)?.namespace.name ?? '' : '';
	}
	const { mtime } = await vscode.workspace.fs.stat(uri);
	const hit = namespaces.get(uri.toString());
	if (hit?.mtime === mtime) { return hit.namespace; }
	const text = open ? open.getText() : new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	const namespace = text.includes('<mapper') ? parseXmlMapper(text)?.namespace.name ?? '' : '';
	namespaces.set(uri.toString(), { mtime, namespace });
	return namespace;
}

const hasCachedNamespace = (fqcn: string) => [...namespaces.values()].some(v => v.namespace === fqcn);

const scope = (doc: vscode.TextDocument, glob: string) => {
	const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
	return folder ? new vscode.RelativePattern(folder, glob) : glob;
};

/** 영문·숫자만 소문자로: UserMapper·user_mapper·user-mapper.xml 비교용 */
const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** namespace가 fqcn인 매퍼 XML. 캐시 → 이름 유사 파일 → 매퍼 경로 힌트 → 나머지 XML 순으로 찾는다 */
async function mapperXmls(doc: vscode.TextDocument, fqcn: string): Promise<vscode.Uri[]> {
	const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
	const cached = [...namespaces.entries()]
		.filter(([, v]) => v.namespace === fqcn)
		.map(([k]) => vscode.Uri.parse(k))
		.filter(uri => !folder || vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() === folder.uri.toString());
	if (cached.length) {
		const verified = (await mapLimit(cached, CONCURRENCY, async uri => {
			try {
				return await namespaceOf(uri) === fqcn ? uri : undefined;
			} catch {
				namespaces.delete(uri.toString());
				return undefined;
			}
		})).filter(uri => uri !== undefined);
		if (verified.length) { return verified; }
	}

	const files = await vscode.workspace.findFiles(scope(doc, '**/*.xml'), EXCLUDE, MAX_FILES);
	const stem = plain(fqcn.slice(fqcn.lastIndexOf('.') + 1).replace(/(Mapper|Dao|Repository)$/, ''));
	const matching = async (list: vscode.Uri[]) => (await mapLimit(list, CONCURRENCY, async uri =>
		await namespaceOf(uri).catch(() => '') === fqcn ? uri : undefined
	)).filter(uri => uri !== undefined);

	const near: vscode.Uri[] = [];
	const hinted: vscode.Uri[] = [];
	const other: vscode.Uri[] = [];
	for (const uri of files) {
		if (stem && plain(path.basename(uri.fsPath, '.xml')).includes(stem)) {
			near.push(uri);
		} else if (MAPPER_PATH_HINT.test(uri.fsPath)) {
			hinted.push(uri);
		} else {
			other.push(uri);
		}
	}
	const first = await matching(near);
	if (first.length) { return first; }
	const second = await matching(hinted);
	return second.length ? second : matching(other);
}

/** 패키지까지 같은 Mapper 인터페이스 파일 */
async function mapperJavas(doc: vscode.TextDocument, fqcn: string): Promise<vscode.Uri[]> {
	const name = fqcn.slice(fqcn.lastIndexOf('.') + 1);
	const files = await vscode.workspace.findFiles(scope(doc, `**/${name}.java`), EXCLUDE, MAX_FILES);
	const found = await mapLimit(files, CONCURRENCY, async uri => {
		const text = await readText(uri).catch(() => '');
		return parseJavaMapper(text)?.fqcn === fqcn ? uri : undefined;
	});
	return found.filter(uri => uri !== undefined);
}

const rangeOf = (text: string, named: Named): vscode.Range => {
	const start = lineColAt(text, named.at);
	const end = lineColAt(text, named.at + named.name.length);
	return new vscode.Range(start.line, start.ch, end.line, end.ch);
};

/** 열린 문서(저장 안 한 편집 포함) 또는 디스크 글자에서 이름 자리를 찾는다(숨은 문서를 새로 열지 않는다) */
async function located(uris: vscode.Uri[], place: (text: string) => Named | undefined, originSelectionRange: vscode.Range): Promise<vscode.LocationLink[]> {
	const found = await mapLimit(uris, CONCURRENCY, async uri => {
		const text = await readText(uri).catch(() => '');
		const at = text ? place(text) : undefined;
		if (!at) { return undefined; }
		const range = rangeOf(text, at);
		return { originSelectionRange, targetUri: uri, targetRange: range, targetSelectionRange: range } satisfies vscode.LocationLink;
	});
	return found.filter(l => l !== undefined);
}

/** Mapper 메서드·인터페이스 이름 → 매퍼 XML의 문 id·namespace, 그 반대(원래 이름 범위 포함) */
async function mapperDefinitionLinks(doc: vscode.TextDocument, position: vscode.Position): Promise<vscode.LocationLink[] | undefined> {
	const text = doc.getText(), offset = doc.offsetAt(position);
	const ext = path.extname(doc.uri.path).toLowerCase();
	let found: vscode.LocationLink[];
	if (ext === '.java') {
		const hit = javaHitAt(text, offset);
		if (!hit) { return undefined; }
		const originRange = new vscode.Range(doc.positionAt(hit.origin.at), doc.positionAt(hit.origin.at + hit.origin.name.length));
		found = await located(await mapperXmls(doc, hit.target.fqcn), xml => { const m = parseXmlMapper(xml); return m && xmlPlace(m, hit.target.id); }, originRange);
	} else if (ext === '.xml') {
		const hit = text.includes('<mapper') ? xmlHitAt(text, offset) : undefined;
		if (!hit) { return undefined; }
		const originRange = new vscode.Range(doc.positionAt(hit.origin.at), doc.positionAt(hit.origin.at + hit.origin.name.length));
		found = await located(await mapperJavas(doc, hit.target.fqcn), java => { const m = parseJavaMapper(java); return m && javaPlace(m, hit.target.id); }, originRange);
	} else {
		return undefined;
	}
	return found.length ? found : undefined;
}

/** Mapper 메서드·인터페이스 이름 → 매퍼 XML의 문 id·namespace, 그 반대. 해당 자리가 아니거나 못 찾으면 undefined */
export async function mapperDefinition(doc: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[] | undefined> {
	const links = await mapperDefinitionLinks(doc, position);
	return links?.map(l => new vscode.Location(l.targetUri, l.targetSelectionRange ?? l.targetRange));
}

/** 문서 안 매퍼 ↔ XML로 이동할 수 있는 모든 자리(실제로 연결된 대상이 있을 때만) */
async function computeMapperLinks(doc: vscode.TextDocument): Promise<ResolvedMapperLink[]> {
	const text = doc.getText();
	const ext = path.extname(doc.uri.path).toLowerCase();
	if (ext === '.java') {
		const mapper = parseJavaMapper(text);
		if (!mapper || (!hasCachedNamespace(mapper.fqcn) && !isLikelyJavaMapper(text, path.basename(doc.uri.fsPath)))) {
			return [];
		}
		const xmlUris = await mapperXmls(doc, mapper.fqcn);
		if (!xmlUris.length) { return []; }
		const stmtMap = new Map<string, { uri: vscode.Uri; file: string; range: vscode.Range }>();
		let typeTarget: { uri: vscode.Uri; file: string; range: vscode.Range } | undefined;
		for (const uri of xmlUris) {
			const xmlText = await readText(uri).catch(() => '');
			const parsed = xmlText ? parseXmlMapper(xmlText) : undefined;
			if (!parsed) { continue; }
			const file = path.basename(uri.fsPath);
			typeTarget ??= { uri, file, range: rangeOf(xmlText, parsed.namespace) };
			for (const stmt of parsed.statements) {
				if (!stmtMap.has(stmt.name)) {
					stmtMap.set(stmt.name, { uri, file, range: rangeOf(xmlText, stmt) });
				}
			}
		}
		const marks: ResolvedMapperLink[] = [];
		const push = (named: Named, target: { uri: vscode.Uri; file: string; range: vscode.Range }, id?: string) => {
			const pos = doc.positionAt(named.at);
			marks.push({ line: pos.line, ch: pos.character, length: named.name.length, direction: 'xml', targetFile: target.file, id, targetUri: target.uri, targetRange: target.range });
		};
		if (typeTarget) { push(mapper.type, typeTarget); }
		for (const method of mapper.methods) {
			const target = stmtMap.get(method.name);
			if (target) { push(method, target, method.name); }
		}
		return marks;
	}
	if (ext === '.xml' && text.includes('<mapper')) {
		const mapper = parseXmlMapper(text);
		if (!mapper) { return []; }
		const javaUris = await mapperJavas(doc, mapper.namespace.name);
		if (!javaUris.length) { return []; }
		const methodMap = new Map<string, { uri: vscode.Uri; file: string; range: vscode.Range }>();
		let nsTarget: { uri: vscode.Uri; file: string; range: vscode.Range } | undefined;
		for (const uri of javaUris) {
			const javaText = await readText(uri).catch(() => '');
			const parsed = javaText ? parseJavaMapper(javaText) : undefined;
			if (!parsed) { continue; }
			const file = path.basename(uri.fsPath);
			nsTarget ??= { uri, file, range: rangeOf(javaText, parsed.type) };
			for (const method of parsed.methods) {
				if (!methodMap.has(method.name)) {
					methodMap.set(method.name, { uri, file, range: rangeOf(javaText, method) });
				}
			}
		}
		const marks: ResolvedMapperLink[] = [];
		const push = (named: Named, target: { uri: vscode.Uri; file: string; range: vscode.Range }, id?: string) => {
			const pos = doc.positionAt(named.at);
			marks.push({ line: pos.line, ch: pos.character, length: named.name.length, direction: 'java', targetFile: target.file, id, targetUri: target.uri, targetRange: target.range });
		};
		if (nsTarget) { push(mapper.namespace, nsTarget); }
		for (const stmt of mapper.statements) {
			const target = methodMap.get(stmt.name);
			if (target) { push(stmt, target, stmt.name); }
		}
		return marks;
	}
	return [];
}

function resolveMapperLinks(doc: vscode.TextDocument): Promise<ResolvedMapperLink[]> {
	const key = doc.uri.toString();
	const version = doc.version;
	const hit = resolvedCache.get(key);
	if (hit?.version === version) { return hit.promise; }
	const promise = computeMapperLinks(doc).catch(err => {
		if (resolvedCache.get(key)?.promise === promise) {
			resolvedCache.delete(key);
		}
		throw err;
	});
	resolvedCache.set(key, { version, promise });
	return promise;
}

/** 웹뷰 연결 탭에 보낼 매퍼 링크 표시 목록 */
export async function mapperLinksOf(doc: vscode.TextDocument): Promise<MapperLinkMark[]> {
	const links = await resolveMapperLinks(doc);
	return links.map(({ line, ch, length, direction, targetFile, id }) => ({ line, ch, length, direction, targetFile, ...id !== undefined && { id } }));
}

const commandArgs = (uri: vscode.Uri, range: vscode.Range) => [
	uri.toString(), range.start.line, range.start.character, range.end.line, range.end.character,
] as const;

/** VS Code 편집기에서도 같은 이동·아이콘·호버·CodeLens. 연결 탭은 links.ts가 직접 먼저 묻는다 */
export function registerMapperLink(context: vscode.ExtensionContext) {
	const selector: vscode.DocumentSelector = [{ language: 'java' }, { language: 'xml' }];
	const lensChanged = new vscode.EventEmitter<void>();
	const icon = (name: string) => vscode.Uri.joinPath(context.extensionUri, 'media', 'icons', name);
	const toXmlDeco = vscode.window.createTextEditorDecorationType({
		light: { gutterIconPath: icon('mapper-xml-light.svg') },
		dark: { gutterIconPath: icon('mapper-xml-dark.svg') },
		gutterIconSize: '85%',
	});
	const toJavaDeco = vscode.window.createTextEditorDecorationType({
		light: { gutterIconPath: icon('mapper-java-light.svg') },
		dark: { gutterIconPath: icon('mapper-java-dark.svg') },
		gutterIconSize: '85%',
	});

	const timers = new Map<string, NodeJS.Timeout>();
	const updateEditor = async (editor: vscode.TextEditor) => {
		const doc = editor.document;
		const ext = path.extname(doc.uri.path).toLowerCase();
		if (ext !== '.java' && ext !== '.xml') { return; }
		const version = doc.version;
		const marks = await resolveMapperLinks(doc).catch(() => []);
		if (editor.document !== doc || doc.version !== version) { return; }
		const xmlRanges: vscode.Range[] = [], javaRanges: vscode.Range[] = [];
		const seen = new Set<number>();
		for (const m of marks) {
			if (seen.has(m.line)) { continue; }
			seen.add(m.line);
			const r = new vscode.Range(m.line, 0, m.line, 0);
			(m.direction === 'xml' ? xmlRanges : javaRanges).push(r);
		}
		editor.setDecorations(toXmlDeco, xmlRanges);
		editor.setDecorations(toJavaDeco, javaRanges);
	};
	const scheduleEditor = (editor: vscode.TextEditor, delay = 250) => {
		const key = editor.document.uri.toString();
		clearTimeout(timers.get(key));
		if (delay === 0) {
			timers.delete(key);
			void updateEditor(editor);
			return;
		}
		timers.set(key, setTimeout(() => { timers.delete(key); void updateEditor(editor); }, delay));
	};
	const refreshVisible = (delay = 0) => {
		for (const editor of vscode.window.visibleTextEditors) {
			scheduleEditor(editor, delay);
		}
		lensChanged.fire();
	};
	refreshVisible(0);

	context.subscriptions.push(
		toXmlDeco, toJavaDeco, lensChanged,
		{ dispose: () => { timers.forEach(t => clearTimeout(t)); timers.clear(); } },
		vscode.commands.registerCommand(OPEN_CMD, async (uriStr: unknown, line: unknown, ch: unknown, endLine?: unknown, endCh?: unknown) => {
			if (typeof uriStr !== 'string' || typeof line !== 'number' || typeof ch !== 'number') { return; }
			const start = new vscode.Position(line, ch);
			const end = typeof endLine === 'number' && typeof endCh === 'number' ? new vscode.Position(endLine, endCh) : start;
			await vscode.window.showTextDocument(vscode.Uri.parse(uriStr), { selection: new vscode.Range(start, end) });
		}),
		vscode.languages.registerDefinitionProvider(selector, {
			provideDefinition: (doc, position) => mapperDefinitionLinks(doc, position),
		}),
		vscode.languages.registerHoverProvider(selector, {
			async provideHover(doc, position) {
				const links = await mapperDefinitionLinks(doc, position);
				const first = links?.[0];
				if (!first) { return undefined; }
				const isJava = path.extname(doc.uri.path).toLowerCase() === '.java';
				const targetFile = path.basename(first.targetUri.fsPath);
				const hit = isJava ? javaHitAt(doc.getText(), doc.offsetAt(position)) : xmlHitAt(doc.getText(), doc.offsetAt(position));
				const id = hit?.target.id;
				const args = encodeURIComponent(JSON.stringify(commandArgs(first.targetUri, first.targetSelectionRange ?? first.targetRange)));
				const label = id ? `\`${targetFile}\` · \`${id}\`` : `\`${targetFile}\``;
				const md = new vscode.MarkdownString(`${isJava ? 'MyBatis 매퍼 XML' : 'MyBatis Mapper'}: [${label}(으)로 이동](command:${OPEN_CMD}?${args}) (Ctrl+클릭)`);
				md.isTrusted = { enabledCommands: [OPEN_CMD] };
				return new vscode.Hover(md, first.originSelectionRange);
			},
		}),
		vscode.languages.registerCodeLensProvider(selector, {
			onDidChangeCodeLenses: lensChanged.event,
			async provideCodeLenses(doc) {
				const marks = await resolveMapperLinks(doc);
				if (!marks.length) { return []; }
				const seen = new Set<number>();
				const lenses: vscode.CodeLens[] = [];
				for (const m of marks) {
					if (seen.has(m.line)) { continue; }
					seen.add(m.line);
					const title = m.direction === 'xml' ? `$(arrow-right) ${m.targetFile}` : `$(arrow-left) ${m.targetFile}`;
					const tooltip = m.direction === 'xml'
						? `매퍼 XML로 이동: ${m.targetFile}${m.id ? ` · ${m.id}` : ''}`
						: `Mapper 인터페이스로 이동: ${m.targetFile}${m.id ? ` · ${m.id}` : ''}`;
					lenses.push(new vscode.CodeLens(new vscode.Range(m.line, m.ch, m.line, m.ch + m.length), {
						title, tooltip, command: OPEN_CMD, arguments: [...commandArgs(m.targetUri, m.targetRange)],
					}));
				}
				return lenses;
			},
		}),
		vscode.window.onDidChangeVisibleTextEditors(editors => editors.forEach(e => scheduleEditor(e, 0))),
		vscode.workspace.onDidChangeTextDocument(e => {
			const ext = path.extname(e.document.uri.path).toLowerCase();
			if (ext !== '.java' && ext !== '.xml') { return; }
			// 반대쪽 파일 편집(저장 전 dirty 포함)이 연결 탭·편집기 링크에 즉시 반영되도록 반대 확장자 캐시를 비운다
			const siblingExt = ext === '.xml' ? '.java' : '.xml';
			for (const key of [...resolvedCache.keys()]) {
				if (key.toLowerCase().endsWith(siblingExt)) { resolvedCache.delete(key); }
			}
			for (const editor of vscode.window.visibleTextEditors) {
				if (editor.document === e.document) { scheduleEditor(editor, 250); }
			}
		}),
		vscode.workspace.onDidSaveTextDocument(doc => {
			const ext = path.extname(doc.uri.path).toLowerCase();
			if (ext === '.java' || ext === '.xml') {
				if (ext === '.xml') { namespaces.delete(doc.uri.toString()); }
				resolvedCache.clear();
				refreshVisible(0);
			}
		}),
	);
}
