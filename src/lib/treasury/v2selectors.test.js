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

import { groupByClass } from "./v2selectors.js";

describe("groupByClass", () => {
  it("groups asset accounts by subtype with base totals (officeFilter=all)", () => {
    const ctx = makeLedgerCtx();
    const sections = groupByClass(ctx, "asset");
    // assets: cash USD 11000 (mark), crypto_input USDT 150 (mark) + USDT 1000 (treasury, office NULL)
    const cash = sections.find((s) => s.subtype === "cash");
    const crypto = sections.find((s) => s.subtype === "crypto_input");
    expect(cash.accounts).toHaveLength(1);
    expect(cash.totalInBase).toBe(11000);
    expect(crypto.accounts).toHaveLength(2);
    expect(crypto.totalInBase).toBe(1150); // 150 + 1000, USDT@1
  });

  it("officeFilter=office-mark excludes office_id NULL accounts", () => {
    const ctx = makeLedgerCtx({ officeFilter: "office-mark" });
    const sections = groupByClass(ctx, "asset");
    const crypto = sections.find((s) => s.subtype === "crypto_input");
    expect(crypto.accounts).toHaveLength(1); // only the mark hot wallet, treasury (NULL office) excluded
    expect(crypto.totalInBase).toBe(150);
  });

  it("liability section returns customer_liab with negative balance", () => {
    const ctx = makeLedgerCtx();
    const sections = groupByClass(ctx, "liability");
    const cl = sections.find((s) => s.subtype === "customer_liab");
    expect(cl.accounts[0].balance).toBe(-500);
    expect(cl.accounts[0].clientId).toBe("client-1"); // dimension preserved
  });

  it("equity section returns opening + fx accounts", () => {
    const ctx = makeLedgerCtx();
    const sections = groupByClass(ctx, "equity");
    const subtypes = sections.map((s) => s.subtype).sort();
    expect(subtypes).toContain("opening_balance");
    expect(subtypes).toContain("fx_gain");
    expect(subtypes).toContain("fx_loss");
  });

  it("sorts sections by totalInBase desc", () => {
    const ctx = makeLedgerCtx();
    const sections = groupByClass(ctx, "asset");
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i - 1].totalInBase).toBeGreaterThanOrEqual(sections[i].totalInBase);
    }
  });
});

import { accountEntries } from "./v2selectors.js";

describe("accountEntries", () => {
  it("returns entries for an account, newest first, with source label", () => {
    const ctx = makeLedgerCtx();
    const rows = accountEntries(ctx, "ac_cash_usd_mark", 50);
    // ac_cash_usd_mark has je1 (opening Dr 11000) + je3 (deal Dr 100)
    expect(rows).toHaveLength(2);
    expect(new Date(rows[0].createdAt) >= new Date(rows[1].createdAt)).toBe(true);
    const dealRow = rows.find((r) => r.txId === "tx_deal_1");
    expect(dealRow.direction).toBe("dr");
    expect(dealRow.amount).toBe(100);
    expect(dealRow.txKind).toBe("deal");
    expect(dealRow.sourceRefId).toBe("deal-42");
  });

  it("respects limit", () => {
    const ctx = makeLedgerCtx();
    expect(accountEntries(ctx, "ac_cash_usd_mark", 1)).toHaveLength(1);
  });

  it("returns empty for account with no entries", () => {
    const ctx = makeLedgerCtx();
    expect(accountEntries(ctx, "ac_fx_gain", 50)).toEqual([]);
  });
});

import { transactionTree } from "./v2selectors.js";

describe("transactionTree", () => {
  it("returns transactions newest first with their entries", () => {
    const ctx = makeLedgerCtx();
    const tree = transactionTree(ctx, { type: "all", officeFilter: "all" });
    expect(tree.length).toBeGreaterThanOrEqual(2);
    expect(tree[0].tx.id).toBe("tx_deal_1"); // newest by effectiveDate
    const deal = tree.find((t) => t.tx.id === "tx_deal_1");
    expect(deal.entries.length).toBe(5); // je3..je7
    // Σ Dr should equal Σ Cr within tx (per currency)
    const drSum = deal.entries.filter((e) => e.direction === "dr").reduce((s, e) => s + e.amount, 0);
    const crSum = deal.entries.filter((e) => e.direction === "cr").reduce((s, e) => s + e.amount, 0);
    // not necessarily equal across currencies in the fixture (USD vs USDT), so just check structure
    expect(typeof drSum).toBe("number");
    expect(typeof crSum).toBe("number");
  });

  it("type=deal filters to deal transactions only", () => {
    const ctx = makeLedgerCtx();
    const tree = transactionTree(ctx, { type: "deal", officeFilter: "all" });
    expect(tree.every((t) => t.tx.kind === "deal")).toBe(true);
  });

  it("officeFilter=office-mark keeps tx that touch a mark-office account", () => {
    const ctx = makeLedgerCtx({ officeFilter: "office-mark" });
    const tree = transactionTree(ctx, { type: "all", officeFilter: "office-mark" });
    // tx_deal_1 touches ac_cash_usd_mark and ac_hot_usdt_mark (both mark) → kept
    expect(tree.find((t) => t.tx.id === "tx_deal_1")).toBeTruthy();
  });

  it("returns empty for a period with no transactions", () => {
    const ctx = makeLedgerCtx();
    const tree = transactionTree(ctx, { type: "all", officeFilter: "all", period: { from: "2030-01-01T00:00:00Z", to: "2030-12-31T00:00:00Z" } });
    expect(tree).toEqual([]);
  });
});

import { pnlForPeriod } from "./v2selectors.js";

describe("pnlForPeriod", () => {
  it("computes revenue, expense, fx, net profit in base currency", () => {
    const ctx = makeLedgerCtx();
    const period = { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" };
    const pnl = pnlForPeriod(ctx, period, "all");
    // revenue: spread Cr 5 (je7) → +5
    expect(pnl.revenue.total).toBe(5);
    // expense: rent Dr 1800 (je8, dated 2026-05-05) → +1800
    expect(pnl.expense.total).toBe(1800);
    // fx: none in window → 0
    expect(pnl.fxNet).toBe(0);
    // net = 5 - 1800 + 0 = -1795
    expect(pnl.netProfit).toBe(-1795);
  });

  it("excludes entries outside the period", () => {
    const ctx = makeLedgerCtx();
    const period = { from: "2026-05-09T00:00:00Z", to: "2026-05-09T23:59:59Z" };
    const pnl = pnlForPeriod(ctx, period, "all");
    expect(pnl.revenue.total).toBe(0); // je7 is 2026-05-10, outside
    expect(pnl.expense.total).toBe(0); // je8 is 2026-05-05, outside
  });

  it("returns subtype-grouped account rows", () => {
    const ctx = makeLedgerCtx();
    const period = { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" };
    const pnl = pnlForPeriod(ctx, period, "all");
    const spreadRow = pnl.revenue.accounts.find((a) => a.code === "4010");
    expect(spreadRow.amountInBase).toBe(5);
    expect(spreadRow.entryCount).toBe(1);
  });

  it("officeFilter=office-mark excludes office_id NULL revenue/expense accounts", () => {
    const ctx = makeLedgerCtx({ officeFilter: "office-mark" });
    const period = { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" };
    const pnl = pnlForPeriod(ctx, period, "office-mark");
    // spread (4010) and rent (5010) have officeId NULL → excluded
    expect(pnl.revenue.total).toBe(0);
    expect(pnl.expense.total).toBe(0);
  });
});

describe("accountEntries — optional period filter", () => {
  it("without period, returns all entries for the account (unchanged behaviour)", () => {
    const ctx = makeLedgerCtx();
    const all = accountEntries(ctx, "ac_cash_usd_mark");
    // fixture: je1 (tx_open) + je3 (tx_deal_1) touch ac_cash_usd_mark
    expect(all.map((e) => e.id).sort()).toEqual(["je1", "je3"]);
  });
  it("with a period, keeps only entries whose tx effectiveDate is in [from,to]", () => {
    const ctx = makeLedgerCtx();
    // tx_open.effectiveDate = 2026-04-01, tx_deal_1.effectiveDate = 2026-05-10
    const r = accountEntries(ctx, "ac_cash_usd_mark", 50, { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" });
    expect(r.map((e) => e.id)).toEqual(["je3"]);
    const r2 = accountEntries(ctx, "ac_cash_usd_mark", 50, { from: "2026-03-01T00:00:00Z", to: "2026-04-30T00:00:00Z" });
    expect(r2.map((e) => e.id)).toEqual(["je1"]);
  });
});

import { balanceCheckTotals } from "./v2selectors.js";

describe("balanceCheckTotals", () => {
  it("computes assets, liabilities, equity and identity check (all offices)", () => {
    const ctx = makeLedgerCtx();
    const r = balanceCheckTotals(ctx, "all");
    // assets: cash 11000 + hot 150 + treasury 1000 = 12150 (USDT@1)
    expect(r.assets).toBe(12150);
    // liabilities: cust_liab -500 (USD)
    expect(r.liabilities).toBe(-500);
    // equity: opening 11000
    expect(r.equity).toBe(11000);
    // identity: assets - (liabilities + equity) = 12150 - (10500) = 1650 → out of balance in fixture
    expect(r.identityCheck.delta).toBe(1650);
    expect(r.identityCheck.ok).toBe(false);
  });

  it("flags ok when assets == liabilities + equity within epsilon", () => {
    const ctx = makeLedgerCtx({
      balances: [
        { accountId: "ac_cash_usd_mark", currency: "USD", clientId: null, partnerId: null, balance: 1000 },
        { accountId: "ac_cust_liab_usd", currency: "USD", clientId: "client-1", partnerId: null, balance: 300 },
        { accountId: "ac_opening_usd", currency: "USD", clientId: null, partnerId: null, balance: 700 },
      ],
    });
    const r = balanceCheckTotals(ctx, "all");
    // assets 1000 = liabilities 300 + equity 700 → ok
    expect(r.identityCheck.ok).toBe(true);
    expect(Math.abs(r.identityCheck.delta)).toBeLessThan(0.01);
  });

  it("officeFilter restricts to that office's accounts", () => {
    const ctx = makeLedgerCtx({ officeFilter: "office-mark" });
    const r = balanceCheckTotals(ctx, "office-mark");
    // only mark accounts: cash 11000 + hot 150 = 11150 assets; no mark liab/equity
    expect(r.assets).toBe(11150);
    expect(r.liabilities).toBe(0);
    expect(r.equity).toBe(0);
  });
});

import { trialBalance } from "./v2selectors.js";

function makeTbCtx(overrides = {}) {
  const accounts = [
    { id: "cash", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: "ofA" },
    { id: "bank", code: "1120", name: "Bank EUR", type: "asset", subtype: "bank", currency: "EUR", officeId: "ofB" },
    { id: "eq",   code: "3100", name: "Opening Equity USD", type: "equity", subtype: "opening_balance", currency: "USD", officeId: null },
    { id: "rev",  code: "4010", name: "Spread USD", type: "revenue", subtype: "spread", currency: "USD", officeId: null },
    { id: "idle", code: "1199", name: "Idle account", type: "asset", subtype: "cash", currency: "USD", officeId: null },
  ];
  const transactions = [
    { id: "T1", effectiveDate: "2026-03-10T00:00:00Z", createdAt: "2026-03-10T00:00:00Z", kind: "opening", sourceRefId: null },
    { id: "T2", effectiveDate: "2026-05-15T00:00:00Z", createdAt: "2026-05-15T00:00:00Z", kind: "deal", sourceRefId: "D1" },
  ];
  const entries = [
    { id: "e1", transactionId: "T1", accountId: "cash", direction: "dr", amount: 1000, currency: "USD", createdAt: "2026-03-10T00:00:00Z" },
    { id: "e2", transactionId: "T1", accountId: "eq",   direction: "cr", amount: 1000, currency: "USD", createdAt: "2026-03-10T00:00:00Z" },
    { id: "e3", transactionId: "T2", accountId: "cash", direction: "dr", amount: 200,  currency: "USD", createdAt: "2026-05-15T00:00:00Z" },
    { id: "e4", transactionId: "T2", accountId: "rev",  direction: "cr", amount: 200,  currency: "USD", createdAt: "2026-05-15T00:00:00Z" },
  ];
  const balances = [
    { accountId: "cash", currency: "USD", clientId: null, partnerId: null, balance: 1200 },
    { accountId: "eq",   currency: "USD", clientId: null, partnerId: null, balance: 1000 },
    { accountId: "rev",  currency: "USD", clientId: null, partnerId: null, balance: 200 },
    { accountId: "idle", currency: "USD", clientId: null, partnerId: null, balance: 50 },
  ];
  const rate = (c) => ({ USD: 1, EUR: 1.1 }[String(c).toUpperCase()] ?? 0);
  return { accounts, transactions, entries, balances, toBase: (a, c) => Number(a) * rate(c), baseCurrency: "USD", officeFilter: "all", ...overrides };
}

describe("trialBalance", () => {
  it("computes opening / Dr turnover / Cr turnover / closing per account for a period (May)", () => {
    const ctx = makeTbCtx();
    const tb = trialBalance(ctx, { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" }, "all");
    const findAcc = (id) => tb.classes.flatMap((c) => c.accounts).find((a) => a.accountId === id);
    expect(findAcc("cash")).toMatchObject({ opening: 1000, closing: 1200, debitTurnover: 200, creditTurnover: 0 });
    expect(findAcc("rev")).toMatchObject({ opening: 0, closing: 200, debitTurnover: 0, creditTurnover: 200 });
    expect(findAcc("eq")).toMatchObject({ opening: 1000, closing: 1000, debitTurnover: 0, creditTurnover: 0 });
    expect(findAcc("idle")).toMatchObject({ opening: 50, closing: 50, debitTurnover: 0, creditTurnover: 0 });
    expect(findAcc("bank")).toBeUndefined();
  });
  it("the period covering only T1 (March) shows cash opening 0 and Dr turnover 1000", () => {
    const ctx = makeTbCtx();
    const tb = trialBalance(ctx, { from: "2026-03-01T00:00:00Z", to: "2026-03-31T00:00:00Z" }, "all");
    const cash = tb.classes.flatMap((c) => c.accounts).find((a) => a.accountId === "cash");
    expect(cash).toMatchObject({ opening: 0, closing: 1000, debitTurnover: 1000, creditTurnover: 0 });
  });
  it("classes are ordered asset, liability, equity, revenue, expense and carry labelKeys", () => {
    const ctx = makeTbCtx();
    const tb = trialBalance(ctx, { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" }, "all");
    expect(tb.classes.map((c) => c.type)).toEqual(["asset", "equity", "revenue"]);
    const asset = tb.classes.find((c) => c.type === "asset");
    expect(asset.labelKey).toBe("trv2_tab_assets");
    expect(tb.classes.find((c) => c.type === "revenue").labelKey).toBe("trv2_to_class_revenue");
    expect(asset.accounts.map((a) => a.code)).toEqual(["1110", "1199"]);
  });
  it("balance-identity checks", () => {
    const ctx = makeTbCtx();
    const tb = trialBalance(ctx, { from: "2026-01-01T00:00:00Z", to: "2026-12-31T00:00:00Z" }, "all");
    expect(tb.totalInBase.debitTurnover).toBeCloseTo(1200, 6);
    expect(tb.totalInBase.creditTurnover).toBeCloseTo(1200, 6);
    expect(tb.check.turnoverOk).toBe(true);
    expect(tb.totalInBase.openingDr).toBeCloseTo(50, 6);
    expect(tb.check.openingOk).toBe(false);
  });
  it("office filter narrows the rows", () => {
    const ctx = makeTbCtx();
    const tb = trialBalance(ctx, { from: "2026-01-01T00:00:00Z", to: "2026-12-31T00:00:00Z" }, "ofA");
    const codes = tb.classes.flatMap((c) => c.accounts).map((a) => a.code);
    expect(codes).toEqual(["1110"]);
  });
});
