import type { ReactNode } from 'react';
import { clsx } from 'clsx';

/** 상황마다 기본 아이콘(Codicon): 검색 결과 없음·비어 있음·불러오는 중·문제 */
const ICONS = { search: 'search', empty: 'inbox', loading: 'loading', warning: 'warning' } as const;

/**
 * 보여 줄 내용이 없을 때의 안내: 아이콘 + 한 줄 문구(+ 보조 문구). 불러오는 중은 아이콘이 돈다.
 * compact: 목록 안 작은 구역(팔레트 즐겨찾기 등)은 아이콘과 문구를 한 줄로. icon: 기본 아이콘 대신 쓸 Codicon 이름
 */
export function EmptyState({ kind = 'empty', icon, compact, hint, children }: { kind?: keyof typeof ICONS; icon?: string; compact?: boolean; hint?: ReactNode; children: ReactNode }) {
	return (
		<div className={clsx('empty', `empty-${kind}`, { compact })} role={kind === 'loading' ? 'status' : undefined}>
			<span className={clsx('codicon', `codicon-${icon ?? ICONS[kind]}`, { 'codicon-modifier-spin': kind === 'loading' })} aria-hidden="true" />
			<span className="empty-text">{children}</span>
			{hint && <span className="empty-hint">{hint}</span>}
		</div>
	);
}
