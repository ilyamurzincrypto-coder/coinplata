// Слайс 1.5.d: знаковый канон CP PAY в capitalByCurrency.
import { describe, it, expect } from "vitest";
import { capitalByCurrency } from "./v2selectors.js";

const ctx = {
  accounts: [
    { id: "a1", type: "asset", currency: "USD" },
    { id: "l1", type: "liability", currency: "USD" },
    { id: "l2", type: "liability", currency: "EUR" },
    { id: "e1", type: "equity", currency: "USD" }, // не должен попасть в панель
  ],
  balances: [
    { accountId: "a1", currency: "USD", balance: 100 },
    { accountId: "l1", currency: "USD", balance: 30 },   // клиент держит → Лоро +
    { accountId: "l2", currency: "EUR", balance: -8 },   // должник → Лоро −
    { accountId: "e1", currency: "USD", balance: 999 },
  ],
  officeFilter: "all",
  toBase: (a, c) => (Number(a) || 0) * (c === "EUR" ? 1.1 : 1),
};

describe("capitalByCurrency — знаки CP PAY (Лоро=+raw, Капитал=Ностро−Лоро)", () => {
  const byC = Object.fromEntries(capitalByCurrency(ctx).map((r) => [r.currency, r]));
  it("Лоро = +raw когда клиент держит", () => expect(byC.USD.loro).toBe(30));
  it("Лоро отрицательный когда должник", () => expect(byC.EUR.loro).toBe(-8));
  it("Капитал = Ностро − Лоро", () => {
    expect(byC.USD.capital).toBe(70); // 100 − 30
    expect(byC.EUR.capital).toBe(8);  // 0 − (−8)
  });
  it("capitalBase приведён", () => expect(byC.EUR.capitalBase).toBeCloseTo(8 * 1.1));
  it("equity в панель не попадает (только asset/liability)", () => expect(Object.keys(byC).sort()).toEqual(["EUR", "USD"]));
});
