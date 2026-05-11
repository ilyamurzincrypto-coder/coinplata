import { describe, it, expect } from "vitest";
import { INFO_SECTIONS } from "./content.js";

const nonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;
const finiteNum = (v) => Number.isFinite(Number(v));

function checkExamples(examples, ctx) {
  expect(Array.isArray(examples) && examples.length > 0).toBe(true);
  for (const ex of examples) {
    expect(nonEmptyStr(ex.title)).toBe(true);
    if (ex.intro != null) expect(nonEmptyStr(ex.intro)).toBe(true);
    if (ex.steps != null) expect(Array.isArray(ex.steps) && ex.steps.length > 0 && ex.steps.every(nonEmptyStr)).toBe(true);
    if (ex.note != null) expect(nonEmptyStr(ex.note)).toBe(true);
    if (ex.journal != null) {
      expect(Array.isArray(ex.journal) && ex.journal.length > 0).toBe(true);
      for (const l of ex.journal) {
        expect(["dr", "cr"]).toContain(l.dir);
        expect(nonEmptyStr(l.account)).toBe(true);
        expect(finiteNum(l.amount)).toBe(true);
        expect(nonEmptyStr(l.cur)).toBe(true);
        if (l.note != null) expect(nonEmptyStr(l.note)).toBe(true);
      }
    }
  }
}

describe("INFO_SECTIONS", () => {
  it("is a non-empty array with unique ids and well-formed sections (incl. how + examples)", () => {
    expect(Array.isArray(INFO_SECTIONS)).toBe(true);
    expect(INFO_SECTIONS.length).toBeGreaterThanOrEqual(6);
    const ids = INFO_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of INFO_SECTIONS) {
      expect(nonEmptyStr(s.id)).toBe(true);
      expect(nonEmptyStr(s.title)).toBe(true);
      expect(nonEmptyStr(s.what)).toBe(true);
      expect(nonEmptyStr(s.related)).toBe(true);
      expect(Array.isArray(s.can) && s.can.length > 0 && s.can.every(nonEmptyStr)).toBe(true);
      // v2: every section has a non-empty `how`. Examples live either on the
      // section itself OR (for sections with sub-areas) on each sub.
      expect(Array.isArray(s.how) && s.how.length > 0 && s.how.every(nonEmptyStr)).toBe(true);
      if (s.examples != null) checkExamples(s.examples, `section ${s.id}`);
      else expect(Array.isArray(s.sub) && s.sub.length > 0).toBe(true);
      if (s.sub) {
        expect(Array.isArray(s.sub) && s.sub.length > 0).toBe(true);
        for (const ss of s.sub) {
          expect(nonEmptyStr(ss.title)).toBe(true);
          expect(Array.isArray(ss.how) && ss.how.length > 0 && ss.how.every(nonEmptyStr)).toBe(true);
          checkExamples(ss.examples, `sub ${ss.id}`);
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
  it("has at least one example with a Дт/Кт journal table", () => {
    const all = INFO_SECTIONS.flatMap((s) => [...(s.examples || []), ...((s.sub || []).flatMap((ss) => ss.examples || []))]);
    expect(all.some((ex) => Array.isArray(ex.journal) && ex.journal.length > 0)).toBe(true);
  });
});
