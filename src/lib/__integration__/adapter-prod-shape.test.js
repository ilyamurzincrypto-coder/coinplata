// src/lib/__integration__/adapter-prod-shape.test.js
// Integration test — reproduces the dominant production deal shape through
// adaptLegacyDealPayload with a mocked supabase. Shape sourced from
// docs/superpowers/notes/2026-05-09-adapter-throw-map.md (Phase 2.1):
//   1 IN cash USDT (W88 Mark, ledger code 1316)
//   + 1 OUT cash USD (Cash · USD, ledger code 1110)
//   no partner, deferredIn=false, n=7 (most common shape across 35 prod deals).
//
// Mocking pattern follows src/lib/newLedgerAdapter.test.js (`setupAccountMock`
// dispatches via `.eq(col, val)` storing _currentId on `this`, then `.single()`
// resolves the row by that id). Required because resolveAccountCode is called
// twice in this shape (IN + OUT) and each call must return a different row.

import { describe, expect, it, vi } from "vitest";

vi.mock("../supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    })),
  },
}));

import { adaptLegacyDealPayload } from "../newLedgerAdapter.js";
import { supabase } from "../supabase.js";

// Mocked accounts keyed by legacy uuid. Mirrors prod chart-of-accounts rows:
//   W88 Mark    — crypto USDT, ledger_account_code='1316' (IN)
//   Cash · USD  — cash USD,   ledger_account_code='1110' (OUT)
const FAKE_ACCOUNTS = {
  "in-w88-mark": {
    ledger_account_code: "1316",
    legacy_only: false,
    name: "W88 Mark",
    type: "crypto",
  },
  "out-cash-usd": {
    ledger_account_code: "1110",
    legacy_only: false,
    name: "Cash · USD",
    type: "cash",
  },
  // Additional fixtures for Tasks 1.4–1.8
  "acc-crypto": {
    ledger_account_code: "1316",
    legacy_only: false,
    name: "W88 Mark Crypto",
    type: "crypto",
  },
  "acc-cash-usd": {
    ledger_account_code: "1011",
    legacy_only: false,
    name: "Cash USD",
    type: "cash",
  },
};

// Partner accounts map for Tasks 1.6–1.8
let _partnerAccountsMap = {};

function setupAccountMock(byId) {
  supabase.from.mockImplementation((tbl) => {
    if (tbl === "partner_accounts") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(function (col, val) {
          this._currentId = val;
          return this;
        }),
        single: vi.fn(function () {
          const id = this._currentId;
          const row = _partnerAccountsMap[id];
          if (!row) {
            return Promise.resolve({
              data: null,
              error: { message: `partner not found: ${id}` },
            });
          }
          return Promise.resolve({ data: row, error: null });
        }),
      };
    }
    if (tbl !== "accounts") throw new Error(`unexpected table: ${tbl}`);
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn(function (col, val) {
        this._currentId = val;
        return this;
      }),
      single: vi.fn(function () {
        const id = this._currentId;
        const row = byId[id];
        if (!row) {
          return Promise.resolve({
            data: null,
            error: { message: `not found: ${id}` },
          });
        }
        return Promise.resolve({ data: row, error: null });
      }),
    };
  });
}

function setupPartnerAccountMock(byId) {
  _partnerAccountsMap = byId;
  supabase.from.mockImplementation((tbl) => {
    if (tbl === "partner_accounts") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(function (col, val) {
          this._currentId = val;
          return this;
        }),
        single: vi.fn(function () {
          const id = this._currentId;
          const row = byId[id];
          if (!row) {
            return Promise.resolve({
              data: null,
              error: { message: `partner not found: ${id}` },
            });
          }
          return Promise.resolve({ data: row, error: null });
        }),
      };
    }
    if (tbl === "accounts") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(function (col, val) {
          this._currentId = val;
          return this;
        }),
        single: vi.fn(function () {
          const id = this._currentId;
          const row = FAKE_ACCOUNTS[id];
          if (!row) {
            return Promise.resolve({
              data: null,
              error: { message: `not found: ${id}` },
            });
          }
          return Promise.resolve({ data: row, error: null });
        }),
      };
    }
    throw new Error(`unexpected table: ${tbl}`);
  });
}

// ─── existing dominant-shape test ───────────────────────────────────────────
describe("adaptLegacyDealPayload — dominant production shape", () => {
  it("converts 1-IN USDT cash + 1-OUT USD cash (no partner, no deferredIn)", async () => {
    setupAccountMock(FAKE_ACCOUNTS);

    // NOTE: adapter reads `legacy.outputs[]` (not `outLegs[]`). See
    // newLedgerAdapter.js:138. Each entry uses `accountId` + `outKind`.
    const legacy = {
      officeId: "office-mark-antalya",
      clientId: "client-1",
      managerId: "mgr-1",
      currencyIn: "USDT",
      amountIn: 1000,
      inAccountId: "in-w88-mark",
      deferredIn: false,
      outputs: [
        {
          currency: "USD",
          amount: 1000,
          rate: 1.0,
          accountId: "out-cash-usd",
          outKind: "ours_now",
        },
      ],
      commissionUsd: 5,
    };

    const v2 = await adaptLegacyDealPayload(legacy);

    expect(v2.inLegs).toHaveLength(1);
    expect(v2.inLegs[0].account_code).toBe("1316");
    expect(v2.outLegs).toHaveLength(1);
    expect(v2.outLegs[0].account_code).toBe("1110");
    expect(v2.commission).toBeTruthy();
  });
});

// ─── Task 1.4: one-sided OUT → withdrawal ────────────────────────────────────
describe("adapter — one-sided OUT", () => {
  it("returns a withdrawal payload with kind='withdrawal' (no inLegs)", async () => {
    setupAccountMock(FAKE_ACCOUNTS);
    const legacy = {
      officeId: "office-mark",
      clientId: "client-1",
      currencyIn: "USD",
      amountIn: 0,
      deferredIn: false,
      outputs: [{ currency: "USDT", amount: 500, rate: 1, accountId: "acc-crypto", outKind: "ours_now" }],
    };
    const result = await adaptLegacyDealPayload(legacy);
    expect(result.kind).toBe("withdrawal");
    expect(result.inLegs).toBeUndefined();
    expect(result.outLegs).toHaveLength(1);
    expect(result.outLegs[0].account_code).toBe("1316");
  });
});

// ─── Task 1.5: one-sided IN → topup ──────────────────────────────────────────
describe("adapter — one-sided IN", () => {
  it("returns a topup payload with kind='topup' (no outLegs)", async () => {
    setupAccountMock(FAKE_ACCOUNTS);
    const legacy = {
      officeId: "office-mark",
      clientId: "client-1",
      currencyIn: "USD",
      amountIn: 1000,
      inAccountId: "acc-cash-usd",
      deferredIn: false,
      outputs: [],
    };
    const result = await adaptLegacyDealPayload(legacy);
    expect(result.kind).toBe("topup");
    expect(result.outLegs).toBeUndefined();
    expect(result.inLegs).toHaveLength(1);
    expect(result.inLegs[0].account_code).toBe("1011");
  });
});

// ─── Task 1.6: partner-account IN ────────────────────────────────────────────
describe("adapter — partner-account IN", () => {
  it("resolves partner account_code for IN leg", async () => {
    setupPartnerAccountMock({
      "partner-acc-1": { ledger_account_code: "2210", currency_code: "USDT", name: "Sherif USDT" },
    });
    const legacy = {
      officeId: "office-mark",
      clientId: "client-1",
      currencyIn: "USDT",
      amountIn: 1000,
      inPartnerAccountId: "partner-acc-1",
      deferredIn: false,
      outputs: [{ currency: "USD", amount: 990, rate: 0.99, accountId: "acc-cash-usd", outKind: "ours_now" }],
    };
    const result = await adaptLegacyDealPayload(legacy);
    expect(result.inLegs[0].account_code).toBe("2210");
  });

  it("throws structured error when partner account has no ledger_account_code", async () => {
    setupPartnerAccountMock({
      "partner-acc-2": { ledger_account_code: null, currency_code: "USDT", name: "Mehmet USDT" },
    });
    await expect(
      adaptLegacyDealPayload({
        officeId: "office-mark",
        clientId: "client-1",
        currencyIn: "USDT",
        amountIn: 1000,
        inPartnerAccountId: "partner-acc-2",
        deferredIn: false,
        outputs: [{ currency: "USD", amount: 990, rate: 0.99, accountId: "acc-cash-usd", outKind: "ours_now" }],
      })
    ).rejects.toThrow(/Mehmet USDT.*ledger.*Settings/i);
  });
});

// ─── Task 1.7: partner-account OUT ───────────────────────────────────────────
describe("adapter — partner-account OUT", () => {
  it("resolves partner account_code for OUT leg", async () => {
    setupPartnerAccountMock({
      "partner-acc-3": { ledger_account_code: "2210", currency_code: "USDT", name: "Sherif USDT" },
    });
    const legacy = {
      officeId: "office-mark",
      clientId: "client-1",
      currencyIn: "USD",
      amountIn: 1000,
      inAccountId: "acc-cash-usd",
      deferredIn: false,
      outputs: [{
        currency: "USDT", amount: 990, rate: 1.01,
        partnerAccountId: "partner-acc-3",
        outKind: "partner_now",
      }],
    };
    const result = await adaptLegacyDealPayload(legacy);
    expect(result.outLegs[0].account_code).toBe("2210");
  });
});

// ─── Task 1.8: partner inPayments entry ──────────────────────────────────────
describe("adapter — partner inPayments entry", () => {
  it("resolves partner account_code in multi-currency inPayments", async () => {
    setupPartnerAccountMock({
      "partner-acc-4": { ledger_account_code: "2210", currency_code: "USDT", name: "Sherif USDT" },
    });
    setupAccountMock({
      "acc-cash-usd": { ledger_account_code: "1011", legacy_only: false, name: "Cash USD", type: "cash" },
      "acc-crypto": { ledger_account_code: "1316", legacy_only: false, name: "W88 Mark Crypto", type: "crypto" },
    });
    const legacy = {
      officeId: "office-mark",
      clientId: "client-1",
      currencyIn: null,
      amountIn: null,
      deferredIn: false,
      inPayments: [
        { currency: "USD", amount: 500, accountId: "acc-cash-usd" },
        { currency: "USDT", amount: 100, partnerAccountId: "partner-acc-4" },
      ],
      outputs: [{ currency: "USDT", amount: 590, rate: 1, accountId: "acc-crypto", outKind: "ours_now" }],
    };
    const result = await adaptLegacyDealPayload(legacy);
    expect(result.inLegs).toHaveLength(2);
    expect(result.inLegs[1].account_code).toBe("2210");
  });
});
