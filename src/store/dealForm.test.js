// src/store/dealForm.test.js
// Tests for bidirectional rate↔amount sync (BUG 1 fix).

import { describe, expect, it } from "vitest";
import {
  dealFormReducer,
  ACTIONS,
  applyAutoCalc,
  initialState,
} from "./dealForm.js";

function leg(over) {
  return {
    id: "x",
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

describe("auto-calc rate↔amount", () => {
  // R1: OUT.rate edited → OUT.amount = IN × rate
  it("R1: editing OUT rate recalculates OUT amount", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USD", amount: "1000" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "", rate: "", destination: "physical" }),
      ],
      commission: [],
    };
    const next = dealFormReducer(state, {
      type: ACTIONS.UPDATE_LEG,
      id: "o1",
      patch: { rate: "44.7" },
    });
    expect(next.legs[1].amount).toBe("44700");
    expect(next.legs[1].rate).toBe("44.7");
  });

  // R2: OUT.amount edited → OUT.rate = OUT.amount / IN.amount
  it("R2: editing OUT amount recalculates OUT rate", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USD", amount: "1000" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "", rate: "", destination: "physical" }),
      ],
      commission: [],
    };
    const next = dealFormReducer(state, {
      type: ACTIONS.UPDATE_LEG,
      id: "o1",
      patch: { amount: "30000" },
    });
    expect(next.legs[1].rate).toBe("30");
    expect(next.legs[1].rateManual).toBe(true);
  });

  // R3: IN.amount changed → all OUT amounts recalculated using existing rates
  it("R3: editing IN amount recalculates all OUT amounts (with rates)", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USD", amount: "1000" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "30000", rate: "30", destination: "physical" }),
        leg({ id: "o2", side: "out", currency: "EUR", amount: "920", rate: "0.92", destination: "physical" }),
      ],
      commission: [],
    };
    const next = dealFormReducer(state, {
      type: ACTIONS.UPDATE_LEG,
      id: "i1",
      patch: { amount: "2000" },
    });
    expect(next.legs[1].amount).toBe("60000"); // 2000 * 30
    expect(next.legs[2].amount).toBe("1840");  // 2000 * 0.92
  });

  // R3 negative case: OUT без rate не пересчитывается
  it("R3: OUT без rate не трогается", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USD", amount: "1000" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "999", rate: "", destination: "physical" }),
      ],
      commission: [],
    };
    const next = dealFormReducer(state, {
      type: ACTIONS.UPDATE_LEG,
      id: "i1",
      patch: { amount: "2000" },
    });
    expect(next.legs[1].amount).toBe("999"); // unchanged
  });

  // _skipAutoCalc bypass
  it("_skipAutoCalc=true bypasses auto-calc", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USD", amount: "1000" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "", rate: "", destination: "physical" }),
      ],
      commission: [],
    };
    const next = dealFormReducer(state, {
      type: ACTIONS.UPDATE_LEG,
      id: "o1",
      patch: { rate: "44.7" },
      _skipAutoCalc: true,
    });
    expect(next.legs[1].rate).toBe("44.7");
    expect(next.legs[1].amount).toBe(""); // НЕ пересчитан
  });

  // No-op when IN amount empty
  it("no recalc when IN amount empty", () => {
    const state = {
      legs: [
        leg({ id: "i1", side: "in", currency: "USD", amount: "" }),
        leg({ id: "o1", side: "out", currency: "TRY", amount: "", rate: "", destination: "physical" }),
      ],
      commission: [],
    };
    const next = dealFormReducer(state, {
      type: ACTIONS.UPDATE_LEG,
      id: "o1",
      patch: { rate: "30" },
    });
    expect(next.legs[1].rate).toBe("30");
    expect(next.legs[1].amount).toBe(""); // без IN amount нечего считать
  });

  // applyAutoCalc pure-test (без reducer)
  it("applyAutoCalc handles edge cases", () => {
    const legs = [
      leg({ id: "i", side: "in", amount: "100" }),
      leg({ id: "o", side: "out", amount: "", rate: "" }),
    ];
    const target = legs[1];
    const result = applyAutoCalc(legs, target, { rate: "5" });
    expect(result[1].amount).toBe("500");
  });
});

describe("REMOVE_LEG invariant", () => {
  it("removing last IN re-adds empty IN", () => {
    const state = initialState();
    const onlyIn = state.legs[0].id;
    const next = dealFormReducer(state, { type: ACTIONS.REMOVE_LEG, id: onlyIn });
    expect(next.legs).toHaveLength(1);
    expect(next.legs[0].side).toBe("in");
  });
});
