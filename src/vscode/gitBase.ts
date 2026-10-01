// 변경 표시의 기준 내용: VS Code 내장 Git 확장 API로 스테이지(index)에 있는 파일 내용을 읽는다(VS Code 줄 옆 변경 표시와 같은 기준).
// Git 확장이 꺼져 있거나 저장소·추적 파일이 아니면 undefined(표시 없음)
import * as vscode from 'vscode';

// 내장 Git 확장 API 중 쓰는 부분만 (extensions/git/src/api/git.d.ts)
interface Repository {
	readonly state: { readonly onDidChange: vscode.Event<void> };
	show(ref: string, path: string): Promise<string>;
}
interface GitApi {
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
