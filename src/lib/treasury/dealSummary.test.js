import { describe, it, expect } from "vitest";
import { dealSummary } from "./dealSummary.js";

const ACC = new Map([
  ["a_cash_usd", { type: "asset" }],
  ["a_hot_usdt", { type: "asset" }],
  ["a_bank_usd", { type: "asset" }],
  ["l_cust", { type: "liability" }],
  ["e_open", { type: "equity" }],
  ["r_spread", { type: "revenue" }],
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
});
