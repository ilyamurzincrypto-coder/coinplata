// src/lib/dealForm/buildTx.test.js
// 8 fixture-test pairs для buildTx (UI этап 2).
// Каждая fixture: legs[] state input → expected v2 RPC payload.

import { describe, expect, it } from "vitest";
import { buildTx } from "./buildTx.js";

const ACC_MAP = {
  "acc-1110": "1110", // Cash · Mark · USD
  "acc-1112": "1112", // Cash · Mark · TRY
  "acc-1316": "1316", // Hot · USDT TRC20 · Mark
  "acc-1340": "1340", // Treasury · USDT TRC20
};

const COMMON = {
  clientId: "client-uuid",
  officeId: "office-mark",
  accountCodeByLegacyId: ACC_MAP,
};

function leg(over) {
  return {
    id: "leg-x",
    side: "in",
    currency: "",
    amount: "",
    accountId: null,
    rate: "",
    rateManual: false,
    deferred: false,
    source: "fresh",
    destination: null,
    address: null,
    network: null,
    note: null,
    ...over,
  };
}

describe("buildTx — 8 sceanrios", () => {
  // ─── 5a: single-leg fresh→physical ───
  it("5a single-leg fresh→physical", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "1000", accountId: "acc-1316", source: "fresh" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "30000", accountId: "acc-1112", destination: "physical", rate: "30", rateManual: false }),
      ],
      commission: [{ currency: "TRY", amount: "300", kind: "commission" }],
    };
    expect(buildTx({ ...COMMON, state })).toMatchSnapshot();
  });

  // ─── 5b: multi-leg fresh→physical multi-currency commission ───
  it("5b multi-leg fresh→physical multi-currency commission", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "1000", accountId: "acc-1316", source: "fresh" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "15000", accountId: "acc-1112", destination: "physical", rate: "30" }),
        leg({ id: "o2", side: "out", currency: "USD", amount: "500", accountId: "acc-1110", destination: "physical", rate: "1" }),
      ],
      commission: [
        { currency: "TRY", amount: "150", kind: "commission" },
        { currency: "USD", amount: "5", kind: "commission" },
      ],
    };
    expect(buildTx({ ...COMMON, state })).toMatchSnapshot();
  });

  // ─── 6a: single-leg from_balance→physical ───
  it("6a single-leg from_balance→physical", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "500", source: "from_balance" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "15000", accountId: "acc-1112", destination: "physical", rate: "30" }),
      ],
      commission: [{ currency: "TRY", amount: "150", kind: "commission" }],
    };
    expect(buildTx({ ...COMMON, state })).toMatchSnapshot();
  });

  // ─── 6b: multi-leg from_balance→physical ───
  it("6b multi-leg from_balance→physical", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "1000", source: "from_balance" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "15000", accountId: "acc-1112", destination: "physical", rate: "30" }),
        leg({ id: "o2", side: "out", currency: "USD", amount: "500", accountId: "acc-1110", destination: "physical", rate: "1" }),
      ],
      commission: [
        { currency: "TRY", amount: "150", kind: "commission" },
        { currency: "USD", amount: "5", kind: "commission" },
      ],
    };
    expect(buildTx({ ...COMMON, state })).toMatchSnapshot();
  });

  // ─── 7a: single-leg fresh→to_balance ───
  it("7a single-leg fresh→to_balance", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "1000", accountId: "acc-1316", source: "fresh" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "30000", destination: "to_balance", rate: "30" }),
      ],
      commission: [{ currency: "TRY", amount: "300", kind: "commission" }],
    };
    expect(buildTx({ ...COMMON, state })).toMatchSnapshot();
  });

  // ─── 7b: multi-leg fresh→to_balance ───
  it("7b multi-leg fresh→to_balance", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "1000", accountId: "acc-1316", source: "fresh" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "15000", destination: "to_balance", rate: "30" }),
        leg({ id: "o2", side: "out", currency: "USD", amount: "500", destination: "to_balance", rate: "1" }),
      ],
      commission: [
        { currency: "TRY", amount: "150", kind: "commission" },
        { currency: "USD", amount: "5", kind: "commission" },
      ],
    };
    expect(buildTx({ ...COMMON, state })).toMatchSnapshot();
  });

  // ─── 8a: single-leg from_balance→to_balance ───
  it("8a single-leg from_balance→to_balance", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "500", source: "from_balance" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "15000", destination: "to_balance", rate: "30" }),
      ],
      commission: [{ currency: "TRY", amount: "150", kind: "commission" }],
    };
    expect(buildTx({ ...COMMON, state })).toMatchSnapshot();
  });

  // ─── 8b: multi-leg from_balance→to_balance ───
  it("8b multi-leg from_balance→to_balance", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "1000", source: "from_balance" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "15000", destination: "to_balance", rate: "30" }),
        leg({ id: "o2", side: "out", currency: "USD", amount: "500", destination: "to_balance", rate: "1" }),
      ],
      commission: [
        { currency: "TRY", amount: "150", kind: "commission" },
        { currency: "USD", amount: "5", kind: "commission" },
      ],
    };
    expect(buildTx({ ...COMMON, state })).toMatchSnapshot();
  });
});

// ─── Edge cases ───
describe("buildTx — error cases", () => {
  it("missing IN legs throws", () => {
    const state = {
      legs: [leg({ id: "o1", side: "out", currency: "TRY", amount: "30000", accountId: "acc-1112", destination: "physical", rate: "30" })],
      commission: [{ currency: "TRY", amount: "300", kind: "commission" }],
    };
    expect(() => buildTx({ ...COMMON, state })).toThrow(/at least one IN leg/);
  });

  it("missing OUT legs throws", () => {
    const state = {
      legs: [leg({ id: "i1", side: "in", currency: "USDT", amount: "1000", accountId: "acc-1316" })],
      commission: [],
    };
    expect(() => buildTx({ ...COMMON, state })).toThrow(/at least one OUT leg/);
  });

  it("legacy_only account (missing in map) throws", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "1000", accountId: "acc-UNMAPPED" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "30000", accountId: "acc-1112", destination: "physical", rate: "30" }),
      ],
      commission: [{ currency: "TRY", amount: "300", kind: "commission" }],
    };
    expect(() => buildTx({ ...COMMON, state })).toThrow(/no ledger_account_code mapping/);
  });

  it("to_balance + deferred=true throws", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "1000", accountId: "acc-1316" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "30000", destination: "to_balance", deferred: true, rate: "30" }),
      ],
      commission: [{ currency: "TRY", amount: "300", kind: "commission" }],
    };
    expect(() => buildTx({ ...COMMON, state })).toThrow(/to_balance cannot be deferred/);
  });

  it("commission filtered when currency not in OUT legs", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "1000", accountId: "acc-1316" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "30000", accountId: "acc-1112", destination: "physical", rate: "30" }),
      ],
      commission: [{ currency: "EUR", amount: "5", kind: "commission" }], // EUR не в OUT
    };
    const result = buildTx({ ...COMMON, state });
    // Filter → no match → fallback на sentinel в первой OUT-валюте
    expect(result.commission).toEqual([
      { currency: "TRY", amount: 0.01, kind: "commission" },
    ]);
  });
});
