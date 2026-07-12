// src/lib/rates.format.test.js
// B6 — единый форматтер курса. Контракт точности (один порог на всё приложение):
//   ≥10 → 2 знака · ≥1 → 4 · <1 → 6. Тест фиксирует канон, чтобы разъезд ловился.

import { describe, expect, it } from "vitest";
import { formatRate } from "./rates.js";

describe("formatRate — единый порог точности (B6)", () => {
  it("≥10 → 2 знака", () => {
    expect(formatRate(44.9)).toBe("44.90");
    expect(formatRate(1234.5)).toBe("1234.50");
    expect(formatRate(10)).toBe("10.00");
  });
  it("1..9.99 → 4 знака", () => {
    expect(formatRate(1.167)).toBe("1.1670");
    expect(formatRate(1)).toBe("1.0000");
    expect(formatRate(9.9999)).toBe("9.9999");
  });
  it("<1 → 6 знаков", () => {
    expect(formatRate(0.0213)).toBe("0.021300");
    expect(formatRate(0)).toBe("0.000000");
  });
  it("невалид → тире", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatRate(undefined)).toBe("—");
    expect(formatRate(NaN)).toBe("—");
  });
});
