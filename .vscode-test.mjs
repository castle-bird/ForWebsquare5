import { defineConfig } from '@vscode/test-cli';
import { readdirSync } from 'node:fs';

export default defineConfig({
	files: readdirSync(new URL('./src/test/vscode/', import.meta.url)).filter(name => name.endsWith('.test.ts')).map(name => `out/test/vscode/${name.replace(/\.ts$/, '.js')}`),
});
