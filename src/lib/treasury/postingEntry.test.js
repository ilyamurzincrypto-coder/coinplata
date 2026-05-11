import { describe, it, expect } from "vitest";
import {
  SYSTEM_DRIVEN_SUBTYPES,
  deriveCurrencies,
  accountsForCurrency,
  postingBalance,
  validatePostingDraft,
  buildManualEntryPayload,
} from "./postingEntry.js";

const ACCOUNTS = [
  { id: "a1", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a2", code: "4010", name: "Spread USD", type: "revenue", subtype: "spread", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a3", code: "5136", name: "Network fee USD", type: "expense", subtype: "network_fee", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a4", code: "1340", name: "Treasury USDT", type: "asset", subtype: "crypto_input", currency: "USDT", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a5", code: "2110", name: "Customer Liab USD", type: "liability", subtype: "customer_liab", currency: "USD", clientDimRequired: true, partnerDimRequired: false, active: true },
  { id: "a6", code: "1112", name: "Cash TRY", type: "asset", subtype: "cash", currency: "TRY", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a7", code: "1199", name: "Old account", type: "asset", subtype: "cash", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: false },
];
const byCode = (code) => ACCOUNTS.find((a) => a.code === code) || null;
// fx to the reference (base) currency USD: USD=1, TRY≈0.022, USDT≈1.0; anything else → 0 (no rate)
const fxOf = (c) => ({ USD: 1, USDT: 1, TRY: 0.022 }[c] ?? 0);

const draft = (over = {}) => ({
  effectiveDate: "2026-05-10T00:00:00.000Z",
  reason: "manual fee",
  description: "",
  lines: [
    { id: "l1", accountCode: "1110", side: "dr", amount: "100", currency: "USD" },
    { id: "l2", accountCode: "4010", side: "cr", amount: "100", currency: "USD" },
  ],
  ...over,
});

describe("deriveCurrencies", () => {
  it("returns sorted unique currencies of active accounts only", () => {
    expect(deriveCurrencies(ACCOUNTS)).toEqual(["TRY", "USD", "USDT"]);
  });
});

describe("accountsForCurrency", () => {
  it("returns active accounts for the currency, including dimensioned ones; excludes wrong-currency and inactive", () => {
    const r = accountsForCurrency(ACCOUNTS, "USD").map((a) => a.code);
    expect(r).toEqual(expect.arrayContaining(["1110", "2110", "4010", "5136"]));
    expect(r).not.toContain("1340"); // USDT
    expect(r).not.toContain("1112"); // TRY
    expect(r).not.toContain("1199"); // inactive
  });
  it("flags system-driven subtypes via SYSTEM_DRIVEN_SUBTYPES", () => {
    expect(SYSTEM_DRIVEN_SUBTYPES.has("crypto_input")).toBe(true);
    expect(SYSTEM_DRIVEN_SUBTYPES.has("cash")).toBe(false);
  });
});

describe("postingBalance", () => {
  it("sums Dr and Cr and returns the delta (no fxOf → raw, fx=1)", () => {
    expect(postingBalance([{ side: "dr", amount: "100", currency: "USD" }, { side: "cr", amount: "60", currency: "USD" }, { side: "cr", amount: "40", currency: "USD" }]))
      .toEqual({ dr: 100, cr: 100, delta: 0 });
  });
  it("weights each line by fxOf(line.currency) when given", () => {
    // Dr 100 USD (·1) ; Cr 4545.45 TRY (·0.022 ≈ 100) → ≈ balanced in base
    const r = postingBalance([
      { side: "dr", amount: "100", currency: "USD" },
      { side: "cr", amount: "4545.4545", currency: "TRY" },
    ], fxOf);
    expect(r.dr).toBeCloseTo(100, 4);
    expect(r.cr).toBeCloseTo(100, 4);
    expect(Math.abs(r.delta)).toBeLessThan(0.01);
  });
  it("treats blank/invalid amounts as 0", () => {
    expect(postingBalance([{ side: "dr", amount: "", currency: "USD" }, { side: "cr", amount: "x", currency: "USD" }])).toEqual({ dr: 0, cr: 0, delta: 0 });
  });
});

describe("validatePostingDraft", () => {
  it("ok for a balanced single-currency 2-line draft", () => {
    expect(validatePostingDraft(draft(), byCode, fxOf)).toEqual({ ok: true, errors: [] });
  });
  it("ok for a balanced multi-currency draft (balances in base)", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1112", side: "dr", amount: "4545.4545", currency: "TRY" },
      { id: "l2", accountCode: "1110", side: "cr", amount: "100", currency: "USD" },
    ] }), byCode, fxOf);
    expect(r.ok).toBe(true);
  });
  it("rejects a multi-currency draft that does not balance in base (beyond 0.5)", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1112", side: "dr", amount: "5000", currency: "TRY" }, // ≈ $110
      { id: "l2", accountCode: "1110", side: "cr", amount: "100", currency: "USD" },   // $100
    ] }), byCode, fxOf);
    expect(r.errors.some((e) => e.code === "unbalanced")).toBe(true);
  });
  it("rejects unbalanced single-currency", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "100", currency: "USD" },
      { id: "l2", accountCode: "4010", side: "cr", amount: "90", currency: "USD" },
    ] }), byCode, fxOf);
    expect(r.errors.some((e) => e.code === "unbalanced")).toBe(true);
  });
  it("rejects a line whose account currency does not match the line's currency", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "100", currency: "USD" },
      { id: "l2", accountCode: "1340", side: "cr", amount: "100", currency: "USD" }, // USDT account, line says USD
    ] }), byCode, fxOf);
    expect(r.errors.some((e) => e.code === "currency_mismatch" && e.lineId === "l2")).toBe(true);
  });
  it("rejects a line currency with no fx rate", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "100", currency: "USD" },
      { id: "l2", accountCode: "1110", side: "cr", amount: "100", currency: "EUR" }, // fxOf("EUR") = 0
    ] }), byCode, fxOf);
    expect(r.errors.some((e) => e.code === "fx_missing" && e.lineId === "l2")).toBe(true);
  });
  it("rejects a line without a currency", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "100" },
      { id: "l2", accountCode: "4010", side: "cr", amount: "100", currency: "USD" },
    ] }), byCode, fxOf);
    expect(r.errors.some((e) => e.code === "currency_required" && e.lineId === "l1")).toBe(true);
  });
  it("rejects fewer than 2 lines; empty reason; non-positive amount; missing/unknown account; missing dr or cr", () => {
    expect(validatePostingDraft(draft({ lines: [{ id: "l1", accountCode: "1110", side: "dr", amount: "100", currency: "USD" }] }), byCode, fxOf).errors.some((e) => e.code === "too_few_lines")).toBe(true);
    expect(validatePostingDraft(draft({ reason: "  " }), byCode, fxOf).errors.some((e) => e.code === "reason_required")).toBe(true);
    expect(validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "0", currency: "USD" },
      { id: "l2", accountCode: "4010", side: "cr", amount: "0", currency: "USD" },
    ] }), byCode, fxOf).errors.some((e) => e.code === "amount_positive" && e.lineId === "l1")).toBe(true);
    expect(validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "", side: "dr", amount: "100", currency: "USD" },
      { id: "l2", accountCode: "1199", side: "cr", amount: "100", currency: "USD" },
    ] }), byCode, fxOf).errors.some((e) => e.code === "account_required" && e.lineId === "l1")).toBe(true);
    expect(validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "50", currency: "USD" },
      { id: "l2", accountCode: "5136", side: "dr", amount: "50", currency: "USD" },
    ] }), byCode, fxOf).errors.some((e) => e.code === "need_dr_and_cr")).toBe(true);
  });
  it("requires a counterparty on a dimensioned line", () => {
    expect(validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "100", currency: "USD" },
      { id: "l2", accountCode: "2110", side: "cr", amount: "100", currency: "USD" },
    ] }), byCode, fxOf).errors.some((e) => e.code === "client_required" && e.lineId === "l2")).toBe(true);
    expect(validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "100", currency: "USD" },
      { id: "l2", accountCode: "2110", side: "cr", amount: "100", currency: "USD", clientId: "client-1" },
    ] }), byCode, fxOf).errors.some((e) => e.code === "client_required")).toBe(false);
  });
});

describe("buildManualEntryPayload", () => {
  it("maps a single-currency draft (numeric amounts, trimmed reason, per-line currency, fxRates)", () => {
    expect(buildManualEntryPayload(draft({ reason: "  manual fee  ", description: " note " }), "USD", fxOf)).toEqual({
      lines: [
        { accountCode: "1110", direction: "dr", amount: 100, currencyCode: "USD" },
        { accountCode: "4010", direction: "cr", amount: 100, currencyCode: "USD" },
      ],
      currencyCode: "USD",
      fxRates: { USD: 1 },
      reason: "manual fee",
      effectiveDate: "2026-05-10T00:00:00.000Z",
      description: "note",
    });
  });
  it("includes fxRates for every distinct line currency on a multi-currency draft", () => {
    const p = buildManualEntryPayload(draft({ lines: [
      { id: "l1", accountCode: "1112", side: "dr", amount: "4545.4545", currency: "TRY" },
      { id: "l2", accountCode: "1110", side: "cr", amount: "100", currency: "USD" },
    ] }), "USD", fxOf);
    expect(p.currencyCode).toBe("USD");
    expect(p.fxRates).toEqual({ TRY: 0.022, USD: 1 });
    expect(p.lines).toEqual([
      { accountCode: "1112", direction: "dr", amount: 4545.4545, currencyCode: "TRY" },
      { accountCode: "1110", direction: "cr", amount: 100, currencyCode: "USD" },
    ]);
  });
  it("omits description when blank", () => {
    expect(buildManualEntryPayload(draft({ description: "   " }), "USD", fxOf).description).toBeUndefined();
  });
});
