// src/lib/treasury/selectors.test.js
import { describe, it, expect } from "vitest";
import { groupByCurrency } from "./selectors.js";
import { groupByAccountType } from "./selectors.js";
import { lastNMovements } from "./selectors.js";
import { computeKPIs } from "./selectors.js";
import { computeAlerts } from "./selectors.js";

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

describe("groupByCurrency", () => {
  it("groups office accounts, sorted by totalInBase desc", () => {
    const ctx = makeCtx();
    const rows = groupByCurrency(ctx);
    // USD total = 1000 (balanceOf includes reserved-source amount but not reserved-marked).
    // Wait: m1 in 1000 (reserved=false) → +1000. m4 out 100 (reserved=true) → excluded by balanceOf.
    // So balanceOf(a_mark_cash_usd) = 1000.
    // toBase: USD 1000→1000, TRY 50000→1500, USDT 500→500.
    // Sorted: TRY (1500) > USD (1000) > USDT (500).
    expect(rows).toHaveLength(3);
    expect(rows[0].currency).toBe("TRY");
    expect(rows[0].totalInBase).toBe(1500);
    expect(rows[0].available).toBe(50000);
    expect(rows[0].reserved).toBe(0);
    expect(rows[0].total).toBe(50000);
    expect(rows[1].currency).toBe("USD");
    expect(rows[1].available).toBe(900);
    expect(rows[1].reserved).toBe(100);
    expect(rows[1].total).toBe(1000);
    expect(rows[2].currency).toBe("USDT");
  });

  it("filters by officeId — does not leak terra account", () => {
    const ctx = makeCtx();
    const rows = groupByCurrency(ctx);
    // If officeId filter were broken, USD total would be 1000 + 9999 = 10999.
    expect(rows.find((r) => r.currency === "USD").total).toBe(1000);
  });

  it("returns empty array if office has no accounts", () => {
    const ctx = makeCtx({ officeId: "nonexistent" });
    expect(groupByCurrency(ctx)).toEqual([]);
  });

  it("normalizes currency case", () => {
    const ctx = makeCtx({
      accounts: [
        { id: "a1", officeId: "mark", type: "cash", currency: "usd", balance: 100 },
        { id: "a2", officeId: "mark", type: "cash", currency: "USD", balance: 100 },
      ],
      movements: [
        { id: "m1", accountId: "a1", amount: 100, direction: "in", reserved: false, timestamp: new Date().toISOString() },
        { id: "m2", accountId: "a2", amount: 100, direction: "in", reserved: false, timestamp: new Date().toISOString() },
      ],
    });
    // Re-bind balanceOf to new movements
    ctx.balanceOf = (id) => ctx.movements.filter((m) => m.accountId === id && !m.reserved).reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
    ctx.reservedOf = () => 0;
    const rows = groupByCurrency(ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe("USD");
    expect(rows[0].total).toBe(200);
  });
});

describe("groupByAccountType", () => {
  it("groups office accounts by type with counts and base totals", () => {
    const ctx = makeCtx();
    const rows = groupByAccountType(ctx);
    // 3 mark accounts: 1 cash (USD 1000), 1 bank (TRY 50000), 1 crypto (USDT 500).
    // toBase: cash 1000, bank 1500, crypto 500. Sorted by totalInBase desc.
    expect(rows).toHaveLength(3);
    const types = rows.map((r) => r.type);
    expect(types).toEqual(["bank", "cash", "crypto"]);
    const cash = rows.find((r) => r.type === "cash");
    expect(cash.count).toBe(1);
    expect(cash.totalInBase).toBe(1000);
    expect(cash.total).toBe(1000);
    expect(cash.reserved).toBe(100);
    expect(cash.available).toBe(900);
  });

  it("hides empty types (no accounts of that type)", () => {
    const ctx = makeCtx({
      accounts: [
        { id: "a1", officeId: "mark", type: "cash", currency: "USD", balance: 100 },
      ],
      movements: [
        { id: "m1", accountId: "a1", amount: 100, direction: "in", reserved: false, timestamp: new Date().toISOString() },
      ],
    });
    ctx.balanceOf = (id) => ctx.movements.filter((m) => m.accountId === id && !m.reserved).reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
    ctx.reservedOf = () => 0;
    const rows = groupByAccountType(ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("cash");
  });

  it("buckets unknown type as 'other'", () => {
    const ctx = makeCtx({
      accounts: [
        { id: "a1", officeId: "mark", type: "weird_type", currency: "USD", balance: 100 },
      ],
      movements: [
        { id: "m1", accountId: "a1", amount: 100, direction: "in", reserved: false, timestamp: new Date().toISOString() },
      ],
    });
    ctx.balanceOf = (id) => ctx.movements.filter((m) => m.accountId === id && !m.reserved).reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
    ctx.reservedOf = () => 0;
    const rows = groupByAccountType(ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("other");
  });
});

describe("lastNMovements", () => {
  it("returns office movements sorted desc, limited to N", () => {
    const ctx = makeCtx();
    // 4 movements total, all 3 'mark' accounts have movements.
    // Expect 4 rows (m4 newest, m3/m2/m1 yesterday — sort by timestamp desc).
    const rows = lastNMovements(ctx, 50);
    expect(rows).toHaveLength(4);
    expect(rows[0].id).toBe("m4");
  });

  it("filters out movements for other-office accounts", () => {
    const ctx = makeCtx({
      movements: [
        ...makeCtx().movements,
        { id: "m_other", accountId: "a_other_cash_usd", amount: 1, direction: "in", reserved: false, timestamp: "2027-01-01T00:00:00Z" },
      ],
    });
    const rows = lastNMovements(ctx, 50);
    expect(rows.find((m) => m.id === "m_other")).toBeUndefined();
  });

  it("limits to N", () => {
    const ctx = makeCtx();
    expect(lastNMovements(ctx, 2)).toHaveLength(2);
  });

  it("attaches account name for display", () => {
    const ctx = makeCtx();
    const rows = lastNMovements(ctx, 1);
    expect(rows[0].accountName).toBeDefined();
    expect(typeof rows[0].accountName).toBe("string");
  });
});

describe("computeKPIs", () => {
  it("totalBalance = Σ balanceOf in base over office accounts", () => {
    const ctx = makeCtx();
    const k = computeKPIs(ctx);
    // toBase: USD 1000 + TRY 1500 + USDT 500 = 3000.
    expect(k.totalBalance.valueInBase).toBe(3000);
  });

  it("liabilities = Σ open we_owe obligations in base", () => {
    const ctx = makeCtx();
    const k = computeKPIs(ctx);
    // 200 USD we_owe → 200 in base.
    expect(k.liabilities.valueInBase).toBe(200);
  });

  it("availableFunds = Σ availableOf in base", () => {
    const ctx = makeCtx();
    const k = computeKPIs(ctx);
    // USD: 1000 - 100 reserved = 900. TRY 50000-0 = 50000 (1500 base). USDT 500-0 = 500.
    // Total available in base: 900 + 1500 + 500 = 2900.
    expect(k.availableFunds.valueInBase).toBe(2900);
  });

  it("activity24h counts office transactions in last 24h", () => {
    const ctx = makeCtx();
    const k = computeKPIs(ctx);
    // tx1 created NOW → within 24h → count = 1.
    expect(k.activity24h.count).toBe(1);
  });

  it("filters all by officeId", () => {
    const ctx = makeCtx({ officeId: "terra" });
    const k = computeKPIs(ctx);
    // Only a_other_cash_usd exists for terra, but no movements for it in fixture.
    expect(k.totalBalance.valueInBase).toBe(0);
    expect(k.liabilities.valueInBase).toBe(0);
    expect(k.availableFunds.valueInBase).toBe(0);
    expect(k.activity24h.count).toBe(0);
  });

  it("baseCurrency is propagated", () => {
    const ctx = makeCtx();
    expect(computeKPIs(ctx).baseCurrency).toBe("USD");
  });
});

describe("computeKPIs deltas", () => {
  it("delta is computed against yesterday's balances", () => {
    // Custom fixture: yesterday total = 500 (1 movement for 500 yesterday),
    // today add another 500 → today total = 1000.
    const NOW = new Date("2026-05-09T12:00:00Z");
    const yesterday = new Date(NOW.getTime() - 26 * 3600 * 1000);
    const accounts = [
      { id: "a1", officeId: "mark", type: "cash", currency: "USD", balance: 0 },
    ];
    const movements = [
      { id: "m_old",  accountId: "a1", amount: 500, direction: "in", currency: "USD", reserved: false, timestamp: yesterday.toISOString() },
      { id: "m_new",  accountId: "a1", amount: 500, direction: "in", currency: "USD", reserved: false, timestamp: NOW.toISOString() },
    ];
    const balanceOf = (id) => movements.filter((m) => m.accountId === id && !m.reserved).reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
    const ctx = makeCtx({
      accounts,
      movements,
      balanceOf,
      reservedOf: () => 0,
      obligations: [],
      transactions: [],
    });
    const k = computeKPIs(ctx);
    expect(k.totalBalance.valueInBase).toBe(1000);
    expect(k.totalBalance.delta).toBeCloseTo(1.0); // (1000-500)/500 = 1.0 (= +100%)
  });

  it("delta is null if yesterday baseline is 0", () => {
    const NOW = new Date("2026-05-09T12:00:00Z");
    const accounts = [{ id: "a1", officeId: "mark", type: "cash", currency: "USD", balance: 0 }];
    const movements = [
      { id: "m1", accountId: "a1", amount: 100, direction: "in", currency: "USD", reserved: false, timestamp: NOW.toISOString() },
    ];
    const ctx = makeCtx({
      accounts,
      movements,
      balanceOf: (id) => movements.filter((m) => m.accountId === id && !m.reserved).reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0),
      reservedOf: () => 0,
      obligations: [],
      transactions: [],
    });
    expect(computeKPIs(ctx).totalBalance.delta).toBeNull();
  });

  it("activity24h delta is absolute count delta vs prior 24-48h window", () => {
    const NOW = new Date("2026-05-09T12:00:00Z");
    const sixHrAgo = new Date(NOW.getTime() - 6 * 3600 * 1000).toISOString();
    const thirtyHrAgo = new Date(NOW.getTime() - 30 * 3600 * 1000).toISOString();
    const ctx = makeCtx({
      transactions: [
        { id: "t1", officeId: "mark", status: "completed", createdAt: sixHrAgo },
        { id: "t2", officeId: "mark", status: "completed", createdAt: sixHrAgo },
        { id: "t3", officeId: "mark", status: "completed", createdAt: thirtyHrAgo },
      ],
      obligations: [],
      accounts: [],
      movements: [],
      balanceOf: () => 0,
      reservedOf: () => 0,
    });
    // last 24h: t1, t2 → count=2. prior 24-48h: t3 → 1. delta = 2-1 = 1.
    const k = computeKPIs(ctx);
    expect(k.activity24h.count).toBe(2);
    expect(k.activity24h.delta).toBe(1);
  });
});

describe("computeAlerts", () => {
  it("returns empty when nothing is wrong", () => {
    const NOW = new Date("2026-05-09T12:00:00Z");
    const ctx = makeCtx({
      obligations: [],
      transactions: [],
      lastConfirmedAt: NOW.toISOString(),
      modifiedAfterConfirmation: false,
      accounts: [{ id: "a1", officeId: "mark", type: "cash", currency: "USD", balance: 100 }],
      movements: [{ id: "m1", accountId: "a1", amount: 100, direction: "in", currency: "USD", reserved: false, timestamp: NOW.toISOString() }],
    });
    ctx.balanceOf = (id) => ctx.movements.filter((m) => m.accountId === id && !m.reserved).reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
    ctx.reservedOf = () => 0;
    expect(computeAlerts(ctx)).toEqual([]);
  });

  it("emits overdue_obligations when open obligations are > 7 days old", () => {
    const NOW = new Date("2026-05-09T12:00:00Z");
    const oldDate = new Date(NOW.getTime() - 8 * 24 * 3600 * 1000).toISOString();
    const ctx = makeCtx({
      obligations: [
        { id: "o1", officeId: "mark", currency: "USD", amount: 100, direction: "we_owe", status: "open", createdAt: oldDate },
        { id: "o2", officeId: "mark", currency: "USD", amount: 50,  direction: "we_owe", status: "open", createdAt: oldDate },
      ],
      transactions: [],
      modifiedAfterConfirmation: false,
    });
    const a = computeAlerts(ctx);
    const overdue = a.find((x) => x.id === "overdue_obligations");
    expect(overdue).toBeDefined();
    expect(overdue.severity).toBe("error");
    expect(overdue.count).toBe(2);
  });

  it("emits negative_balance for accounts with balanceOf < 0", () => {
    const ctx = makeCtx({
      accounts: [{ id: "a_neg", officeId: "mark", type: "cash", currency: "USD", balance: 0 }],
      movements: [{ id: "m_out", accountId: "a_neg", amount: 50, direction: "out", currency: "USD", reserved: false, timestamp: new Date().toISOString() }],
      obligations: [],
      transactions: [],
      modifiedAfterConfirmation: false,
    });
    ctx.balanceOf = (id) => ctx.movements.filter((m) => m.accountId === id && !m.reserved).reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
    ctx.reservedOf = () => 0;
    const a = computeAlerts(ctx);
    expect(a.find((x) => x.id === "negative_balance")?.count).toBe(1);
  });

  it("emits stuck_pending for pending tx older than 24h", () => {
    const NOW = new Date("2026-05-09T12:00:00Z");
    const oldTs = new Date(NOW.getTime() - 26 * 3600 * 1000).toISOString();
    const ctx = makeCtx({
      transactions: [
        { id: "t_stuck", officeId: "mark", status: "pending", createdAt: oldTs },
        { id: "t_fresh", officeId: "mark", status: "pending", createdAt: NOW.toISOString() },
      ],
      obligations: [],
      accounts: [],
      movements: [],
      balanceOf: () => 0,
      reservedOf: () => 0,
      modifiedAfterConfirmation: false,
    });
    const a = computeAlerts(ctx);
    expect(a.find((x) => x.id === "stuck_pending")?.count).toBe(1);
  });

  it("emits stale_rates when modifiedAfterConfirmation=true", () => {
    const ctx = makeCtx({
      modifiedAfterConfirmation: true,
      obligations: [],
      transactions: [],
      accounts: [],
      movements: [],
      balanceOf: () => 0,
      reservedOf: () => 0,
    });
    const a = computeAlerts(ctx);
    expect(a.find((x) => x.id === "stale_rates")).toBeDefined();
  });

  it("ignores other-office data", () => {
    const ctx = makeCtx({
      obligations: [
        { id: "o1", officeId: "terra", currency: "USD", amount: 100, direction: "we_owe", status: "open", createdAt: "2020-01-01T00:00:00Z" },
      ],
      transactions: [],
      modifiedAfterConfirmation: false,
      accounts: [],
      movements: [],
      balanceOf: () => 0,
      reservedOf: () => 0,
    });
    expect(computeAlerts(ctx).find((x) => x.id === "overdue_obligations")).toBeUndefined();
  });
});
