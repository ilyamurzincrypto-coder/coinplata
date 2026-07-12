// src/utils/exchangeMovements.test.js
// B5 — двойная запись: односторонний набор (нет встречной ноги) НЕ пишется.
// Проверяем ПО ФАКТУ ЗАПИСИ (spy addMovement), а не только по возврату.

import { describe, expect, it, vi } from "vitest";
import { buildMovementsFromTransaction, commitMovements } from "./exchangeMovements.js";

const ACCOUNTS = [
  { id: "A_IN", active: true },
  { id: "A_OUT", active: true },
];
const okTx = {
  id: "t1",
  accountId: "A_IN",
  amtIn: 100,
  curIn: "USDT",
  outputs: [{ currency: "TRY", amount: 4600, accountId: "A_OUT" }],
  status: "completed",
};

describe("buildMovementsFromTransaction — fatal-детект (B5)", () => {
  it("валидная сделка (IN+OUT) → не fatal, 2 движения", () => {
    const r = buildMovementsFromTransaction(okTx, ACCOUNTS, "u1");
    expect(r.fatal).toBe(false);
    expect(r.movements).toHaveLength(2);
  });

  it("IN-счёт не выбран → fatal", () => {
    const r = buildMovementsFromTransaction({ ...okTx, accountId: null }, ACCOUNTS, "u1");
    expect(r.fatal).toBe(true);
  });

  it("IN-счёт неактивен → fatal", () => {
    const accts = [{ id: "A_IN", active: false }, { id: "A_OUT", active: true }];
    const r = buildMovementsFromTransaction(okTx, accts, "u1");
    expect(r.fatal).toBe(true);
  });

  it("OUT-счёт не выбран → fatal", () => {
    const tx = { ...okTx, outputs: [{ currency: "TRY", amount: 4600, accountId: null }] };
    const r = buildMovementsFromTransaction(tx, ACCOUNTS, "u1");
    expect(r.fatal).toBe(true);
  });

  it("obligation-лега (недостаток) → warning, но НЕ fatal", () => {
    const r = buildMovementsFromTransaction(okTx, ACCOUNTS, "u1", { obligationLegs: new Set([0]) });
    expect(r.fatal).toBe(false); // деньги намеренно не выданы, висит обязательство
    expect(r.warnings.some((w) => /obligation/.test(w))).toBe(true);
  });
});

describe("commitMovements — атомарность (B5)", () => {
  it("fatal → бросает и НЕ пишет НИ ОДНОГО движения (по факту spy)", () => {
    const built = buildMovementsFromTransaction({ ...okTx, accountId: null }, ACCOUNTS, "u1");
    const add = vi.fn();
    expect(() => commitMovements(built, add)).toThrow(/несбалансир/i);
    expect(add).not.toHaveBeenCalled(); // ← ноль движений записано
  });

  it("валидная сделка → пишет все движения", () => {
    const built = buildMovementsFromTransaction(okTx, ACCOUNTS, "u1");
    const add = vi.fn();
    const n = commitMovements(built, add);
    expect(add).toHaveBeenCalledTimes(2);
    expect(n).toBe(2);
  });
});
