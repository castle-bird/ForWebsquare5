// Git blame(줄마다 마지막으로 고친 사람·시각): `git blame --porcelain` 출력을 줄별 표로 읽는다

/** 줄마다(0부터) 작성자 번호(authors의 자리, -1: 커밋 안 됨)와 시각(초) */
export interface Blame { authors: string[]; author: number[]; time: number[] }

const UNCOMMITTED = /^0{40}$/;

/** porcelain 출력: 줄마다 `<sha> <원래 줄> <지금 줄> [<묶음 줄 수>]` 머리, 그 커밋을 처음 볼 때만 author·author-time 등, 끝에 탭 + 내용 */
export function parseBlame(out: string): Blame {
	const commits = new Map<string, { author: string; time: number }>(), authors: string[] = [], author: number[] = [], time: number[] = [];
	let sha = '', line = 0;
	for (const row of out.split('\n')) {
		const head = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(row);
		if (head) {
			sha = head[1];
			line = Number(head[2]) - 1;
			if (!commits.has(sha)) { commits.set(sha, { author: '', time: 0 }); }
		} else if (row.startsWith('author ')) {
			commits.get(sha)!.author = row.slice('author '.length);
		} else if (row.startsWith('author-time ')) {
			commits.get(sha)!.time = Number(row.slice('author-time '.length));
		} else if (row.startsWith('\t')) {
			const c = commits.get(sha)!;
			let who = -1;
			if (!UNCOMMITTED.test(sha)) {
				who = authors.indexOf(c.author);
				if (who < 0) { who = authors.push(c.author) - 1; }
			}
			author[line] = who;
			time[line] = c.time;
		}
	}
	return { authors, author, time };
}

/** from번째 줄(0부터)부터 count줄만(화면 XML 안 Script 본문처럼 파일 일부를 보여 줄 때) */
export const sliceBlame = (b: Blame, from: number, count: number): Blame =>
	({ authors: b.authors, author: b.author.slice(from, from + count), time: b.time.slice(from, from + count) });

/** 문자열 offset이 몇 번째 줄인지(0부터, CRLF·CR·LF) */
export const lineOfOffset = (text: string, offset: number) => text.slice(0, offset).match(/\r\n?|\n/g)?.length ?? 0;
