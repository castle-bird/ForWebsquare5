// MyBatis 매퍼 XML 태그·속성 기본 자동완성 (공개된 mybatis-3-mapper DTD의 이름만). 확장이 프로젝트의 mybatis jar에서 DTD를 찾으면 그것을 쓰고(vscode/xmlSchema.ts), 못 찾을 때만 이 목록
import { completeFromSchema, type AttrSpec, type ElementSpec } from '@codemirror/lang-xml';

const BOOL = ['true', 'false'];
const choice = (name: string, values: string[]): AttrSpec => ({ name, values });
const STATEMENT_TYPE = choice('statementType', ['STATEMENT', 'PREPARED', 'CALLABLE']);
const DYNAMIC = ['include', 'trim', 'where', 'set', 'foreach', 'choose', 'if', 'bind'];
const STATEMENT = ['id', 'parameterType', 'parameterMap', 'timeout', 'databaseId', 'lang', choice('flushCache', BOOL), STATEMENT_TYPE];
const KEYS = ['keyProperty', 'keyColumn', choice('useGeneratedKeys', BOOL)];
const COLUMN = ['property', 'column', 'javaType', 'jdbcType', 'typeHandler'];
const NESTED = [...COLUMN, 'select', 'resultMap', 'columnPrefix', 'notNullColumn', 'resultSet', 'foreignColumn', choice('autoMapping', BOOL), choice('fetchType', ['lazy', 'eager'])];
const ARG = ['column', 'javaType', 'jdbcType', 'typeHandler', 'select', 'resultMap', 'name', 'columnPrefix'];
const RESULTS = ['constructor', 'id', 'result', 'association', 'collection', 'discriminator'];

const ELEMENTS: ElementSpec[] = [
	{ name: 'mapper', top: true, attributes: ['namespace'], children: ['cache-ref', 'cache', 'resultMap', 'parameterMap', 'sql', 'insert', 'update', 'delete', 'select'] },
	{ name: 'cache-ref', attributes: ['namespace'], children: [] },
	{ name: 'cache', attributes: ['type', 'eviction', 'flushInterval', 'size', choice('readOnly', BOOL), choice('blocking', BOOL)], children: ['property'] },
	{ name: 'property', attributes: ['name', 'value'], children: [] },
	{ name: 'resultMap', attributes: ['id', 'type', 'extends', choice('autoMapping', BOOL)], children: RESULTS },
	{ name: 'constructor', children: ['idArg', 'arg'] },
	{ name: 'idArg', attributes: ARG, children: [] },
	{ name: 'arg', attributes: ARG, children: [] },
	{ name: 'id', attributes: COLUMN, children: [] },
	{ name: 'result', attributes: COLUMN, children: [] },
	{ name: 'association', attributes: NESTED, children: RESULTS },
	{ name: 'collection', attributes: [...NESTED, 'ofType'], children: RESULTS },
	{ name: 'discriminator', attributes: ['column', 'javaType', 'jdbcType', 'typeHandler'], children: ['case'] },
	{ name: 'case', attributes: ['value', 'resultMap', 'resultType'], children: RESULTS },
	{ name: 'parameterMap', attributes: ['id', 'type'], children: ['parameter'] },
	{ name: 'parameter', attributes: ['property', 'javaType', 'jdbcType', 'resultMap', choice('mode', ['IN', 'OUT', 'INOUT']), 'scale', 'typeHandler'], children: [] },
	{ name: 'sql', attributes: ['id', 'lang', 'databaseId'], children: DYNAMIC },
	{ name: 'select', attributes: [...STATEMENT, 'resultType', 'resultMap', 'fetchSize', choice('useCache', BOOL), choice('resultOrdered', BOOL), 'resultSets',
		choice('resultSetType', ['FORWARD_ONLY', 'SCROLL_INSENSITIVE', 'SCROLL_SENSITIVE', 'DEFAULT'])], children: DYNAMIC },
	{ name: 'insert', attributes: [...STATEMENT, ...KEYS], children: ['selectKey', ...DYNAMIC] },
	{ name: 'update', attributes: [...STATEMENT, ...KEYS], children: ['selectKey', ...DYNAMIC] },
	{ name: 'delete', attributes: STATEMENT, children: DYNAMIC },
	{ name: 'selectKey', attributes: ['resultType', 'keyProperty', 'keyColumn', choice('order', ['BEFORE', 'AFTER']), STATEMENT_TYPE, 'databaseId'], children: DYNAMIC },
	{ name: 'include', attributes: ['refid'], children: ['property'] },
	{ name: 'bind', attributes: ['name', 'value'], children: [] },
	{ name: 'trim', attributes: ['prefix', 'prefixOverrides', 'suffix', 'suffixOverrides'], children: DYNAMIC },
	{ name: 'where', children: DYNAMIC },
	{ name: 'set', children: DYNAMIC },
	{ name: 'foreach', attributes: ['collection', 'item', 'index', 'open', 'close', 'separator', choice('nullable', BOOL)], children: DYNAMIC },
	{ name: 'choose', children: ['when', 'otherwise'] },
	{ name: 'when', attributes: ['test'], children: DYNAMIC },
	{ name: 'otherwise', children: DYNAMIC },
	{ name: 'if', attributes: ['test'], children: DYNAMIC },
];

export const mybatisCompletions = completeFromSchema(ELEMENTS, []);
