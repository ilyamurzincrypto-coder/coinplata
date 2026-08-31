import { describe, it, expect } from "vitest";
import { isPercentPair, rateToPercent, percentToRate, displayValue, toStoredRate, formatRateValue, formatCrossValue } from "./ratesFormat.js";

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

describe("formatCrossValue — точность растёт к мелким числам", () => {
  it("порог знаков зависит от величины", () => {
    expect(formatCrossValue(140.5)).toBe("140,5");     // ≥100 → 2 знака
    expect(formatCrossValue(93.2823)).toBe("93,282");  // ≥10  → 3
    expect(formatCrossValue(80.6122)).toBe("80,612");
  });
  it("около единицы — четыре", () => {
    expect(formatCrossValue(1.1333)).toBe("1,1333");
    expect(formatCrossValue(0.8427)).toBe("0,8427");
  });
  it("мелкие не схлопываются в ноль", () => {
    // 0,0103 при четырёх знаках ещё живёт, а 0,00089 стало бы «0,0009»
    expect(formatCrossValue(0.0103305)).toBe("0,01033");
    expect(formatCrossValue(0.00089)).toBe("0,00089");
  });
  it("хвостовые нули не тянутся", () => {
    expect(formatCrossValue(2.5)).toBe("2,5");
  });
  it("мусор — прочерк, а не NaN на экране", () => {
    expect(formatCrossValue(0)).toBe("—");
    expect(formatCrossValue(NaN)).toBe("—");
    expect(formatCrossValue(-1)).toBe("—");
  });
});
