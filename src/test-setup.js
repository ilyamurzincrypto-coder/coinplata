// src/test-setup.js
// Global test setup — runs before each test file.

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Auto-cleanup DOM между tests — иначе элементы накапливаются и
// getByRole() падает на multiple matches.
afterEach(() => cleanup());

// jsdom не имеет crypto.randomUUID до Node 20+ — polyfill для тестов
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = {};
}
if (typeof globalThis.crypto.randomUUID !== "function") {
  let _i = 0;
  globalThis.crypto.randomUUID = () =>
    `00000000-0000-4000-8000-${String(++_i).padStart(12, "0")}`;
}

// localStorage mock fallback (jsdom уже имеет, но safety)
if (typeof globalThis.localStorage === "undefined") {
  let _store = {};
  globalThis.localStorage = {
    getItem: (k) => _store[k] ?? null,
    setItem: (k, v) => { _store[k] = String(v); },
    removeItem: (k) => { delete _store[k]; },
    clear: () => { _store = {}; },
  };
}
