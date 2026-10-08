# 테스트 실행

작은 변경에는 관련 파일만 실행한다. UI 조작을 브라우저 없는 단위 테스트로 부르지는 않는다.

| 목적 | 명령 |
| --- | --- |
| 단위 테스트 전체 (기본) | `npm test` 또는 `npm run test:unit` |
| 특정 로직만 | `npm test -- outlineDrop` / `npm test -- edit grid` |
| 단위 테스트 파일 목록 | `npm test -- --list` |
| Design 조작만 | `npm run test:editors -- design` |
| 캔버스 드래그·팔레트만 | `npm run test:editors -- palette` |
| Outline 이동만 | `npm run test:editors -- outline` |
| 여러 웹뷰 기능 | `npm run test:editors -- grid-edit property` |
| 웹뷰 묶음 목록 | `npm run test:editors -- --list` |
| 웹뷰 전체 회귀 | `npm run test:editors` |
| VS Code 통합 | `npm run test:vscode` (필요 시 `-- --code-version 1.125.0`) |
| 타입·lint | `npm run check-types` / `npm run lint` |
| 선택 실행기 자체 검사 | `node --test scripts/test-selection.test.mjs` |

단위: `src/test/*.test.ts`. esbuild가 선택한 파일과 의존 코드만 `out/test`에 만들고 Node Mocha로 실행한다. Chrome·VS Code를 띄우거나 확장 전체를 tsc로 컴파일하지 않는다. 타입 검사는 별도다. 이름 오타나 없는 파일은 실패하며, 전체 실행으로 바꾸지 않는다.

웹뷰: `scripts/editors/*.test.mjs`. 번들·브라우저는 실행당 한 번 준비하고 각 파일은 새 브라우저 context/page에서 시작한다. 파일끼리 문서·선택·접힘·클립보드·코드 버전을 공유하지 않는다. 파일 안의 연속 조작은 하나의 시나리오다. CSP·에러 수집과 실제 마우스/키보드 검증을 유지한다. Chrome/Edge가 필요하며 `CHROME_PATH`로 지정할 수 있다.

웹뷰 묶음: badges, data, data-tree, design, editor-basic, editor-state, erd, git, grid-dialogs, grid-edit, info, links, outline, palette, property, script-navigation, script-tools, themes.

VS Code 통합: `src/test/vscode/*.test.ts`. 기존 컴파일·번들 빌드 후 테스트 호스트를 실행한다. `npm test`의 의미가 순수 단위 테스트로 바뀌었으므로 배포 전에는 이 명령을 별도로 실행한다.

공통 하네스·테스트 구조 변경에는 전체 회귀를 확인한다. 기능 하나의 수정에는 관련 단위/웹뷰 묶음부터 실행하고, 실패하거나 영향 범위가 넓을 때만 확장한다.
