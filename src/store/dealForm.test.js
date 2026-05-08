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

describe("history (undo/redo)", () => {
  // Импорт здесь чтобы не циклить при error в historyReducer
  const { historyReducer } = require("./dealForm.js");

  function initHist() {
    return { past: [], present: initialState(), future: [] };
  }

  it("UNDO restores previous state", () => {
    const h0 = initHist();
    const inId = h0.present.legs[0].id;
    const h1 = historyReducer(h0, {
      type: ACTIONS.UPDATE_LEG, id: inId, patch: { currency: "USDT" },
    });
    expect(h1.present.legs[0].currency).toBe("USDT");
    expect(h1.past).toHaveLength(1);

    const h2 = historyReducer(h1, { type: ACTIONS.UNDO });
    expect(h2.present.legs[0].currency).toBe("");
    expect(h2.past).toHaveLength(0);
    expect(h2.future).toHaveLength(1);
  });

  it("REDO restores undone state", () => {
    const h0 = initHist();
    const inId = h0.present.legs[0].id;
    const h1 = historyReducer(h0, {
      type: ACTIONS.UPDATE_LEG, id: inId, patch: { currency: "USDT" },
    });
    const h2 = historyReducer(h1, { type: ACTIONS.UNDO });
    const h3 = historyReducer(h2, { type: ACTIONS.REDO });
    expect(h3.present.legs[0].currency).toBe("USDT");
    expect(h3.past).toHaveLength(1);
    expect(h3.future).toHaveLength(0);
  });

  it("UPDATE_LEG throttle: same id+keys = single undo step", () => {
    const h0 = initHist();
    const inId = h0.present.legs[0].id;
    const h1 = historyReducer(h0, {
      type: ACTIONS.UPDATE_LEG, id: inId, patch: { amount: "1" },
    });
    const h2 = historyReducer(h1, {
      type: ACTIONS.UPDATE_LEG, id: inId, patch: { amount: "10" },
    });
    const h3 = historyReducer(h2, {
      type: ACTIONS.UPDATE_LEG, id: inId, patch: { amount: "100" },
    });
    // Только 1 entry в past (throttle continuation)
    expect(h3.past).toHaveLength(1);
    expect(h3.present.legs[0].amount).toBe("100");

    // Один UNDO откатывает на pre-amount state
    const h4 = historyReducer(h3, { type: ACTIONS.UNDO });
    expect(h4.present.legs[0].amount).toBe("");
  });

  it("UNDO/REDO no-op when stacks empty", () => {
    const h0 = initHist();
    expect(historyReducer(h0, { type: ACTIONS.UNDO })).toBe(h0);
    expect(historyReducer(h0, { type: ACTIONS.REDO })).toBe(h0);
  });

  it("non-undoable action не пишет в past", () => {
    const h0 = initHist();
    const h1 = historyReducer(h0, {
      type: ACTIONS.HYDRATE,
      state: { legs: [], commission: [] },
    });
    expect(h1.past).toHaveLength(0);
  });
});
