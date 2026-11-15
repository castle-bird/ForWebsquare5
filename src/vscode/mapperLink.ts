// Mapper 인터페이스 ↔ MyBatis 매퍼 XML 정의로 이동(Ctrl+클릭·F12). Java·MyBatis 확장 없이 작업 폴더 파일 글자에서 찾는다
import * as path from 'node:path';
import * as vscode from 'vscode';
import { javaPlace, javaTargetAt, parseJavaMapper, parseXmlMapper, xmlPlace, xmlTargetAt, type MapperTarget, type Named } from '../core/mapperLink';

/** 빌드 산출물·의존성 폴더는 찾지 않는다 */
const EXCLUDE = '{**/target/**,**/build/**,**/bin/**,**/out/**,**/node_modules/**,**/.git/**}';
const MAX_FILES = 20000;

/** 파일마다 읽은 매퍼 XML namespace(수정 시각이 같으면 다시 읽지 않는다). 매퍼가 아니면 '' */
const namespaces = new Map<string, { mtime: number; namespace: string }>();

async function namespaceOf(uri: vscode.Uri): Promise<string> {
	const { mtime } = await vscode.workspace.fs.stat(uri);
	const hit = namespaces.get(uri.toString());
	if (hit?.mtime === mtime) { return hit.namespace; }
	const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	const namespace = text.includes('<mapper') ? parseXmlMapper(text)?.namespace.name ?? '' : '';
	namespaces.set(uri.toString(), { mtime, namespace });
	return namespace;
}

const scope = (doc: vscode.TextDocument, glob: string) => {
	const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
	return folder ? new vscode.RelativePattern(folder, glob) : glob;
};

/** 영문·숫자만 소문자로: UserMapper·user_mapper·user-mapper.xml 비교용 */
const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** namespace가 fqcn인 매퍼 XML. 이름이 인터페이스와 닮은 파일을 먼저 읽고, 없을 때만 나머지를 읽는다 */
async function mapperXmls(doc: vscode.TextDocument, fqcn: string): Promise<vscode.Uri[]> {
	const files = await vscode.workspace.findFiles(scope(doc, '**/*.xml'), EXCLUDE, MAX_FILES);
	const stem = plain(fqcn.slice(fqcn.lastIndexOf('.') + 1).replace(/(Mapper|Dao|Repository)$/, ''));
	const near = files.filter(uri => plain(path.basename(uri.fsPath, '.xml')).includes(stem));
	const matching = async (list: vscode.Uri[]) => (await Promise.all(list.map(async uri => await namespaceOf(uri).catch(() => '') === fqcn ? uri : undefined)))
		.filter(uri => uri !== undefined);
	const first = await matching(near);
	return first.length ? first : matching(files.filter(uri => !near.includes(uri)));
}

/** 패키지까지 같은 Mapper 인터페이스 파일 */
async function mapperJavas(doc: vscode.TextDocument, fqcn: string): Promise<vscode.Uri[]> {
	const name = fqcn.slice(fqcn.lastIndexOf('.') + 1);
	const files = await vscode.workspace.findFiles(scope(doc, `**/${name}.java`), EXCLUDE, MAX_FILES);
	const found = await Promise.all(files.map(async uri => {
		const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
		return parseJavaMapper(text)?.fqcn === fqcn ? uri : undefined;
	}));
	return found.filter(uri => uri !== undefined);
}

/** 열린 문서(저장 안 한 편집 포함)에서 이름 자리를 다시 찾는다 */
async function located(uris: vscode.Uri[], place: (text: string) => Named | undefined): Promise<vscode.Location[]> {
	const found = await Promise.all(uris.map(async uri => {
		const doc = await vscode.workspace.openTextDocument(uri);
		const at = place(doc.getText());
		return at && new vscode.Location(uri, new vscode.Range(doc.positionAt(at.at), doc.positionAt(at.at + at.name.length)));
	}));
	return found.filter(l => l !== undefined);
}

/** Mapper 메서드·인터페이스 이름 → 매퍼 XML의 문 id·namespace, 그 반대. 해당 자리가 아니거나 못 찾으면 undefined */
export async function mapperDefinition(doc: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[] | undefined> {
	const text = doc.getText(), offset = doc.offsetAt(position);
	const ext = path.extname(doc.uri.path).toLowerCase();
	let found: vscode.Location[];
	if (ext === '.java') {
		const target: MapperTarget | undefined = javaTargetAt(text, offset);
		if (!target) { return undefined; }
		found = await located(await mapperXmls(doc, target.fqcn), xml => { const m = parseXmlMapper(xml); return m && xmlPlace(m, target.id); });
	} else if (ext === '.xml') {
		const target = text.includes('<mapper') ? xmlTargetAt(text, offset) : undefined;
		if (!target) { return undefined; }
		found = await located(await mapperJavas(doc, target.fqcn), java => { const m = parseJavaMapper(java); return m && javaPlace(m, target.id); });
	} else {
		return undefined;
	}
	return found.length ? found : undefined;
}

/** VS Code 편집기에서도 같은 이동. 연결 탭은 links.ts가 직접 먼저 묻는다 */
export function registerMapperLink(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.languages.registerDefinitionProvider([{ language: 'java' }, { language: 'xml' }], {
		provideDefinition: (doc, position) => mapperDefinition(doc, position),
	}));
}
