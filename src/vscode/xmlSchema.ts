// 연결한 XML의 DOCTYPE이 가리키는 DTD를 찾아 자동완성 스키마로. 찾는 곳: DTD 경로가 로컬 파일이면 그 파일,
// 아니면 이름이 같은 DTD를 작업 폴더의 *batis*.jar와 Maven 저장소(~/.m2)의 MyBatis·iBATIS jar 안에서(mybatis jar는 DTD를 품고 있다)
import { readdir, readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { unzipSync } from 'fflate';
import { doctypeOf, parseDtd } from '../core/dtd';
import type { XmlElementSpec } from '../core/protocol';
import { cached, exists, findDirs, numeric } from '../project/paths';

/** DTD 파일 이름 → 내용과 어디서 읽었는지(못 찾으면 undefined) */
const dtds = new Map<string, Promise<{ text: string; source: string } | undefined>>();

const MISS_TTL = 60_000;
const MAVEN_DIRS = [['org', 'mybatis'], ['org', 'apache', 'ibatis']];

async function jarCandidates(): Promise<string[]> {
	const inWorkspace = (await vscode.workspace.findFiles('**/*batis*.jar', undefined, 200)).map(u => u.fsPath);
	const maven: string[] = [];
	for (const parts of MAVEN_DIRS) {
		const root = path.join(os.homedir(), '.m2', 'repository', ...parts);
		if (await exists(root)) {
			for (const dir of await findDirs(root, (_dir, names) => names.some(n => n.endsWith('.jar')), 4)) {
				maven.push(dir);
			}
		}
	}
	// 높은 버전 먼저(경로에 버전이 들어 있다)
	const sorted = (list: string[]) => [...list].sort((a, b) => numeric(b, a));
	const mavenJars = (await Promise.all(sorted(maven).map(async dir =>
		(await readdir(dir).catch(() => [] as string[]))
			.filter(name => /batis.*\.jar$/i.test(name) && !/-(sources|javadoc)\.jar$/i.test(name)).map(name => path.join(dir, name))))).flat();
	return [...sorted(inWorkspace), ...mavenJars];
}

async function findDtd(name: string): Promise<{ text: string; source: string } | undefined> {
	for (const jar of await jarCandidates()) {
		try {
			const entries = unzipSync(await readFile(jar), { filter: f => f.name === name || f.name.endsWith(`/${name}`) });
			const [entry] = Object.values(entries);
			if (entry) {
				return { text: new TextDecoder().decode(entry), source: jar };
			}
		} catch {
			// 깨진 jar는 건너뛴다
		}
	}
	return undefined;
}

/** 연결한 XML(text, 경로 file)의 스키마. DOCTYPE이 없거나 DTD를 못 찾으면 undefined */
export async function xmlSchemaOf(file: string, text: string): Promise<{ elements: XmlElementSpec[]; source: string } | undefined> {
	const doctype = doctypeOf(text);
	if (!doctype) {
		return undefined;
	}
	let dtd: { text: string; source: string } | undefined;
	if (!/^[a-z]+:\/\//i.test(doctype.system)) {
		const local = path.resolve(path.dirname(file), doctype.system);
		dtd = await readFile(local, 'utf8').then(t => ({ text: t, source: local }), () => undefined);
	}
	const name = path.posix.basename(doctype.system.replace(/\\/g, '/'));
	dtd ??= await cached(dtds, name, async () => {
		const found = await findDtd(name);
		// 못 찾은 결과는 잠시만 기억한다(그사이 jar를 받았을 수 있다)
		if (!found) {
			setTimeout(() => dtds.delete(name), MISS_TTL);
		}
		return found;
	});
	const elements = dtd && parseDtd(dtd.text, doctype.root);
	return elements?.length ? { elements, source: dtd!.source } : undefined;
}
