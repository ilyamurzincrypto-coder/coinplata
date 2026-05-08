// pickRate tests (P3 T14 — inverse rate detection edge cases).

import { describe, expect, it } from "vitest";
import { computePickedRate } from "./pickRate.js";

describe("computePickedRate — direction matching", () => {
  it("direct match: IN=USDT, OUT=TRY, click USDT→TRY @ 30 → rate=30 market", () => {
    const r = computePickedRate({
      from: "USDT", to: "TRY", rate: 30,
      inCurrency: "USDT", outCurrency: "TRY",
    });
    expect(r).toEqual({ rate: "30", rateManual: false });
  });

  it("inverse: IN=USDT, OUT=TRY, click TRY→USDT @ 0.0333 → rate=30 market", () => {
    const r = computePickedRate({
      from: "TRY", to: "USDT", rate: 0.0333333333,
      inCurrency: "USDT", outCurrency: "TRY",
    });
    expect(r.rateManual).toBe(false);
    expect(Number(r.rate)).toBeCloseTo(30, 2);
  });

  it("mismatch: IN=USDT, OUT=TRY, click EUR→RUB @ 90 → rate=90 manual", () => {
    const r = computePickedRate({
      from: "EUR", to: "RUB", rate: 90,
      inCurrency: "USDT", outCurrency: "TRY",
    });
    expect(r).toEqual({ rate: "90", rateManual: true });
  });

  it("partial match (only OUT): IN=USDT, OUT=TRY, click EUR→TRY @ 33 → manual", () => {
    // OUT side (TRY) matches `to`, но IN side (USDT) ≠ `from`(EUR)
    const r = computePickedRate({
      from: "EUR", to: "TRY", rate: 33,
      inCurrency: "USDT", outCurrency: "TRY",
    });
    expect(r).toEqual({ rate: "33", rateManual: true });
  });

  it("no active OUT leg → null", () => {
    expect(computePickedRate({
      from: "USDT", to: "TRY", rate: 30,
      inCurrency: "USDT", outCurrency: null,
    })).toBeNull();
  });

  it("invalid rate → null", () => {
    expect(computePickedRate({
      from: "USDT", to: "TRY", rate: 0,
      inCurrency: "USDT", outCurrency: "TRY",
    })).toBeNull();
    expect(computePickedRate({
      from: "USDT", to: "TRY", rate: NaN,
      inCurrency: "USDT", outCurrency: "TRY",
    })).toBeNull();
  });

  it("no IN currency yet → mismatch (manual)", () => {
    const r = computePickedRate({
      from: "USDT", to: "TRY", rate: 30,
      inCurrency: null, outCurrency: "TRY",
    });
    expect(r).toEqual({ rate: "30", rateManual: true });
  });
});
