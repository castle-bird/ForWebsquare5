// 연결 탭의 파일 편집기: 확장자에 맞는 언어 지원을 붙인 CodeEditor(ui/linkedFile.tsx가 연결된 탭을 열 때 불러온다)
import { useMemo } from 'react';
import { linkTarget } from '../../core/links';
import { CodeEditor } from '../editor/codeEditor';
import { linkLanguage } from '../editor/linkLanguages';
import { post, useEditorStore } from '../store';

export default function LinkedEditor({ kind, path, text, version }: { kind: string; path: string; text: string; version: number }) {
	const schema = useEditorStore(s => s.xmlSchemas[kind]);
	const dialect = useEditorStore(s => s.codeOptions.sqlDialect);
	const language = useMemo(() => linkLanguage(path, schema, dialect), [path, schema, dialect]);
	return <CodeEditor target={linkTarget(kind)} {...language} remote autoImport={/\.java$/i.test(path)} text={text} version={version} post={post} />;
}
