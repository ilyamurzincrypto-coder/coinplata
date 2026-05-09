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
};

function setupAccountMock(byId) {
  supabase.from.mockImplementation((tbl) => {
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
