// src/lib/newLedgerAdapter.test.js
// Unit-тесты для adapter helpers — pure conversion (без supabase calls).
//
// resolveAccountCode/adaptLegacyTopup/adaptLegacyTransfer/adaptLegacyAdjustment
// делают supabase queries — для них нужны integration tests.

import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    })),
  },
}));

import {
  inferCommissionFromLegacy,
  adaptLegacyDealPayload,
  resolveAccountCode,
} from "./newLedgerAdapter.js";
import { supabase } from "./supabase.js";

describe("inferCommissionFromLegacy", () => {
  it("uses customFeeUsd when present", () => {
    const r = inferCommissionFromLegacy({ customFeeUsd: 5, commissionUsd: 3 });
    expect(r).toEqual([{ currency: "USD", amount: 5, kind: "commission" }]);
  });

  it("falls back to commissionUsd", () => {
    const r = inferCommissionFromLegacy({ commissionUsd: 7 });
    expect(r).toEqual([{ currency: "USD", amount: 7, kind: "commission" }]);
  });

  it("returns null when nothing", () => {
    expect(inferCommissionFromLegacy({})).toBeNull();
    expect(inferCommissionFromLegacy({ customFeeUsd: 0 })).toBeNull();
    expect(inferCommissionFromLegacy({ customFeeUsd: -1 })).toBeNull();
  });
});

describe("resolveAccountCode", () => {
  function mockAccount(row) {
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: row, error: null }),
    });
  }

  it("returns ledger code when matched + active", async () => {
    mockAccount({
      ledger_account_code: "1110",
      legacy_only: false,
      name: "Cash · USD",
      type: "cash",
    });
    const code = await resolveAccountCode("acc-uuid");
    expect(code).toBe("1110");
  });

  it("throws on legacy_only", async () => {
    mockAccount({
      ledger_account_code: null,
      legacy_only: true,
      name: "Bank · CHF",
      type: "bank",
    });
    await expect(resolveAccountCode("acc-uuid")).rejects.toThrow(/legacy_only/);
  });

  it("throws on missing mapping (NULL code, not legacy_only)", async () => {
    mockAccount({
      ledger_account_code: null,
      legacy_only: false,
      name: "Mystery account",
      type: "cash",
    });
    await expect(resolveAccountCode("acc-uuid")).rejects.toThrow(/no ledger mapping/);
  });

  it("throws when legacyId missing", async () => {
    await expect(resolveAccountCode(null)).rejects.toThrow(/legacyId required/);
  });
});

describe("adaptLegacyDealPayload — structural", () => {
  // Mock resolveAccountCode through supabase.from
  function setupAccountMock(byId) {
    supabase.from.mockImplementation((tbl) => {
      if (tbl !== "accounts") throw new Error("unexpected table");
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(function (col, val) {
          this._currentId = val;
          return this;
        }),
        single: vi.fn(function () {
          const id = this._currentId || arguments[0];
          const row = byId[id];
          if (!row) return Promise.resolve({ data: null, error: { message: "not found" } });
          return Promise.resolve({ data: row, error: null });
        }),
      };
    });
  }

  it("simple deal: 1000 USDT IN fresh → 30000 TRY OUT physical", async () => {
    setupAccountMock({
      "acc-1316": { ledger_account_code: "1316", legacy_only: false, name: "Hot USDT" },
      "acc-1112": { ledger_account_code: "1112", legacy_only: false, name: "Cash TRY" },
    });

    const v2 = await adaptLegacyDealPayload({
      officeId: "office-1",
      clientId: "client-1",
      managerId: "mgr-1",
      currencyIn: "USDT",
      amountIn: 1000,
      inAccountId: "acc-1316",
      outputs: [{
        currency: "TRY",
        amount: 30000,
        rate: 30,
        accountId: "acc-1112",
        outKind: "ours_now",
      }],
      customFeeUsd: 5,
    });

    expect(v2.clientId).toBe("client-1");
    expect(v2.officeId).toBe("office-1");
    expect(v2.inLegs).toHaveLength(1);
    expect(v2.inLegs[0]).toMatchObject({
      currency: "USDT",
      amount: 1000,
      source: "fresh",
      account_code: "1316",
    });
    expect(v2.outLegs).toHaveLength(1);
    expect(v2.outLegs[0]).toMatchObject({
      currency: "TRY",
      amount: 30000,
      destination: "physical",
      account_code: "1112",
      rate: 30,
      deferred: false,
    });
    // customFeeUsd > 0 — берётся как commission. USD не в OUT-legs (только TRY) →
    // фильтруется и заменяется на sentinel в TRY.
    expect(v2.commission).toHaveLength(1);
    expect(v2.commission[0].currency).toBe("TRY");
    expect(v2.metadata.legacy_form).toBe(true);
    expect(v2.metadata.adjustment_type).toBeUndefined();
  });

  it("deferredIn=true → in_legs.source=from_balance, no account_code", async () => {
    setupAccountMock({
      "acc-1112": { ledger_account_code: "1112", legacy_only: false, name: "Cash TRY" },
    });

    const v2 = await adaptLegacyDealPayload({
      officeId: "office-1",
      clientId: "client-1",
      managerId: "mgr-1",
      currencyIn: "USDT",
      amountIn: 500,
      deferredIn: true,
      outputs: [{
        currency: "TRY",
        amount: 15000,
        rate: 30,
        accountId: "acc-1112",
        outKind: "ours_now",
      }],
    });

    expect(v2.inLegs[0]).toMatchObject({
      currency: "USDT",
      amount: 500,
      source: "from_balance",
    });
    expect(v2.inLegs[0].account_code).toBeUndefined();
    expect(v2.metadata.adjustment_type).toBe("legacy_pending_payment");
  });

  it("partner OUT resolves ledger_account_code via partner_accounts lookup", async () => {
    // Partner OUT no longer throws — it resolves via resolvePartnerAccountCode.
    // Extend the mock to handle partner_accounts table.
    const partnerRows = {
      "partner-acc-1": { ledger_account_code: "2210", currency_code: "TRY", name: "Sherif TRY" },
    };
    supabase.from.mockImplementation((tbl) => {
      const byId =
        tbl === "accounts"
          ? { "acc-1316": { ledger_account_code: "1316", legacy_only: false, name: "Hot USDT" } }
          : tbl === "partner_accounts"
          ? partnerRows
          : null;
      if (!byId) throw new Error(`unexpected table: ${tbl}`);
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(function (col, val) { this._currentId = val; return this; }),
        single: vi.fn(function () {
          const row = byId[this._currentId];
          if (!row) return Promise.resolve({ data: null, error: { message: "not found" } });
          return Promise.resolve({ data: row, error: null });
        }),
      };
    });

    const result = await adaptLegacyDealPayload({
      officeId: "office-1",
      clientId: "client-1",
      currencyIn: "USDT",
      amountIn: 100,
      inAccountId: "acc-1316",
      outputs: [{
        currency: "TRY",
        amount: 3000,
        rate: 30,
        partnerAccountId: "partner-acc-1",
        outKind: "partner_now",
      }],
    });
    expect(result.outLegs[0].account_code).toBe("2210");
  });

  it("deferred OUT (ours_later) requires accountId for future complete_deal_leg", async () => {
    setupAccountMock({
      "acc-1316": { ledger_account_code: "1316", legacy_only: false, name: "Hot USDT" },
    });

    await expect(adaptLegacyDealPayload({
      officeId: "office-1",
      clientId: "client-1",
      currencyIn: "USDT",
      amountIn: 100,
      inAccountId: "acc-1316",
      outputs: [{
        currency: "TRY",
        amount: 3000,
        rate: 30,
        outKind: "ours_later",
        // accountId omitted
      }],
    })).rejects.toThrow(/deferred OUT leg requires accountId/);
  });

  it("ExchangeForm payNow:0 → the whole OUT leg becomes deferred", async () => {
    setupAccountMock({
      "acc-1316": { ledger_account_code: "1316", legacy_only: false, name: "Hot USDT" },
      "acc-1340": { ledger_account_code: "1340", legacy_only: false, name: "Treasury USDT" },
    });
    const v2 = await adaptLegacyDealPayload({
      officeId: "office-1", clientId: "client-1", currencyIn: "USD", amountIn: 1000, inAccountId: "acc-1316",
      outputs: [{ currency: "USDT", amount: 950, rate: 1, accountId: "acc-1340", outKind: "ours", payNow: 0 }],
    });
    expect(v2.outLegs).toHaveLength(1);
    expect(v2.outLegs[0]).toMatchObject({ currency: "USDT", amount: 950, deferred: true, account_code: "1340" });
  });

  it("ExchangeForm partial payNow (0 < payNow < amount) → splits into immediate + deferred legs", async () => {
    setupAccountMock({
      "acc-1316": { ledger_account_code: "1316", legacy_only: false, name: "Hot USDT" },
      "acc-1340": { ledger_account_code: "1340", legacy_only: false, name: "Treasury USDT" },
    });
    const v2 = await adaptLegacyDealPayload({
      officeId: "office-1", clientId: "client-1", currencyIn: "USD", amountIn: 1000, inAccountId: "acc-1316",
      outputs: [{ currency: "USDT", amount: 950, rate: 1, accountId: "acc-1340", outKind: "ours", payNow: 500 }],
    });
    expect(v2.outLegs).toHaveLength(2);
    expect(v2.outLegs[0]).toMatchObject({ currency: "USDT", amount: 500, deferred: false, account_code: "1340" });
    expect(v2.outLegs[1]).toMatchObject({ currency: "USDT", amount: 450, deferred: true, account_code: "1340" });
  });
});
