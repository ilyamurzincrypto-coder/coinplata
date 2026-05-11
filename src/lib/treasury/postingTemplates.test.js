import { describe, it, expect } from "vitest";
import { POSTING_TEMPLATES, resolveTemplate } from "./postingTemplates.js";

const ACCOUNTS = [
  { code: "5126", name: "Exchange fee", subtype: "exchange_fee", currency: "USD", active: true },
  { code: "5136", name: "Network fee", subtype: "network_fee", currency: "USD", active: true },
  { code: "5310", name: "FX loss · USD", subtype: "fx_loss", currency: "USD", active: true },
  { code: "5311", name: "FX loss · EUR", subtype: "fx_loss", currency: "EUR", active: true },
  { code: "1110", name: "Cash · Office A · USD", subtype: "cash", currency: "USD", active: true },
  { code: "1111", name: "Cash · Office B · USD", subtype: "cash", currency: "USD", active: true },
  { code: "1340", name: "Treasury USDT", subtype: "crypto_input", currency: "USDT", active: true },
  { code: "3110", name: "Owner contribution", subtype: "owner_contribution", currency: "USD", active: true },
  { code: "3210", name: "FX clearing", subtype: "fx_clearing", currency: "USD", active: true },
  { code: "5999", name: "Disabled cash", subtype: "cash", currency: "USD", active: false },
];

describe("POSTING_TEMPLATES catalog", () => {
  it("has unique ids and well-formed lines (each line has dr|cr side + non-empty subtype)", () => {
    const ids = POSTING_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of POSTING_TEMPLATES) {
      expect(t.name.ru).toBeTruthy();
      expect(t.name.en).toBeTruthy();
      expect(t.name.tr).toBeTruthy();
      expect(Array.isArray(t.lines) && t.lines.length >= 2).toBe(true);
      for (const l of t.lines) {
        expect(["dr", "cr"]).toContain(l.side);
        expect(typeof l.subtype).toBe("string");
        expect(l.subtype.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("resolveTemplate", () => {
  it("pre-fills accountCode when exactly one account matches (subtype, currency, active)", () => {
    const tpl = POSTING_TEMPLATES.find((t) => t.id === "network_fee");
    const { lines } = resolveTemplate(tpl, ACCOUNTS, "USDT");
    // Dr network_fee USDT: no matching account → empty; Cr crypto_input USDT: 1340 (only) → filled.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ side: "dr", accountCode: "", amount: "" });
    expect(lines[1]).toMatchObject({ side: "cr", accountCode: "1340", amount: "" });
  });

  it("leaves accountCode empty when multiple accounts match (ambiguous — accountant picks)", () => {
    const tpl = POSTING_TEMPLATES.find((t) => t.id === "owner_contribution");
    const { lines } = resolveTemplate(tpl, ACCOUNTS, "USD");
    // Dr cash USD: 1110 + 1111 (multiple offices) → empty; Cr owner_contribution USD: 3110 (only) → filled.
    expect(lines[0]).toMatchObject({ side: "dr", accountCode: "" });
    expect(lines[1]).toMatchObject({ side: "cr", accountCode: "3110" });
  });

  it("ignores inactive accounts when counting matches", () => {
    const tpl = POSTING_TEMPLATES.find((t) => t.id === "exchange_fee");
    // exchange_fee Dr USD → 5126 (only); cash USD has 1110, 1111 active + 5999 inactive → ambiguous (2).
    const { lines } = resolveTemplate(tpl, ACCOUNTS, "USD");
    expect(lines[0].accountCode).toBe("5126");
    expect(lines[1].accountCode).toBe(""); // 2 active cash accounts → empty
  });

  it("generates monotonically-increasing line ids based on lineSeed", () => {
    const tpl = POSTING_TEMPLATES.find((t) => t.id === "fx_gain_adjustment");
    const { lines, nextSeed } = resolveTemplate(tpl, ACCOUNTS, "USD", 10);
    expect(lines.map((l) => l.id)).toEqual(["pm11", "pm12"]);
    expect(nextSeed).toBe(12);
  });

  it("returns empty lines for a falsy template", () => {
    expect(resolveTemplate(null, ACCOUNTS, "USD").lines).toEqual([]);
    expect(resolveTemplate({ id: "x" }, ACCOUNTS, "USD").lines).toEqual([]);
  });
});
