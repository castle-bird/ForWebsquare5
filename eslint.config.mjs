import typescriptEslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

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
}, {
    files: ["src/webview/**/*.tsx", "src/webview/**/*.ts"],
    plugins: {
        "react-hooks": reactHooks,
    },
    rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "error",
    },
}];
