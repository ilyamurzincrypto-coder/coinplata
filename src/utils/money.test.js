// src/utils/money.test.js
// Ядро денежной математики. Фиксируем конвенцию знака прибыли (B8) и
// безопасную точность multiplyAmount (находка при разборе B7).

import { describe, expect, it } from "vitest";
import { multiplyAmount, computeProfitFromRates } from "./money.js";

// getRate(from,to): outCurrency за 1 curIn. Market USD→TRY = 46.
const getRate = (from, to) => ({ "USD>TRY": 46, "USD>USD": 1 })[`${from}>${to}`];

describe("computeProfitFromRates — конвенция знака (B8)", () => {
  // rate = сколько outCurrency за 1 curIn. actualRate < marketRate ⇒ клиент
  // получает МЕНЬШЕ рынка ⇒ офис заработал ⇒ маржа ПОЛОЖИТЕЛЬНА.
  it("actual < market (хуже рынка для клиента) → маржа > 0", () => {
    // 100 USD → 4400 TRY по 44 (рынок 46). consumed: 100 − 95.652 = +4.35 USD
    const p = computeProfitFromRates({
      amtIn: 100, curIn: "USD",
      outputs: [{ amount: 4400, rate: 44, currency: "TRY" }],
      getRate,
    });
    expect(p).toBeGreaterThan(0);
    expect(p).toBeCloseTo(4.35, 2);
  });

  it("actual > market (лучше рынка для клиента) → маржа < 0", () => {
    const p = computeProfitFromRates({
      amtIn: 100, curIn: "USD",
      outputs: [{ amount: 4800, rate: 48, currency: "TRY" }],
      getRate,
    });
    expect(p).toBeLessThan(0);
    expect(p).toBeCloseTo(-4.35, 2);
  });

  it("actual == market → маржа 0", () => {
    const p = computeProfitFromRates({
      amtIn: 100, curIn: "USD",
      outputs: [{ amount: 4600, rate: 46, currency: "TRY" }],
      getRate,
    });
    expect(p).toBe(0);
  });
});

describe("multiplyAmount — безопасная точность (находка B7)", () => {
  it("обычные суммы точны", () => {
    expect(multiplyAmount(1000, 44.7, 0)).toBe(44700);
    expect(multiplyAmount(2000, 0.92, 2)).toBe(1840);
  });
  // При округлении к точности ВАЛЮТЫ (0/2) артефакт float поглощается Math.round.
  // Именно поэтому dealForm нельзя гнать через multiplyAmount c 8 знаками
  // (77226000.00000001 «протечёт» в поле суммы) — округлять надо к валюте.
  it("большая сумма точна при округлении к валюте (0 знаков)", () => {
    expect(multiplyAmount(73200000, 1.055, 0)).toBe(77226000);
  });

  // S5 — точность на любом масштабе (BigInt). До фикса давало 77226000.00000001.
  it("большая сумма точна и при 8 знаках (нет float-артефакта)", () => {
    expect(multiplyAmount(73200000, 1.055, 8)).toBe(77226000);
  });
  it("прочие крупные входы без артефакта", () => {
    expect(multiplyAmount(88888888, 1.125, 8)).toBe(99999999);
    expect(multiplyAmount(12345678, 8.7, 4)).toBe(107407398.6);
  });
});
