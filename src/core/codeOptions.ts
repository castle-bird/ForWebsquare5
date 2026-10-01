// 코드 편집기(Script·Source·연결 탭) 공통 옵션: VS Code의 줄바꿈 설정을 따르고, SQL 방언은 이 확장의 설정
export const SQL_DIALECTS = ['standard', 'oracle', 'mysql', 'mariadb', 'postgresql', 'mssql', 'sqlite'] as const;
export type SqlDialect = typeof SQL_DIALECTS[number];

export interface CodeOptions { wordWrap: boolean; sqlDialect: SqlDialect }

export const DEFAULT_CODE_OPTIONS: CodeOptions = { wordWrap: false, sqlDialect: 'standard' };

/** editor.wordWrap: off 말고(on·wordWrapColumn·bounded)는 창 너비에서 줄바꿈 */
export const readWordWrap = (value: unknown): boolean => typeof value === 'string' && value !== 'off';

/** 설정값이 목록에 없으면 standard */
export const readSqlDialect = (value: unknown): SqlDialect => SQL_DIALECTS.find(d => d === value) ?? DEFAULT_CODE_OPTIONS.sqlDialect;
