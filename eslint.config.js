// eslint.config.js — flat config (ESLint 9). Bug-focused, не стиль-полиция.
// Философия: ловим РЕАЛЬНЫЕ баги (error), шум/стиль — warn (не валит CI).
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "node_modules/**", "coverage/**", "*.config.js"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // ── Реальные баги → error (валит CI) ──
      "no-const-assign": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "no-cond-assign": ["error", "always"],
      "no-self-assign": "error",
      "no-unsafe-negation": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      "react-hooks/rules-of-hooks": "error",
      // ── Шум/стиль/намеренные паттерны → warn (не валит CI, но видно) ──
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-undef": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "no-useless-escape": "warn", // косметика (напр. \- в char-class)
      "no-irregular-whitespace": "warn", // часто nbsp в строках — не баг
      "no-constant-binary-expression": "warn", // {false && …} — намеренное отключение блока
    },
  },
];
