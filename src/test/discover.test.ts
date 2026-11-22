import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findInstalls } from '../project/discover';

suite('설치본 탐색 최적화', () => {
	const mkdir = (...parts: string[]) => fs.mkdirSync(path.join(...parts), { recursive: true });

	test('같은 depth에서 힌트 폴더(eclipse/websquare)가 후순위 폴더(Users/Program Files)보다 먼저 방문된다', async () => {
		const drive = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-prio-'));
		try {
			// depth 1: Users, Program Files(후순위) vs websquare(힌트)
			// depth 2: websquare/eclipse(힌트) vs Users/u01..u20, Program Files/p01..p20(일반)
			// depth 3: 각각 plugins
			mkdir(drive, 'websquare', 'eclipse', 'plugins', 'com.inswave.websquare.hint');
			for (let i = 1; i <= 20; i++) {
				mkdir(drive, 'Users', `u${i}`, 'plugins', `com.inswave.users.${i}`);
				mkdir(drive, 'Program Files', `p${i}`, 'plugins', `com.inswave.pf.${i}`);
			}

			// depth 0(1) + depth 1(3) + depth 2에서 websquare/eclipse 포함 앞부분만 보고 중단되도록 제한
			let checks = 0;
			const { installs, complete } = await findInstalls([drive], {
				cancelled: () => ++checks > 10,
			});
			assert.strictEqual(complete, false);
			// depth 2까지 완료되지 못해 depth 3으로 못 내려갔으므로, depth 1~2에서 중단 여부 대신
			// depth 2에서 힌트 폴더가 먼저 처리되어 depth 3 진입 직전까지 도달하는지 확인
			assert.deepStrictEqual(installs, []);

			// 이번에는 depth 2의 힌트 폴더가 먼저 방문되어 depth 3에서 가장 먼저 발견되는지 확인
			// depth 2에 힌트 1개 + 후순위/일반 다수를 두고, depth 3의 첫 1개만 보고 중단
			const drive2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-prio2-'));
			try {
				mkdir(drive2, 'Users', 'docs', 'plugins', 'com.inswave.slow');
				mkdir(drive2, 'Program Files', 'app', 'plugins', 'com.inswave.slow2');
				mkdir(drive2, 'websquare', 'plugins', 'com.inswave.fast');
				// depth 2에서 Users/docs와 Program Files/app의 하위 대신 다른 후순위 폴더를 많이 두어
				// depth 2의 websquare/plugins가 index 0으로 가장 먼저 처리됨을 검증
				mkdir(drive2, 'Users', 'Desktop');
				for (let i = 1; i <= 20; i++) {
					mkdir(drive2, 'Program Files', `folder${i}`);
				}
				let count = 0;
				const res = await findInstalls([drive2], {
					cancelled: () => ++count > 6,
				});
				assert.strictEqual(res.complete, false);
				assert.ok(res.installs.includes(path.join(drive2, 'websquare')), '힌트 폴더 아래 설치본이 먼저 발견되어야 함');
			} finally {
				fs.rmSync(drive2, { recursive: true, force: true });
			}
		} finally {
			fs.rmSync(drive, { recursive: true, force: true });
		}
	});

	test('설치본을 찾은 뒤 그 설치본의 형제 폴더(p2, features, jre 등) 하위 탐색을 건너뛴다', async () => {
		const drive = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-prune-'));
		try {
			mkdir(drive, 'eclipse', 'plugins', 'com.inswave.websquare.a');
			// 이미 찾은 설치본 루트(eclipse) 아래 형제 폴더들 내부에 가짜 plugins 배치
			mkdir(drive, 'eclipse', 'p2', 'org.eclipse.equinox.p2', 'plugins', 'com.inswave.fake.p2');
			mkdir(drive, 'eclipse', 'features', 'com.inswave.feat', 'plugins', 'com.inswave.fake.features');
			mkdir(drive, 'eclipse', 'jre', 'lib', 'plugins', 'com.inswave.fake.jre');
			mkdir(drive, 'eclipse', 'configuration', 'org.eclipse.osgi', 'plugins', 'com.inswave.fake.cfg');
			mkdir(drive, 'eclipse', 'dropins', 'sub', 'plugins', 'com.inswave.fake.dropins');

			const { installs, complete } = await findInstalls([drive]);
			assert.strictEqual(complete, true);
			assert.deepStrictEqual(installs, [path.join(drive, 'eclipse')]);
		} finally {
			fs.rmSync(drive, { recursive: true, force: true });
		}
	});

	test('추가된 SKIP 폴더(dist, out, coverage 등)는 건너뛰고 bin은 건너뛰지 않는다', async () => {
		const drive = fs.mkdtempSync(path.join(os.tmpdir(), 'ws5-skip-'));
		try {
			mkdir(drive, 'WS5_PACK', 'bin', 'studio', 'plugins', 'com.inswave.websquare.bin');
			for (const skip of ['dist', 'out', 'coverage', 'vendor', 'packages', '__pycache__', 'venv', '$sysreset', 'inetpub', 'intel', 'amd', 'nvidia']) {
				mkdir(drive, skip, 'eclipse', 'plugins', `com.inswave.skip.${skip}`);
			}
			const { installs, complete } = await findInstalls([drive]);
			assert.strictEqual(complete, true);
			assert.deepStrictEqual(installs, [path.join(drive, 'WS5_PACK', 'bin', 'studio')]);
		} finally {
			fs.rmSync(drive, { recursive: true, force: true });
		}
	});
});
