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

  // ── Stage 3 conditions metadata ──
  it("conditions: flags + fees → metadata flags", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "100", accountId: "acc-1316" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "3000", accountId: "acc-1112", destination: "physical", rate: "30" }),
      ],
      commission: [{ currency: "TRY", amount: "30", kind: "commission" }],
      conditions: {
        margin_strategy: "pro_rata",
        flags: ["referral", "vip"],
        fees: ["network_fee_client"],
        on_demand: { backdate: null, scheduled_at: null, comment: null, tx_hash: null },
      },
    };
    const r = buildTx({ ...COMMON, state });
    expect(r.metadata.referral).toBe(true);
    expect(r.metadata.vip).toBe(true);
    expect(r.metadata.is_otc).toBe(false);
    expect(r.metadata.fee_paid_by).toBe("client");
    expect(r.metadata.no_commission).toBe(false);
  });

  it("conditions: single_leg → all margin на первой OUT", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "1000", accountId: "acc-1316" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "15000", accountId: "acc-1112", destination: "physical", rate: "30" }),
        leg({ id: "o2", side: "out", currency: "USD", amount: "500", accountId: "acc-1110", destination: "physical", rate: "1" }),
      ],
      commission: [
        { currency: "TRY", amount: "150", kind: "commission" },
        { currency: "USD", amount: "5", kind: "commission" },
      ],
      conditions: {
        margin_strategy: "single_leg",
        flags: [],
        fees: [],
        on_demand: { backdate: null, scheduled_at: null, comment: null, tx_hash: null },
      },
    };
    const r = buildTx({ ...COMMON, state });
    expect(r.commission).toHaveLength(1);
    expect(r.commission[0].currency).toBe("TRY"); // first OUT
    expect(r.commission[0].amount).toBe(155);     // 150 + 5 объединены в первую валюту
    expect(r.metadata.margin_strategy).toBe("single_leg");
  });

  it("conditions: no_commission → sentinel + flag в metadata", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "100", accountId: "acc-1316" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "3000", accountId: "acc-1112", destination: "physical", rate: "30" }),
      ],
      commission: [{ currency: "TRY", amount: "30", kind: "commission" }],
      conditions: {
        margin_strategy: "pro_rata",
        flags: [],
        fees: ["no_commission"],
        on_demand: { backdate: null, scheduled_at: null, comment: null, tx_hash: null },
      },
    };
    const r = buildTx({ ...COMMON, state });
    expect(r.commission).toEqual([
      { currency: "TRY", amount: 0.01, kind: "commission" },
    ]);
    expect(r.metadata.no_commission).toBe(true);
  });

  it("conditions: backdate → effectiveDate в payload", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "100", accountId: "acc-1316" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "3000", accountId: "acc-1112", destination: "physical", rate: "30" }),
      ],
      commission: [{ currency: "TRY", amount: "30", kind: "commission" }],
      conditions: {
        margin_strategy: "pro_rata",
        flags: [],
        fees: [],
        on_demand: {
          backdate: "2026-04-30T12:00:00Z",
          scheduled_at: "2026-05-15T10:00:00Z",
          comment: "test deal",
          tx_hash: "0xabc",
        },
      },
    };
    const r = buildTx({ ...COMMON, state });
    expect(r.effectiveDate).toBe("2026-04-30T12:00:00Z");
    expect(r.metadata.scheduled_at).toBe("2026-05-15T10:00:00Z");
    expect(r.metadata.comment).toBe("test deal");
    expect(r.metadata.tx_hash).toBe("0xabc");
  });

  it("conditions: defaults — fee_paid_by='exchange', no_commission=false", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "100", accountId: "acc-1316" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "3000", accountId: "acc-1112", destination: "physical", rate: "30" }),
      ],
      commission: [{ currency: "TRY", amount: "30", kind: "commission" }],
      conditions: {
        margin_strategy: "pro_rata",
        flags: [],
        fees: ["network_fee_exchange"],
        on_demand: { backdate: null, scheduled_at: null, comment: null, tx_hash: null },
      },
    };
    const r = buildTx({ ...COMMON, state });
    expect(r.metadata.fee_paid_by).toBe("exchange");
    expect(r.metadata.no_commission).toBe(false);
    expect(r.metadata.margin_strategy).toBe("pro_rata");
    expect(r.effectiveDate).toBeUndefined();
    expect(r.metadata.scheduled_at).toBeUndefined();
  });

  // ── camelCase shape (compat с newLedger.js wrapper) ──
  it("output is camelCase top-level + leg-level (wrapper compat)", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "100", accountId: "acc-1316" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "3000", accountId: "acc-1112", destination: "physical", rate: "30" }),
      ],
      commission: [{ currency: "TRY", amount: "30", kind: "commission" }],
    };
    const r = buildTx({ ...COMMON, state });
    // Top-level camelCase
    expect(r).toHaveProperty("clientId");
    expect(r).toHaveProperty("officeId");
    expect(r).toHaveProperty("inLegs");
    expect(r).toHaveProperty("outLegs");
    expect(r).not.toHaveProperty("client_id");
    expect(r).not.toHaveProperty("in_legs");
    // Leg-level camelCase
    expect(r.inLegs[0]).toHaveProperty("accountCode");
    expect(r.inLegs[0]).not.toHaveProperty("account_code");
    expect(r.outLegs[0]).toHaveProperty("accountCode");
    expect(r.outLegs[0]).toHaveProperty("rateSource");
    expect(r.outLegs[0]).not.toHaveProperty("account_code");
    expect(r.outLegs[0]).not.toHaveProperty("rate_source");
    // Metadata остаётся snake_case
    expect(r.metadata).toHaveProperty("margin_strategy");
    expect(r.metadata).toHaveProperty("fee_paid_by");
  });

  it("legacy passthrough: accountCodeByLegacyId=null → accountId как-есть", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USDT", amount: "100", accountId: "acc-anything" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "3000", accountId: "acc-also", destination: "physical", rate: "30" }),
      ],
      commission: [{ currency: "TRY", amount: "30", kind: "commission" }],
    };
    const r = buildTx({
      state,
      clientId: "client-1",
      officeId: "office-1",
      accountCodeByLegacyId: null,
    });
    expect(r.inLegs[0].accountId).toBe("acc-anything");
    expect(r.inLegs[0].accountCode).toBeUndefined();
    expect(r.outLegs[0].accountId).toBe("acc-also");
    expect(r.outLegs[0].accountCode).toBeUndefined();
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
