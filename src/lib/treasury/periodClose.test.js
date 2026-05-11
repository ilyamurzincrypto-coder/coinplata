import { describe, it, expect } from "vitest";
import { periodCloseLines } from "./periodClose.js";

const mk = (accounts, balances) => ({ accounts, balances });

describe("periodCloseLines", () => {
  it("folds non-zero revenue/expense into RE; signs and netByCurrency are right", () => {
    const ctx = mk(
      [
        { id: "spr", code: "4010", name: "Spread USD", type: "revenue", currency: "USD" },
        { id: "com_eur", code: "4011", name: "Commission EUR", type: "revenue", currency: "EUR" },
        { id: "net", code: "5136", name: "Network fee USD", type: "expense", currency: "USD" },
        { id: "cash", code: "1110", name: "Cash USD", type: "asset", currency: "USD" },        // not revenue/expense → ignored
        { id: "spr_zero", code: "4012", name: "Spread TRY", type: "revenue", currency: "TRY" }, // zero balance → skipped
      ],
      [
        { accountId: "spr", balance: 50 },
        { accountId: "com_eur", balance: 10 },
        { accountId: "net", balance: 4 },
        { accountId: "cash", balance: 99999 },
        { accountId: "spr_zero", balance: 0 },
      ]
    );
    const { lines, netByCurrency } = periodCloseLines(ctx);
    // revenue lines first, then expense; amounts: revenue +B, expense −B
    expect(lines).toEqual([
      { accountCode: "4010", accountName: "Spread USD", currency: "USD", kind: "revenue", balance: 50, amount: 50 },
      { accountCode: "4011", accountName: "Commission EUR", currency: "EUR", kind: "revenue", balance: 10, amount: 10 },
      { accountCode: "5136", accountName: "Network fee USD", currency: "USD", kind: "expense", balance: 4, amount: -4 },
    ]);
    expect(netByCurrency).toEqual({ USD: 46, EUR: 10 });
  });

  it("sums multiple balance rows for the same account", () => {
    const ctx = mk(
      [{ id: "spr", code: "4010", name: "Spread USD", type: "revenue", currency: "USD" }],
      [{ accountId: "spr", balance: 30 }, { accountId: "spr", balance: 20 }]
    );
    const { lines } = periodCloseLines(ctx);
    expect(lines).toEqual([{ accountCode: "4010", accountName: "Spread USD", currency: "USD", kind: "revenue", balance: 50, amount: 50 }]);
  });

  it("returns empty when all revenue/expense balances are zero (nothing to close)", () => {
    const ctx = mk(
      [{ id: "spr", code: "4010", name: "Spread USD", type: "revenue", currency: "USD" }, { id: "net", code: "5136", name: "Net", type: "expense", currency: "USD" }],
      [{ accountId: "spr", balance: 0 }]
    );
    expect(periodCloseLines(ctx)).toEqual({ lines: [], netByCurrency: {} });
    expect(periodCloseLines({ accounts: [], balances: [] })).toEqual({ lines: [], netByCurrency: {} });
  });
});
