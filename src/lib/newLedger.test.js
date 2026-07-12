// src/lib/newLedger.test.js
// Unit-тесты для helpers — canonicalJson, requestHash, newIdempotencyKey.
//
// Запуск: npm run test
//
// Тесты не требуют jsdom — node-environment с globalThis.crypto (Node 19+).

import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  requestHash,
  newIdempotencyKey,
  idempotencyKeyForAttempt,
  clearDealAttempt,
} from "./newLedger.js";

describe("canonicalJson", () => {
  it("primitives", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(undefined)).toBe("null");
    expect(canonicalJson(0)).toBe("0");
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson(-1.5)).toBe("-1.5");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(false)).toBe("false");
    expect(canonicalJson("hello")).toBe('"hello"');
  });

  it("arrays", () => {
    expect(canonicalJson([])).toBe("[]");
    expect(canonicalJson([1, 2, 3])).toBe("[1,2,3]");
    expect(canonicalJson(["a", "b"])).toBe('["a","b"]');
  });

  it("object — keys are sorted alphabetically", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson({ z: 1, a: 1, m: 1 })).toBe('{"a":1,"m":1,"z":1}');
  });

  it("object — undefined keys are omitted", () => {
    expect(canonicalJson({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it("nested — deterministic regardless of insertion order", () => {
    const a = { client: "X", legs: [{ amount: 100, currency: "USDT" }, { amount: 200, currency: "TRY" }] };
    const b = { legs: [{ currency: "USDT", amount: 100 }, { currency: "TRY", amount: 200 }], client: "X" };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("array order is preserved", () => {
    // Массивы НЕ сортируются — порядок legs важен
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it("strings with special chars", () => {
    expect(canonicalJson('a"b')).toBe('"a\\"b"');
    expect(canonicalJson("a\nb")).toBe('"a\\nb"');
  });
});

describe("requestHash", () => {
  it("deterministic — same input → same hash", async () => {
    const payload = { client_id: "abc", amount: 1000, currency: "USDT" };
    const h1 = await requestHash(payload);
    const h2 = await requestHash(payload);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("key-order independent", async () => {
    const a = { amount: 1000, client_id: "abc", currency: "USDT" };
    const b = { client_id: "abc", currency: "USDT", amount: 1000 };
    expect(await requestHash(a)).toBe(await requestHash(b));
  });

  it("different payload → different hash", async () => {
    const h1 = await requestHash({ x: 1 });
    const h2 = await requestHash({ x: 2 });
    expect(h1).not.toBe(h2);
  });

  it("nested payload", async () => {
    const payload = {
      clientId: "X",
      inLegs: [{ currency: "USDT", amount: 1000, source: "fresh", accountCode: "1316" }],
      outLegs: [{ currency: "TRY", amount: 33000, destination: "physical", accountCode: "1112" }],
      commission: [{ currency: "TRY", amount: 330, kind: "commission" }],
    };
    const h = await requestHash(payload);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // Перестроим с другим порядком ключей
    const reordered = {
      commission: payload.commission,
      outLegs: payload.outLegs,
      inLegs: payload.inLegs,
      clientId: payload.clientId,
    };
    expect(await requestHash(reordered)).toBe(h);
  });
});

describe("newIdempotencyKey", () => {
  it("returns valid UUID v4 format", () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("each call returns a different key", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
  });

  it("100 calls produce 100 distinct keys", () => {
    const keys = new Set();
    for (let i = 0; i < 100; i++) keys.add(newIdempotencyKey());
    expect(keys.size).toBe(100);
  });
});

// B1 — идемпотентность создания сделки. Доказывает: ретрай того же payload
// переиспользует ключ (сервер дедупит → нет дубля сделки), а после успеха
// легитимный повтор получает новый ключ.
describe("idempotencyKeyForAttempt / clearDealAttempt (B1)", () => {
  it("ретрай того же payload (той же hash) → ТОТ ЖЕ ключ", () => {
    clearDealAttempt();
    const k1 = idempotencyKeyForAttempt("HASH_A");
    const k2 = idempotencyKeyForAttempt("HASH_A"); // «ответ потерялся → повтор»
    expect(k2).toBe(k1);
  });

  it("другой payload (другая hash) → ДРУГОЙ ключ", () => {
    clearDealAttempt();
    const kA = idempotencyKeyForAttempt("HASH_A");
    const kB = idempotencyKeyForAttempt("HASH_B");
    expect(kB).not.toBe(kA);
  });

  it("несколько payload-ов в полёте не путают ключи", () => {
    clearDealAttempt();
    const kA1 = idempotencyKeyForAttempt("HASH_A");
    const kB1 = idempotencyKeyForAttempt("HASH_B");
    expect(idempotencyKeyForAttempt("HASH_A")).toBe(kA1);
    expect(idempotencyKeyForAttempt("HASH_B")).toBe(kB1);
  });

  it("после успеха (clear) тот же payload → НОВЫЙ ключ (легитимный повтор)", () => {
    clearDealAttempt();
    const k1 = idempotencyKeyForAttempt("HASH_A");
    clearDealAttempt("HASH_A"); // успех сделки
    const k2 = idempotencyKeyForAttempt("HASH_A");
    expect(k2).not.toBe(k1);
  });

  it("clear только своей hash — другие в полёте остаются", () => {
    clearDealAttempt();
    const kA = idempotencyKeyForAttempt("HASH_A");
    const kB = idempotencyKeyForAttempt("HASH_B");
    clearDealAttempt("HASH_A");
    expect(idempotencyKeyForAttempt("HASH_B")).toBe(kB); // B не сброшен
    expect(idempotencyKeyForAttempt("HASH_A")).not.toBe(kA); // A сброшен → новый
  });

  it("персистит ключ в sessionStorage → переживает reload (F5)", () => {
    const store = {};
    globalThis.sessionStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
    try {
      clearDealAttempt();
      const k = idempotencyKeyForAttempt("HASH_RELOAD");
      // На reload модуль перечитал бы sessionStorage → тот же ключ.
      const persisted = JSON.parse(store["deal_idem_attempts_v1"]);
      expect(persisted["HASH_RELOAD"]).toBe(k);
    } finally {
      delete globalThis.sessionStorage;
    }
  });
});
