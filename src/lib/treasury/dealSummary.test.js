import { describe, it, expect } from "vitest";
import { dealSummary, dealRate } from "./dealSummary.js";

const ACC = new Map([
  ["a_cash_usd", { type: "asset" }],
  ["a_hot_usdt", { type: "asset" }],
  ["a_bank_usd", { type: "asset" }],
  ["l_cust", { type: "liability" }],
  ["e_open", { type: "equity" }],
  ["r_spread", { type: "revenue" }],
  // accounts with explicit subtypes — for deferred-deal cases
  ["e_fx_usd", { type: "equity", subtype: "fx_clearing" }],
  ["e_fx_usdt", { type: "equity", subtype: "fx_clearing" }],
  ["l_cust_usdt", { type: "liability", subtype: "customer_liab" }],
  ["l_cust_usd", { type: "liability", subtype: "customer_liab" }],
  ["l_unearned_usdt", { type: "liability", subtype: "unearned" }],
]);

const node = (entries) => ({ tx: { kind: "deal" }, entries });

describe("dealSummary", () => {
  it("a 5-entry deal → in / out / margin", () => {
    const s = dealSummary(node([
      { accountId: "a_cash_usd", direction: "dr", amount: 1000, currency: "USD", accountName: "Касса USD" },
      { accountId: "l_cust", direction: "cr", amount: 1000, currency: "USD", accountName: "Обязательства" },
      { accountId: "l_cust", direction: "dr", amount: 950, currency: "USD", accountName: "Обязательства" },
      { accountId: "a_hot_usdt", direction: "cr", amount: 950, currency: "USDT", accountName: "Hot USDT" },
      { accountId: "r_spread", direction: "cr", amount: 50, currency: "USD", accountName: "Доход: спред" },
    ]), ACC);
    expect(s).toEqual({
      in: [{ amount: 1000, currency: "USD", accountName: "Касса USD" }],
      out: [{ amount: 950, currency: "USDT", accountName: "Hot USDT" }],
      margin: [{ amount: 50, currency: "USD" }],
    });
  });

  it("opening adjustment (Dr cash / Cr opening equity) → in only, no out, no margin", () => {
    const s = dealSummary(node([
      { accountId: "a_cash_usd", direction: "dr", amount: 5000, currency: "USD", accountName: "Касса USD" },
      { accountId: "e_open", direction: "cr", amount: 5000, currency: "USD", accountName: "Opening Equity" },
    ]), ACC);
    expect(s).toEqual({ in: [{ amount: 5000, currency: "USD", accountName: "Касса USD" }], out: [], margin: [] });
  });

  it("transfer (Dr bank / Cr cash) → both asset sides, no margin", () => {
    const s = dealSummary(node([
      { accountId: "a_bank_usd", direction: "dr", amount: 2000, currency: "USD", accountName: "Банк USD" },
      { accountId: "a_cash_usd", direction: "cr", amount: 2000, currency: "USD", accountName: "Касса USD" },
    ]), ACC);
    expect(s.in).toEqual([{ amount: 2000, currency: "USD", accountName: "Банк USD" }]);
    expect(s.out).toEqual([{ amount: 2000, currency: "USD", accountName: "Касса USD" }]);
    expect(s.margin).toEqual([]);
  });

  it("nets multi-leg same-account entries (Dr 100 then Cr 30 on cash → in 70)", () => {
    const s = dealSummary(node([
      { accountId: "a_cash_usd", direction: "dr", amount: 100, currency: "USD", accountName: "Касса USD" },
      { accountId: "a_cash_usd", direction: "cr", amount: 30, currency: "USD", accountName: "Касса USD" },
      { accountId: "a_hot_usdt", direction: "cr", amount: 70, currency: "USDT", accountName: "Hot USDT" },
    ]), ACC);
    expect(s.in).toEqual([{ amount: 70, currency: "USD", accountName: "Касса USD" }]);
    expect(s.out).toEqual([{ amount: 70, currency: "USDT", accountName: "Hot USDT" }]);
  });

  it("returns null when there are no asset legs / no entries", () => {
    expect(dealSummary(node([]), ACC)).toBeNull();
    expect(dealSummary(node([
      { accountId: "l_cust", direction: "cr", amount: 100, currency: "USD", accountName: "L" },
      { accountId: "e_open", direction: "dr", amount: 100, currency: "USD", accountName: "E" },
    ]), ACC)).toBeNull();
    expect(dealSummary(null, ACC)).toBeNull();
  });

  it("deferred deal (Cr customer_liab = obligation) → out leg marked deferred + unearned margin", () => {
    // USD→USDT, USDT side deferred: Dr Cash·USD; FX-clearing pair; Cr CustLiab·USDT; Cr Unearned·USDT
    const s = dealSummary(node([
      { accountId: "a_cash_usd", direction: "dr", amount: 1000, currency: "USD", accountName: "Касса USD" },
      { accountId: "e_fx_usd", direction: "cr", amount: 1000, currency: "USD", accountName: "FX USD" },
      { accountId: "e_fx_usdt", direction: "dr", amount: 950.01, currency: "USDT", accountName: "FX USDT" },
      { accountId: "l_cust_usdt", direction: "cr", amount: 950, currency: "USDT", accountName: "Обязательство · USDT" },
      { accountId: "l_unearned_usdt", direction: "cr", amount: 0.01, currency: "USDT", accountName: "Unearned" },
    ]), ACC);
    expect(s.in).toEqual([{ amount: 1000, currency: "USD", accountName: "Касса USD" }]);
    expect(s.out).toEqual([{ amount: 950, currency: "USDT", accountName: "Обязательство · USDT", deferred: true }]);
    expect(s.margin).toEqual([{ amount: 0.01, currency: "USDT" }]);
  });

  it("deal funded from the client's own balance → both sides marked deferred", () => {
    // Client converts 1000 USD of their balance into 950 USDT of their balance; we keep 50 USDT.
    const s = dealSummary(node([
      { accountId: "l_cust_usd", direction: "dr", amount: 1000, currency: "USD", accountName: "Баланс клиента · USD" },
      { accountId: "l_cust_usdt", direction: "cr", amount: 950, currency: "USDT", accountName: "Баланс клиента · USDT" },
      { accountId: "l_unearned_usdt", direction: "cr", amount: 50, currency: "USDT", accountName: "Unearned" },
    ]), ACC);
    expect(s.in).toEqual([{ amount: 1000, currency: "USD", accountName: "Баланс клиента · USD", deferred: true }]);
    expect(s.out).toEqual([{ amount: 950, currency: "USDT", accountName: "Баланс клиента · USDT", deferred: true }]);
    expect(s.margin).toEqual([{ amount: 50, currency: "USDT" }]);
  });
});

describe("dealRate", () => {
  it("OUT-per-IN for a clean 1↔1 deal", () => {
    const r = dealRate({ in: [{ amount: 1000, currency: "USD" }], out: [{ amount: 950, currency: "USDT" }], margin: [] });
    expect(r).toEqual({ rate: 0.95, from: "USD", to: "USDT" });
  });
  it("null for multi-currency / same-currency / empty / missing", () => {
    expect(dealRate(null)).toBeNull();
    expect(dealRate({ in: [{ amount: 100, currency: "USD" }], out: [{ amount: 100, currency: "USD" }], margin: [] })).toBeNull();
    expect(dealRate({ in: [{ amount: 100, currency: "USD" }, { amount: 5, currency: "EUR" }], out: [{ amount: 100, currency: "TRY" }], margin: [] })).toBeNull();
    expect(dealRate({ in: [], out: [{ amount: 100, currency: "TRY" }], margin: [] })).toBeNull();
  });
});
