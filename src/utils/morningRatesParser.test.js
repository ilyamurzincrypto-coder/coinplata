import { describe, it, expect } from "vitest";
import { parseNumber, resolveRateValue, CITY_OFFICE_MAP } from "./morningRatesParser.js";

describe("parseNumber", () => {
  it("запятая как десятичный разделитель", () => {
    expect(parseNumber("45,50")).toBe(45.5);
    expect(parseNumber("-0,80")).toBe(-0.8);
    expect(parseNumber("1.171")).toBe(1.171);
  });
  it("мусор → NaN", () => {
    expect(Number.isNaN(parseNumber("abc"))).toBe(true);
  });
});

describe("resolveRateValue", () => {
  it("процент → 1 + v/100", () => {
    expect(resolveRateValue({ value: -1, pct: true }, "crypto", "cash")).toBe(0.99);
    expect(resolveRateValue({ value: 0, pct: true }, "crypto", "cash")).toBe(1);
  });
  it("crypto→cash = абсолют", () => {
    expect(resolveRateValue({ value: 44.9, pct: false }, "crypto", "cash")).toBe(44.9);
  });
  it("cash→crypto = 1/v", () => {
    expect(resolveRateValue({ value: 45.7, pct: false }, "cash", "crypto")).toBeCloseTo(1 / 45.7, 10);
  });
  it("cash→crypto деление на ноль → null", () => {
    expect(resolveRateValue({ value: 0, pct: false }, "cash", "crypto")).toBe(null);
  });
});

describe("CITY_OFFICE_MAP", () => {
  it("ANT → оба офиса Антальи, MSK/SPB пусто", () => {
    expect(CITY_OFFICE_MAP.ANT).toEqual(["mark", "terra"]);
    expect(CITY_OFFICE_MAP.IST).toEqual(["ist"]);
    expect(CITY_OFFICE_MAP.MSK).toEqual([]);
    expect(CITY_OFFICE_MAP.SPB).toEqual([]);
  });
});
