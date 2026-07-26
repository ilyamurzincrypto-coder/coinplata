// Слайс 1.5.f: логика карточки клиента — порядок/объединение/знаки/пометка.
import { describe, it, expect } from "vitest";
import { clientLedgerRows } from "./v2selectors.js";

const CID = "c1";
const ctx = {
  accounts: [
    { id: "clUSD", type: "liability", subtype: "customer_liab", currency: "USD" },
    { id: "clEUR", type: "liability", subtype: "customer_liab", currency: "EUR" },
    { id: "clTRY", type: "liability", subtype: "customer_liab", currency: "TRY" },
    { id: "clRUB", type: "liability", subtype: "customer_liab", currency: "RUB" },
  ],
  balances: [
    { accountId: "clUSD", clientId: CID, currency: "USD", balance: 500 },   // держит → +
    { accountId: "clEUR", clientId: CID, currency: "EUR", balance: -80 },   // должник → −
    { accountId: "clTRY", clientId: CID, currency: "TRY", balance: 0 },     // открыт, пуст
    { accountId: "clRUB", clientId: CID, currency: "RUB", balance: 12000 }, // НЕ открыт, но остаток есть (легаси)
    { accountId: "clUSD", clientId: "other", currency: "USD", balance: 999 }, // чужой клиент — игнор
  ],
};
// открыты клиенту: USD, EUR, TRY (RUB — нет)
const rows = clientLedgerRows(ctx, CID, ["USD", "EUR", "TRY"], "USD");

describe("clientLedgerRows — карточка клиента 1.5.f", () => {
  it("порядок: база (USD) первой, дальше по коду — НЕ по остатку", () => {
    expect(rows.map((r) => r.currency)).toEqual(["USD", "EUR", "RUB", "TRY"]);
  });
  it("знаки +raw: держит → +, должник → −", () => {
    expect(rows.find((r) => r.currency === "USD").balance).toBe(500);
    expect(rows.find((r) => r.currency === "EUR").balance).toBe(-80);
  });
  it("открытая нулевая валюта показана (счёт открыт, пуст)", () => {
    const try_ = rows.find((r) => r.currency === "TRY");
    expect(try_).toBeTruthy();
    expect(try_.balance).toBe(0);
    expect(try_.opened).toBe(true);
  });
  it("не-открытая, но с остатком — показана с пометкой notOpened (деньги не прячем)", () => {
    const rub = rows.find((r) => r.currency === "RUB");
    expect(rub.balance).toBe(12000);
    expect(rub.notOpened).toBe(true);
  });
  it("чужой клиент в остаток не попадает", () => {
    expect(rows.find((r) => r.currency === "USD").balance).toBe(500); // не 500+999
  });
});
