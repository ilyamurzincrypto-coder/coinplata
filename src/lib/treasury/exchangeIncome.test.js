// Доход обмена: спред плюс переоценка.
//
// Расчёт заведён отдельно от pnlForPeriod намеренно. Тот ищет переоценку среди
// счетов класса equity, а в реальном плане fx_gain — это revenue, fx_loss —
// expense: там их нет, и переоценка растворяется в общей выручке.
import { describe, it, expect } from "vitest";
import { exchangeIncome } from "./v2selectors.js";

const PERIOD = { from: "2026-09-01", to: "2026-09-30" };
const ctx = (accounts, entries) => ({
  accounts, entries, transactions: [],
  toBase: (n) => n,
});
const e = (accountId, direction, amount, createdAt = "2026-09-10") =>
  ({ accountId, direction, amount, currency: "USD", createdAt, transactionId: null });

describe("exchangeIncome", () => {
  const ACCS = [
    { id: "a1", type: "revenue", subtype: "spread", code: "6100" },
    { id: "a2", type: "revenue", subtype: "fx_gain", code: "6200" },
    { id: "a3", type: "expense", subtype: "fx_loss", code: "7200" },
    { id: "a4", type: "revenue", subtype: "commission", code: "6300" },
  ];

  it("находит fx по подтипу, хотя классы у них разные", () => {
    const r = exchangeIncome(ctx(ACCS, [e("a2", "cr", 300), e("a3", "dr", 100)]), PERIOD, "all");
    expect(r.fx).toBe(200); // 300 прибыли минус 100 убытка
  });

  it("спред и переоценка складываются, но видны по отдельности", () => {
    const r = exchangeIncome(ctx(ACCS, [e("a1", "cr", 500), e("a2", "cr", 120)]), PERIOD, "all");
    expect(r.spread).toBe(500);
    expect(r.fx).toBe(120);
    expect(r.total).toBe(620);
  });

  it("комиссия в доход обмена не входит — это другая статья", () => {
    const r = exchangeIncome(ctx(ACCS, [e("a4", "cr", 900)]), PERIOD, "all");
    expect(r.total).toBe(0);
    expect(r.hasData).toBe(false);
  });

  it("движения вне периода не считаются", () => {
    const r = exchangeIncome(ctx(ACCS, [e("a1", "cr", 500, "2026-08-15")]), PERIOD, "all");
    expect(r.hasData).toBe(false);
  });

  it("пустой леджер — не данные, а их отсутствие", () => {
    const r = exchangeIncome(ctx(ACCS, []), PERIOD, "all");
    expect(r).toMatchObject({ spread: 0, fx: 0, total: 0, hasData: false });
  });
});
