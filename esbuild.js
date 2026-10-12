const esbuild = require("esbuild");
const fs = require('node:fs');
const path = require('node:path');
const cspPatchesPlugin = require('./scripts/csp-patches-plugin.cjs');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

let building = 0;

const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		// 번들이 여럿이라 모두 끝났을 때만 finished를 찍는다 (F5 preLaunchTask가 먼저 시작하지 않게)
		build.onStart(() => {
			if (building++ === 0) {
				console.log('[watch] build started');
			}
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			if (--building === 0) {
				console.log('[watch] build finished');
			}
		});
	},
};

const inlineCssPlugin = {
	name: 'inline-css',
	setup(build) {
		build.onLoad({ filter: /[/\\]canvas\.css$/ }, async (args) => {
			const text = await fs.promises.readFile(args.path, 'utf8');
			return { contents: text, loader: 'text' };
		});
	},
};

/**
 * htmlparser2·entities는 lib/esm/package.json({"type":"module"})이 상위의 sideEffects:false를 가려서
 * 웹뷰가 쓰지 않는 파서·엔티티 표(~80KB)가 번들에 남는다 → 부작용 없는 패키지로 표시
 */
const pureDepsPlugin = {
	name: 'pure-deps',
	setup(build) {
		build.onResolve({ filter: /^(htmlparser2|entities|domhandler|domutils|dom-serializer)$/ }, async (args) => {
			if (args.pluginData === 'pure-deps') {
				return undefined;
			}
			const result = await build.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: 'pure-deps' });
			return { ...result, sideEffects: false };
		});
	},
};

async function main() {
	const common = {
		bundle: true,
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
		metafile: production,
	};
	const contexts = await Promise.all([
		esbuild.context({
			...common,
			entryPoints: ['src/extension.ts'],
			format: 'cjs',
			platform: 'node',
			outfile: 'dist/extension.js',
			external: ['vscode'],
		}),
		esbuild.context({
			...common,
			plugins: [...common.plugins, inlineCssPlugin, pureDepsPlugin, cspPatchesPlugin],
			entryPoints: ['src/webview/main.tsx'],
			format: 'iife',
			platform: 'browser',
			jsx: 'automatic',
			loader: { '.ttf': 'file', '.svg': 'dataurl' },
			outfile: 'dist/webview.js',
		}),
	]);
	if (watch) {
		await Promise.all(contexts.map(ctx => ctx.watch()));
	} else {
		const results = await Promise.all(contexts.map(async ctx => {
			const result = await ctx.rebuild();
			await ctx.dispose();
			return result;
		}));
		if (production) {
			writeNotices(results.flatMap(r => Object.keys(r.metafile.inputs)));
		}
	}
}

function writeNotices(inputs) {
	const dirs = [...new Set(inputs.map(p => p.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean))];
	const sections = dirs.map(dir => {
		const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
		const texts = fs.readdirSync(dir).filter(f => /^licen[cs]e/i.test(f)).map(f => fs.readFileSync(path.join(dir, f), 'utf8').trim());
		return { key: `${pkg.name}@${pkg.version}`, text: `${pkg.name}@${pkg.version} (${pkg.license ?? 'license field 없음'})\n\n${texts.join('\n\n') || '(라이선스 파일 없음)'}` };
	}).sort((a, b) => a.key.localeCompare(b.key)).map(x => x.text);
	fs.writeFileSync(path.join('dist', 'THIRD-PARTY-NOTICES.txt'),
		`이 확장에 번들된 서드파티 소프트웨어와 라이선스 (${sections.length}개)\n\n` + sections.join(`\n\n${'-'.repeat(72)}\n\n`) + '\n');
	console.log(`[notices] ${sections.length} packages`);
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
