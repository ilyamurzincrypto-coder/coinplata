import { describe, it, expect } from "vitest";
import { isPercentPair, rateToPercent, percentToRate, formatRateValue } from "./ratesFormat.js";

describe("ratesFormat", () => {
  it("isPercentPair: USDT↔USD = percent, USDT↔TRY = absolute", () => {
    expect(isPercentPair("USDT", "USD")).toBe(true);
    expect(isPercentPair("USD", "USDT")).toBe(true);
    expect(isPercentPair("USDT", "TRY")).toBe(false);
    expect(isPercentPair("EUR", "USDT")).toBe(false);
  });
  it("rateToPercent / percentToRate round-trip", () => {
    expect(rateToPercent(0.99)).toBeCloseTo(-1, 9);
    expect(rateToPercent(1.002)).toBeCloseTo(0.2, 9);
    expect(percentToRate(-1)).toBeCloseTo(0.99, 9);
    expect(percentToRate(0.2)).toBeCloseTo(1.002, 9);
  });
  it("formatRateValue: percent pair → '−1,00 %', absolute → '45,10'", () => {
    expect(formatRateValue("USDT", "USD", 0.99)).toBe("−1,00 %");
    expect(formatRateValue("USD", "USDT", 1.002)).toBe("+0,20 %");
    expect(formatRateValue("USDT", "TRY", 45.1)).toBe("45,10");
    expect(formatRateValue("USDT", "EUR", 1.177)).toBe("1,177");
  });
});
