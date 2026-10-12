// 변경 표시의 기준 내용: VS Code 내장 Git 확장 API로 스테이지(index)에 있는 파일 내용을 읽는다(VS Code 줄 옆 변경 표시와 같은 기준).
// blame도 같은 확장이 쓰는 git으로 구한다. Git 확장이 꺼져 있거나 저장소·추적 파일이 아니면 undefined(표시 없음)
import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseBlame, type Blame } from '../core/blame';

// 내장 Git 확장 API 중 쓰는 부분만 (extensions/git/src/api/git.d.ts)
interface Repository {
	readonly rootUri: vscode.Uri;
	readonly state: { readonly onDidChange: vscode.Event<void> };
	show(ref: string, path: string): Promise<string>;
}
interface GitApi {
	/** git 실행 파일(Git 확장이 찾은 것, git.path 설정 포함) */
	readonly git: { readonly path: string };
	readonly repositories: Repository[];
	readonly onDidOpenRepository: vscode.Event<Repository>;
	getRepository(uri: vscode.Uri): Repository | null;
}
interface GitExtension {
	readonly enabled: boolean;
	getAPI(version: 1): GitApi;
}

let api: Promise<GitApi | undefined> | undefined;

function gitApi(): Promise<GitApi | undefined> {
	api ??= (async () => {
		try {
			const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
			const git = ext && (ext.isActive ? ext.exports : await ext.activate());
			return git?.enabled ? git.getAPI(1) : undefined;
		} catch {
			return undefined;
		}
	})();
	return api;
}

/** 스테이지에 있는 내용(`git show :path`). 인코딩은 Git 확장이 files.encoding대로 푼다 */
export async function stagedText(uri: vscode.Uri): Promise<string | undefined> {
	const repo = uri.scheme === 'file' ? (await gitApi())?.getRepository(uri) : undefined;
	try {
		return repo ? await repo.show('', uri.fsPath) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * 줄마다 마지막으로 고친 사람·시각. text(저장 안 한 지금 내용)를 넘겨 `git blame --contents -`로 구하므로 편집 중에도 줄이 맞는다
 * (새로 쓴 줄은 커밋 안 됨). 커밋된 적 없는 파일·Git 밖이면 undefined
 */
export async function blameText(uri: vscode.Uri, text: string): Promise<Blame | undefined> {
	const git = uri.scheme === 'file' ? await gitApi() : undefined, repo = git?.getRepository(uri);
	if (!git || !repo) { return undefined; }
	const root = repo.rootUri.fsPath, file = path.relative(root, uri.fsPath).split(path.sep).join('/');
	const out = await new Promise<string | undefined>(resolve => {
		const child = spawn(git.git.path, ['-c', 'i18n.logOutputEncoding=UTF-8', 'blame', '--porcelain', '--contents', '-', '--', file], { cwd: root, windowsHide: true });
		const chunks: Buffer[] = [];
		child.stdout.on('data', (c: Buffer) => chunks.push(c));
		child.on('error', () => resolve(undefined));
		child.on('close', code => resolve(code === 0 ? Buffer.concat(chunks).toString('utf8') : undefined));
		child.stdin.on('error', () => undefined);
		child.stdin.end(text, 'utf8');
	});
	return out === undefined ? undefined : parseBlame(out);
}

/** 저장소 상태(스테이지·커밋·체크아웃·파일 상태)가 바뀔 때. 자주 불리니 받는 쪽에서 모은다 */
export function onGitChange(listener: () => void): vscode.Disposable {
	const subs: vscode.Disposable[] = [];
	let disposed = false;
	void gitApi().then(git => {
		if (!git || disposed) {
			return;
		}
		const watch = (repo: Repository) => subs.push(repo.state.onDidChange(listener));
		git.repositories.forEach(watch);
		subs.push(git.onDidOpenRepository(repo => {
			watch(repo);
			listener();
		}));
	});
	return new vscode.Disposable(() => {
		disposed = true;
		subs.forEach(s => s.dispose());
	});
}

/**
 * 한 문서의 blame 보내기를 모아 돌린다: schedule은 입력이 멈춘 뒤(delay) 한 번, 돌고 있는 중에 또 불리면 끝난 뒤 한 번 더.
 * git blame은 파일 이력만큼 걸릴 수 있어(긴 이력이면 수백 ms 이상) 입력마다 돌리지 않는다
 */
export function blameFeed(job: () => Promise<void>, delay = 1000) {
	let timer: NodeJS.Timeout | undefined, running = false, again = false;
	const run = async (): Promise<void> => {
		if (running) { again = true; return; }
		running = true;
		try { await job(); } catch { /* 표시만 안 함 */ } finally {
			running = false;
			if (again) { again = false; void run(); }
		}
	};
	return {
		schedule(ms = delay) { clearTimeout(timer); timer = setTimeout(() => void run(), ms); },
		dispose() { clearTimeout(timer); },
	};
}
