// VS Code·Chrome·확장 전체 tsc 없이 선택한 단위 테스트와 그 의존 코드만 빌드한다.
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import Mocha from 'mocha';
import { selectTests } from './test-selection.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const available = (await readdir(new URL('../src/test/', import.meta.url))).filter(name => name.endsWith('.test.ts')).map(name => name.slice(0, -8)).sort();
const { names, list } = selectTests(process.argv.slice(2), available);
if (list) {
	console.log(names.join('\n'));
} else {
	const start = performance.now();
	await build({
		absWorkingDir: root, entryPoints: names.map(name => `src/test/${name}.test.ts`), outdir: 'out/test',
		bundle: true, platform: 'node', format: 'cjs', packages: 'external', sourcemap: 'inline',
	});
	const mocha = new Mocha({ ui: 'tdd' });
	for (const name of names) { mocha.addFile(fileURLToPath(new URL(`../out/test/${name}.test.js`, import.meta.url))); }
	await mocha.loadFilesAsync();
	process.exitCode = await new Promise(resolve => mocha.run(resolve)) ? 1 : 0;
	console.log(`단위 ${names.length}개 파일: ${((performance.now() - start) / 1000).toFixed(2)}s`);
}
