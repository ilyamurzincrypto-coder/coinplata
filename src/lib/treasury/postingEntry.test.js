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
  { id: "a3", code: "5010", name: "Office rent USD", type: "expense", subtype: "rent", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a4", code: "1340", name: "Treasury USDT", type: "asset", subtype: "crypto_input", currency: "USDT", clientDimRequired: false, partnerDimRequired: false, active: true },
  { id: "a5", code: "2110", name: "Customer Liab USD", type: "liability", subtype: "customer_liab", currency: "USD", clientDimRequired: true, partnerDimRequired: false, active: true },
  { id: "a6", code: "1199", name: "Old account", type: "asset", subtype: "cash", currency: "USD", clientDimRequired: false, partnerDimRequired: false, active: false },
];
const byCode = (code) => ACCOUNTS.find((a) => a.code === code) || null;

const draft = (over = {}) => ({
  currency: "USD",
  effectiveDate: "2026-05-10T00:00:00.000Z",
  reason: "manual fee",
  description: "",
  lines: [
    { id: "l1", accountCode: "1110", side: "dr", amount: "100" },
    { id: "l2", accountCode: "4010", side: "cr", amount: "100" },
  ],
  ...over,
});

describe("deriveCurrencies", () => {
  it("returns sorted unique currencies of active accounts only", () => {
    expect(deriveCurrencies(ACCOUNTS)).toEqual(["USD", "USDT"]);
  });
});

describe("accountsForCurrency", () => {
  it("returns active accounts for the currency, including dimensioned ones; excludes wrong-currency and inactive", () => {
    const r = accountsForCurrency(ACCOUNTS, "USD").map((a) => a.code);
    expect(r).toEqual(expect.arrayContaining(["1110", "2110", "4010", "5010"])); // 2110 now included
    expect(r).not.toContain("1340"); // wrong currency (USDT)
    expect(r).not.toContain("1199"); // inactive
  });
  it("flags system-driven subtypes via SYSTEM_DRIVEN_SUBTYPES", () => {
    expect(SYSTEM_DRIVEN_SUBTYPES.has("crypto_input")).toBe(true);
    expect(SYSTEM_DRIVEN_SUBTYPES.has("cash")).toBe(false);
  });
});

describe("postingBalance", () => {
  it("sums Dr and Cr and returns the delta", () => {
    expect(postingBalance([{ side: "dr", amount: "100" }, { side: "cr", amount: "60" }, { side: "cr", amount: "40" }]))
      .toEqual({ dr: 100, cr: 100, delta: 0 });
  });
  it("treats blank/invalid amounts as 0", () => {
    expect(postingBalance([{ side: "dr", amount: "" }, { side: "cr", amount: "x" }])).toEqual({ dr: 0, cr: 0, delta: 0 });
  });
});

describe("validatePostingDraft", () => {
  it("ok for a balanced 2-line draft", () => {
    expect(validatePostingDraft(draft(), byCode)).toEqual({ ok: true, errors: [] });
  });
  it("rejects unbalanced", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "100" },
      { id: "l2", accountCode: "4010", side: "cr", amount: "90" },
    ] }), byCode);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "unbalanced")).toBe(true);
  });
  it("rejects fewer than 2 lines", () => {
    const r = validatePostingDraft(draft({ lines: [{ id: "l1", accountCode: "1110", side: "dr", amount: "100" }] }), byCode);
    expect(r.errors.some((e) => e.code === "too_few_lines")).toBe(true);
  });
  it("rejects empty reason", () => {
    const r = validatePostingDraft(draft({ reason: "  " }), byCode);
    expect(r.errors.some((e) => e.code === "reason_required")).toBe(true);
  });
  it("rejects a non-positive amount with a per-line error", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "0" },
      { id: "l2", accountCode: "4010", side: "cr", amount: "0" },
    ] }), byCode);
    expect(r.errors.some((e) => e.code === "amount_positive" && e.lineId === "l1")).toBe(true);
  });
  it("rejects a missing / unknown / inactive account", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "", side: "dr", amount: "100" },
      { id: "l2", accountCode: "1199", side: "cr", amount: "100" },
    ] }), byCode);
    expect(r.errors.some((e) => e.code === "account_required" && e.lineId === "l1")).toBe(true);
    expect(r.errors.some((e) => e.code === "account_unknown" && e.lineId === "l2")).toBe(true);
  });
  it("rejects a currency mismatch", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "100" },
      { id: "l2", accountCode: "1340", side: "cr", amount: "100" }, // USDT account in a USD entry
    ] }), byCode);
    expect(r.errors.some((e) => e.code === "currency_mismatch" && e.lineId === "l2")).toBe(true);
  });
  it("requires a counterparty on a line whose account has a required dimension", () => {
    const without = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "100" },
      { id: "l2", accountCode: "2110", side: "cr", amount: "100" },
    ] }), byCode);
    expect(without.errors.some((e) => e.code === "client_required" && e.lineId === "l2")).toBe(true);
    const withClient = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "100" },
      { id: "l2", accountCode: "2110", side: "cr", amount: "100", clientId: "client-1" },
    ] }), byCode);
    expect(withClient.errors.some((e) => e.code === "client_required")).toBe(false);
  });
  it("requires at least one Dr and one Cr line", () => {
    const r = validatePostingDraft(draft({ lines: [
      { id: "l1", accountCode: "1110", side: "dr", amount: "50" },
      { id: "l2", accountCode: "5010", side: "dr", amount: "50" },
    ] }), byCode);
    expect(r.errors.some((e) => e.code === "need_dr_and_cr")).toBe(true);
  });
});

describe("buildManualEntryPayload", () => {
  it("maps a draft to the rpcCreateManualEntryV2 payload (numeric amounts, trimmed reason)", () => {
    expect(buildManualEntryPayload(draft({ reason: "  manual fee  ", description: " note " }))).toEqual({
      lines: [
        { accountCode: "1110", direction: "dr", amount: 100 },
        { accountCode: "4010", direction: "cr", amount: 100 },
      ],
      currencyCode: "USD",
      reason: "manual fee",
      effectiveDate: "2026-05-10T00:00:00.000Z",
      description: "note",
    });
  });
  it("omits description when blank", () => {
    expect(buildManualEntryPayload(draft({ description: "   " })).description).toBeUndefined();
  });
});
