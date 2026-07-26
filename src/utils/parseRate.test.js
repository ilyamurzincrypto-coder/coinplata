// Слайс 1.e: parseRate для записи в numeric-колонки rate (comma-safe).
import { describe, it, expect } from "vitest";
import { parseRate } from "./money.js";

describe("parseRate", () => {
  it("запятая-десятичная → число", () => expect(parseRate("46,2")).toBe(46.2));
  it("точка-десятичная → число", () => expect(parseRate("46.2")).toBe(46.2));
  it("число → как есть", () => expect(parseRate(46.2)).toBe(46.2));
  it("целое-строка → число", () => expect(parseRate("1")).toBe(1));
  it("null/undefined/'' → null", () => {
    expect(parseRate(null)).toBeNull();
    expect(parseRate(undefined)).toBeNull();
    expect(parseRate("")).toBeNull();
  });
  it("мусор → null (не 0, не NaN)", () => {
    expect(parseRate("abc")).toBeNull();
    expect(parseRate("null")).toBeNull();
  });
  it("ноль сохраняется как 0 (валидное число)", () => expect(parseRate(0)).toBe(0));
});
