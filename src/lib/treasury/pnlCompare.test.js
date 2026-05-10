import { describe, it, expect } from "vitest";
import { mergePnlSection, csvRowsForPnl } from "./pnlCompare.js";

const A = (code, name, amt, n = 1, cur = "USD") => ({ code, name, currency: cur, amountInBase: amt, entryCount: n });

describe("mergePnlSection", () => {
  it("matches by code, computes delta, fills missing sides with 0, prefers current for name/currency/entryCount", () => {
    const cur = [A("4010", "Spread", 100, 3), A("4020", "Commission", 40, 2)];
    const prev = [A("4010", "Spread (old name)", 70, 5), A("4099", "Bonus", 10, 1)];
    const m = mergePnlSection(cur, prev);
    const byCode = Object.fromEntries(m.map((r) => [r.code, r]));
    expect(byCode["4010"]).toMatchObject({ name: "Spread", entryCount: 3, amountInBase: 100, prevInBase: 70, delta: 30 });
    expect(byCode["4020"]).toMatchObject({ amountInBase: 40, prevInBase: 0, delta: 40 });
    expect(byCode["4099"]).toMatchObject({ name: "Bonus", entryCount: 1, amountInBase: 0, prevInBase: 10, delta: -10 });
    // sorted by |amountInBase| desc, then code asc
    expect(m.map((r) => r.code)).toEqual(["4010", "4020", "4099"]);
  });
  it("handles empty inputs", () => {
    expect(mergePnlSection([], [])).toEqual([]);
    expect(mergePnlSection([A("X", "x", 5)], undefined)).toMatchObject([{ code: "X", amountInBase: 5, prevInBase: 0, delta: 5 }]);
  });
});

describe("csvRowsForPnl", () => {
  const pnl = {
    revenue: { total: 100, accounts: [A("4010", "Spread", 100, 3)] },
    expense: { total: 30, accounts: [A("5010", "Rent", 30, 1)] },
    fxNet: -5, fxAccounts: [A("3210", "FX gain", -5, 2)],
    netProfit: 65,
  };
  it("without prev: flat per-account rows + a net_profit row, no prev/delta keys", () => {
    const rows = csvRowsForPnl(pnl, null);
    expect(rows.map((r) => r.section)).toEqual(["revenue", "expense", "fx", "net_profit"]);
    expect(rows[0]).toMatchObject({ section: "revenue", code: "4010", name: "Spread", currency: "USD", amount: 100, entryCount: 3 });
    expect(rows[3]).toMatchObject({ section: "net_profit", code: "", amount: 65 });
    expect(rows[0].amountPrev).toBeUndefined();
  });
  it("with prev: includes amountPrev + delta per row and on the net_profit row", () => {
    const pnlPrev = {
      revenue: { total: 70, accounts: [A("4010", "Spread", 70, 5)] },
      expense: { total: 20, accounts: [A("5010", "Rent", 20, 1)] },
      fxNet: 0, fxAccounts: [],
      netProfit: 50,
    };
    const rows = csvRowsForPnl(pnl, pnlPrev);
    expect(rows.find((r) => r.section === "revenue" && r.code === "4010")).toMatchObject({ amount: 100, amountPrev: 70, delta: 30 });
    expect(rows.find((r) => r.section === "fx" && r.code === "3210")).toMatchObject({ amount: -5, amountPrev: 0, delta: -5 });
    expect(rows.find((r) => r.section === "net_profit")).toMatchObject({ amount: 65, amountPrev: 50, delta: 15 });
  });
});
