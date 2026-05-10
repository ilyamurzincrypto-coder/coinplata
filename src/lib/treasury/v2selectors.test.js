// src/lib/treasury/v2selectors.test.js
import { describe, it, expect } from "vitest";

export function makeLedgerCtx(overrides = {}) {
  const NOW = new Date("2026-05-10T12:00:00Z");
  const accounts = [
    { id: "ac_cash_usd_mark", code: "1110", name: "Cash · Mark Antalya · USD", type: "asset", subtype: "cash", currency: "USD", officeId: "office-mark", clientDimRequired: false, partnerDimRequired: false },
    { id: "ac_hot_usdt_mark", code: "1316", name: "Hot · USDT TRC20 · Mark", type: "asset", subtype: "crypto_input", currency: "USDT", officeId: "office-mark", clientDimRequired: false, partnerDimRequired: false },
    { id: "ac_treasury_usdt", code: "1340", name: "Treasury · USDT TRC20", type: "asset", subtype: "crypto_input", currency: "USDT", officeId: null, clientDimRequired: false, partnerDimRequired: false },
    { id: "ac_cust_liab_usd", code: "2110", name: "Customer Liab · USD", type: "liability", subtype: "customer_liab", currency: "USD", officeId: null, clientDimRequired: true, partnerDimRequired: false },
    { id: "ac_opening_usd", code: "3100", name: "Opening Balance Equity · USD", type: "equity", subtype: "opening_balance", currency: "USD", officeId: null, clientDimRequired: false, partnerDimRequired: false },
    { id: "ac_spread_usd", code: "4010", name: "Spread · USD", type: "revenue", subtype: "spread", currency: "USD", officeId: null, clientDimRequired: false, partnerDimRequired: false },
    { id: "ac_rent_usd", code: "5010", name: "Office rent · USD", type: "expense", subtype: "rent", currency: "USD", officeId: null, clientDimRequired: false, partnerDimRequired: false },
    { id: "ac_fx_gain", code: "3210", name: "FX gain · USD", type: "equity", subtype: "fx_gain", currency: "USD", officeId: null, clientDimRequired: false, partnerDimRequired: false },
    { id: "ac_fx_loss", code: "3220", name: "FX loss · USD", type: "equity", subtype: "fx_loss", currency: "USD", officeId: null, clientDimRequired: false, partnerDimRequired: false },
  ];
  const balances = [
    { accountId: "ac_cash_usd_mark", currency: "USD", clientId: null, partnerId: null, balance: 11000 },
    { accountId: "ac_hot_usdt_mark", currency: "USDT", clientId: null, partnerId: null, balance: 150 },
    { accountId: "ac_treasury_usdt", currency: "USDT", clientId: null, partnerId: null, balance: 1000 },
    { accountId: "ac_cust_liab_usd", currency: "USD", clientId: "client-1", partnerId: null, balance: -500 },
    { accountId: "ac_opening_usd", currency: "USD", clientId: null, partnerId: null, balance: 11000 },
  ];
  const transactions = [
    { id: "tx_open", effectiveDate: "2026-04-01T00:00:00Z", createdAt: "2026-04-01T00:00:00Z", kind: "opening", sourceRefId: null, reversesTransactionId: null, metadata: {} },
    { id: "tx_deal_1", effectiveDate: "2026-05-10T10:00:00Z", createdAt: "2026-05-10T10:00:00Z", kind: "deal", sourceRefId: "deal-42", reversesTransactionId: null, metadata: { client_nickname: "Иван Петров" } },
  ];
  const entries = [
    // opening tx: Dr cash 11000, Cr opening 11000
    { id: "je1", transactionId: "tx_open", accountId: "ac_cash_usd_mark", direction: "dr", amount: 11000, currency: "USD", clientId: null, partnerId: null, note: "opening", createdAt: "2026-04-01T00:00:00Z" },
    { id: "je2", transactionId: "tx_open", accountId: "ac_opening_usd", direction: "cr", amount: 11000, currency: "USD", clientId: null, partnerId: null, note: "opening", createdAt: "2026-04-01T00:00:00Z" },
    // deal tx: Dr cash 100, Cr cust_liab 100, Dr cust_liab 95 (USDT eq), Cr hot 95, Cr spread 5
    { id: "je3", transactionId: "tx_deal_1", accountId: "ac_cash_usd_mark", direction: "dr", amount: 100, currency: "USD", clientId: null, partnerId: null, note: "", createdAt: "2026-05-10T10:00:00Z" },
    { id: "je4", transactionId: "tx_deal_1", accountId: "ac_cust_liab_usd", direction: "cr", amount: 100, currency: "USD", clientId: "client-1", partnerId: null, note: "", createdAt: "2026-05-10T10:00:00Z" },
    { id: "je5", transactionId: "tx_deal_1", accountId: "ac_cust_liab_usd", direction: "dr", amount: 95, currency: "USD", clientId: "client-1", partnerId: null, note: "USDT eq", createdAt: "2026-05-10T10:00:00Z" },
    { id: "je6", transactionId: "tx_deal_1", accountId: "ac_hot_usdt_mark", direction: "cr", amount: 95, currency: "USDT", clientId: null, partnerId: null, note: "", createdAt: "2026-05-10T10:00:00Z" },
    { id: "je7", transactionId: "tx_deal_1", accountId: "ac_spread_usd", direction: "cr", amount: 5, currency: "USD", clientId: null, partnerId: null, note: "margin", createdAt: "2026-05-10T10:00:00Z" },
    // an expense entry last month
    { id: "je8", transactionId: "tx_open", accountId: "ac_rent_usd", direction: "dr", amount: 1800, currency: "USD", clientId: null, partnerId: null, note: "rent", createdAt: "2026-05-05T00:00:00Z" },
  ];
  const rate = (cur) => ({ USD: 1, USDT: 1, TRY: 0.03 }[String(cur).toUpperCase()] ?? 0);
  const toBase = (amount, cur) => Number(amount) * rate(cur);
  return {
    accounts, balances, transactions, entries,
    toBase, baseCurrency: "USD",
    officeFilter: "all",
    now: () => NOW,
    ...overrides,
  };
}

describe("makeLedgerCtx fixture sanity", () => {
  it("has chart of accounts spanning all 5 classes", () => {
    const ctx = makeLedgerCtx();
    const types = new Set(ctx.accounts.map((a) => a.type));
    expect(types).toEqual(new Set(["asset", "liability", "equity", "revenue", "expense"]));
  });
});
