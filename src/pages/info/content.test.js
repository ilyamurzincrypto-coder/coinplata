import { describe, it, expect } from "vitest";
import { INFO_SECTIONS } from "./content.js";

const nonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;

describe("INFO_SECTIONS", () => {
  it("is a non-empty array with unique ids and well-formed sections", () => {
    expect(Array.isArray(INFO_SECTIONS)).toBe(true);
    expect(INFO_SECTIONS.length).toBeGreaterThanOrEqual(6);
    const ids = INFO_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length); // unique
    for (const s of INFO_SECTIONS) {
      expect(nonEmptyStr(s.id)).toBe(true);
      expect(nonEmptyStr(s.title)).toBe(true);
      expect(nonEmptyStr(s.what)).toBe(true);
      expect(nonEmptyStr(s.related)).toBe(true);
      expect(Array.isArray(s.can) && s.can.length > 0 && s.can.every(nonEmptyStr)).toBe(true);
      if (s.sub) {
        expect(Array.isArray(s.sub) && s.sub.length > 0).toBe(true);
        for (const ss of s.sub) {
          expect(nonEmptyStr(ss.title)).toBe(true);
          expect(Array.isArray(ss.can) && ss.can.length > 0 && ss.can.every(nonEmptyStr)).toBe(true);
        }
      }
    }
  });
  it("covers the core areas", () => {
    const ids = INFO_SECTIONS.map((s) => s.id);
    for (const id of ["cashier", "capital", "accounts", "counterparties", "treasury", "settings"]) expect(ids).toContain(id);
    const treasury = INFO_SECTIONS.find((s) => s.id === "treasury");
    expect(treasury.sub.map((s) => s.id)).toEqual(expect.arrayContaining(["balance-sheet", "pnl", "turnover", "journal", "posting-master"]));
  });
});
