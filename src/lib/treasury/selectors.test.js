// src/lib/treasury/selectors.test.js
import { describe, it, expect } from "vitest";

// Fixture builder. One office "mark" with 3 accounts (cash USD, bank TRY,
// crypto USDT). Mirrors store/data.js seed structure. Includes one
// non-mark account to verify office-filter.
export function makeCtx(overrides = {}) {
  const NOW = new Date("2026-05-09T12:00:00Z");
  const yesterday = new Date(NOW.getTime() - 26 * 3600 * 1000); // > 24h ago
  const accounts = [
    { id: "a_mark_cash_usd",   officeId: "mark",  type: "cash",   currency: "USD",  name: "Cash USD",  active: true, balance: 1000  },
    { id: "a_mark_bank_try",   officeId: "mark",  type: "bank",   currency: "TRY",  name: "Bank TRY",  active: true, balance: 50000 },
    { id: "a_mark_crypto_usdt",officeId: "mark",  type: "crypto", currency: "USDT", name: "TRC20",     active: true, balance: 500   },
    { id: "a_other_cash_usd",  officeId: "terra", type: "cash",   currency: "USD",  name: "Other Cash",active: true, balance: 9999  },
  ];
  const movements = [
    { id: "m1", accountId: "a_mark_cash_usd",    amount: 1000,  direction: "in",  currency: "USD",  reserved: false, source: { kind: "opening" }, timestamp: yesterday.toISOString() },
    { id: "m2", accountId: "a_mark_bank_try",    amount: 50000, direction: "in",  currency: "TRY",  reserved: false, source: { kind: "opening" }, timestamp: yesterday.toISOString() },
    { id: "m3", accountId: "a_mark_crypto_usdt", amount: 500,   direction: "in",  currency: "USDT", reserved: false, source: { kind: "opening" }, timestamp: yesterday.toISOString() },
    { id: "m4", accountId: "a_mark_cash_usd",    amount: 100,   direction: "out", currency: "USD",  reserved: true,  source: { kind: "exchange_out", refId: "tx1" }, timestamp: NOW.toISOString() },
  ];
  // balanceOf semantics from CLAUDE.md "Balance engine":
  //   balanceOf = Σ signed amounts where reserved=false
  //   reservedOf = Σ OUT movements where reserved=true
  const balanceOf = (id) =>
    movements
      .filter((m) => m.accountId === id && !m.reserved)
      .reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
  const reservedOf = (id) =>
    movements
      .filter((m) => m.accountId === id && m.reserved && m.direction === "out")
      .reduce((s, m) => s + m.amount, 0);
  const obligations = [
    { id: "o1", officeId: "mark", currency: "USD", amount: 200, direction: "we_owe", status: "open", createdAt: yesterday.toISOString() },
  ];
  const transactions = [
    { id: "tx1", officeId: "mark", status: "pending", time: "11:00", date: "May 9", createdAt: NOW.toISOString() },
  ];
  // Simple rate function: USD=base, TRY=0.03 USD, USDT=1 USD, EUR=1.1 USD
  const rate = (from) => ({ USD: 1, TRY: 0.03, USDT: 1, EUR: 1.1 }[String(from).toUpperCase()] ?? 0);
  const toBase = (amount, from) => Number(amount) * rate(from);

  return {
    officeId: "mark",
    accounts,
    movements,
    obligations,
    transactions,
    rates: [],
    lastConfirmedAt: NOW.toISOString(),
    modifiedAfterConfirmation: false,
    balanceOf,
    reservedOf,
    toBase,
    baseCurrency: "USD",
    now: () => NOW,
    ...overrides,
  };
}

describe("makeCtx fixture sanity", () => {
  it("balanceOf computes from non-reserved movements", () => {
    const ctx = makeCtx();
    expect(ctx.balanceOf("a_mark_cash_usd")).toBe(1000);
    expect(ctx.reservedOf("a_mark_cash_usd")).toBe(100);
  });

  it("balanceOf for non-existent account is 0", () => {
    const ctx = makeCtx();
    expect(ctx.balanceOf("missing")).toBe(0);
    expect(ctx.reservedOf("missing")).toBe(0);
  });
});
