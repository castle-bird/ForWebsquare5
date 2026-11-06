import typescriptEslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/** 폴더별 금지 import: vscode 모듈, 다른 계층 폴더(상대 경로), node: 내장 모듈 */
function layers(rules) {
    return Object.entries(rules).map(([files, { vscode, dirs, node, why }]) => ({
        files: [files],
        rules: {
            "no-restricted-imports": ["error", {
                paths: vscode ? [{ name: "vscode", message: why }] : [],
                patterns: [
                    { regex: `^(\\.\\./)+(${dirs.join("|")})/`, message: why },
                    ...node ? [{ regex: "^node:", message: why }] : [],
                ],
            }],
        },
    }));
}

export default [{
    files: ["**/*.ts", "**/*.tsx"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
        // 타입 정보가 필요한 규칙용: 파일마다 가까운 tsconfig(확장 / src/webview)를 쓴다
        parserOptions: {
            projectService: true,
            tsconfigRootDir: import.meta.dirname,
        },
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",

        // 기다리지 않은 Promise: 실패가 조용히 사라지거나 순서가 꼬인다. 일부러 안 기다리면 void
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/no-misused-promises": "error",
    },
}, ...layers({
    // 계층 의존 방향(docs/analyze.md 계층과 진입점): 상위 통합 계층 → 공통 규칙
    "src/core/**": { vscode: true, dirs: ["vscode", "project", "webview"], node: true, why: "core는 VS Code·UI·설치본 읽기에 의존하지 않는 공통 규칙이다" },
    "src/project/**": { vscode: true, dirs: ["vscode", "webview"], why: "project는 VS Code API 없이 설치본·프로젝트 파일만 읽는다" },
    "src/vscode/**": { dirs: ["webview"], why: "확장 호스트는 웹뷰 코드를 불러오지 않는다" },
    "src/webview/**": { vscode: true, dirs: ["vscode", "project"], node: true, why: "웹뷰는 브라우저 번들이라 확장 호스트 코드를 불러오지 않는다" },
}), {
    files: ["src/webview/**/*.tsx", "src/webview/**/*.ts"],
    plugins: {
        "react-hooks": reactHooks,
    },
    rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "error",
    },
}];
