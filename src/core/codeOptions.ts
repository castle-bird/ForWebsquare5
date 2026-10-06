// 코드 편집기(Script·Source·연결 탭) 공통 옵션: VS Code의 줄바꿈·합자 설정을 따르고, SQL 방언은 이 확장의 설정
export const SQL_DIALECTS = ['standard', 'oracle', 'mysql', 'mariadb', 'postgresql', 'mssql', 'sqlite'] as const;
export type SqlDialect = typeof SQL_DIALECTS[number];

/** 합자 끔·켬의 font-feature-settings(VS Code editor.fontLigatures와 같은 뜻) */
const LIGATURES_OFF = '"liga" off, "calt" off';
const LIGATURES_ON = '"liga" on, "calt" on';

/** fontFeatures: CSS font-feature-settings 값 */
export interface CodeOptions { wordWrap: boolean; sqlDialect: SqlDialect; fontFeatures: string }

export const DEFAULT_CODE_OPTIONS: CodeOptions = { wordWrap: false, sqlDialect: 'standard', fontFeatures: LIGATURES_OFF };

/** editor.wordWrap: off 말고(on·wordWrapColumn·bounded)는 창 너비에서 줄바꿈 */
export const readWordWrap = (value: unknown): boolean => typeof value === 'string' && value !== 'off';

/** editor.fontLigatures: true·false, 또는 font-feature-settings 글자("'ss01', 'ss02'"). 빈 글자·"false"는 끔 */
export const readFontLigatures = (value: unknown): string => {
	const text = typeof value === 'string' ? value.trim() : value;
	return text === true || text === 'true' ? LIGATURES_ON : typeof text === 'string' && text && text !== 'false' ? text : LIGATURES_OFF;
};

/** 설정값이 목록에 없으면 standard */
export const readSqlDialect = (value: unknown): SqlDialect => SQL_DIALECTS.find(d => d === value) ?? DEFAULT_CODE_OPTIONS.sqlDialect;
