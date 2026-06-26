import { describe, it, expect } from "vitest";
import { isPercentPair, rateToPercent, percentToRate, displayValue, toStoredRate, formatRateValue } from "./ratesFormat.js";

describe("ratesFormat", () => {
  it("isPercentPair: процент отключён — всё абсолютное", () => {
    expect(isPercentPair("USDT", "USD")).toBe(false);
    expect(isPercentPair("USD", "USDT")).toBe(false);
    expect(isPercentPair("USDT", "TRY")).toBe(false);
    expect(isPercentPair("EUR", "USDT")).toBe(false);
  });
  it("rateToPercent / percentToRate round-trip (для парса % при пасте)", () => {
    expect(rateToPercent(0.99)).toBeCloseTo(-1, 9);
    expect(rateToPercent(1.002)).toBeCloseTo(0.2, 9);
    expect(percentToRate(-1)).toBeCloseTo(0.99, 9);
    expect(percentToRate(0.2)).toBeCloseTo(1.002, 9);
  });
  it("formatRateValue: всё числом, реципрок к >1 (USD тоже курс, не процент)", () => {
    expect(formatRateValue("USDT", "TRY", 45.1)).toBe("45,10");
    expect(formatRateValue("USDT", "EUR", 1.177)).toBe("1,177");
    // USDT→USD 0,994 → читаемое 1/0,994 ≈ 1,006 (нормальный курс, не «−0,60 %»)
    expect(formatRateValue("USDT", "USD", 0.994)).toBe("1,006");
  });
  it("reciprocal display: stored <1 показываем как >1 (TRY→USDT)", () => {
    // stored 1/46 → читаемое 46,00
    expect(formatRateValue("TRY", "USDT", 1 / 46)).toBe("46,00");
    expect(displayValue("TRY", "USDT", 1 / 46)).toBeCloseTo(46, 6);
    expect(displayValue("USDT", "TRY", 45.1)).toBeCloseTo(45.1, 6);
  });
  it("toStoredRate: реципрок при текущем stored <1, иначе как есть", () => {
    // редактируем TRY→USDT, ввели 48, текущий stored 1/46 (<1) → store 1/48
    expect(toStoredRate("TRY", "USDT", 48, 1 / 46)).toBeCloseTo(1 / 48, 9);
    // USDT→TRY ввели 47, текущий 45 (≥1) → store 47
    expect(toStoredRate("USDT", "TRY", 47, 45)).toBeCloseTo(47, 9);
  });
});
