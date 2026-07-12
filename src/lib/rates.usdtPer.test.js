// src/lib/rates.usdtPer.test.js
// B2 — канонический usdtPer: «USDT за 1 CUR», ориентация БЕЗ STRONG-вайтлиста.
//
// getRate("USDT", cur) возвращает сырой множитель «cur за 1 USDT»:
//   сильные валюты (1 CUR > 1 USDT) → raw < 1  (EUR 0.857, GBP 0.742, CHF 0.787)
//   слабые   валюты (1 CUR < 1 USDT) → raw > 1  (TRY 46.8, RUB 77)
// Правильный usdtPer = 1/raw ДЛЯ ВСЕХ. Старый код с STRONG={USD,EUR} ломал
// ровно сильные валюты вне вайтлиста (GBP/CHF): возвращал raw вместо 1/raw.

import { describe, expect, it } from "vitest";
import { usdtPer } from "./rates.js";

// mock кассового getRate: ключ "from>to" → сырой множитель "to за 1 from"
const RAW = {
  "USDT>USD": 1.0,
  "USDT>EUR": 0.857, // 1 USDT = 0.857 EUR → 1 EUR = 1.167 USDT
  "USDT>GBP": 0.742, // 1 USDT = 0.742 GBP → 1 GBP = 1.348 USDT
  "USDT>CHF": 0.787, // 1 USDT = 0.787 CHF → 1 CHF = 1.271 USDT
  "USDT>TRY": 46.8, // 1 USDT = 46.8 TRY → 1 TRY = 0.02137 USDT
  "USDT>RUB": 77.0, // 1 USDT = 77 RUB → 1 RUB = 0.012987 USDT
};
const getRate = (from, to) => RAW[`${from}>${to}`];

describe("usdtPer — USDT за 1 CUR, без вайтлиста (B2)", () => {
  it("USDT сам к себе = 1", () => {
    expect(usdtPer("USDT", getRate)).toBe(1);
  });

  it("сильные вайтлист-валюты (USD/EUR) — как раньше", () => {
    expect(usdtPer("USD", getRate)).toBeCloseTo(1.0, 3);
    expect(usdtPer("EUR", getRate)).toBeCloseTo(1.167, 3);
  });

  it("GBP — БОЛЬШЕ НЕ инвертируется (старый STRONG давал 0.742)", () => {
    // 1 GBP = 1.348 USDT. Регресс B2.
    expect(usdtPer("GBP", getRate)).toBeCloseTo(1.348, 3);
    expect(usdtPer("GBP", getRate)).not.toBeCloseTo(0.742, 3);
  });

  it("CHF — БОЛЬШЕ НЕ инвертируется (старый STRONG давал 0.787)", () => {
    expect(usdtPer("CHF", getRate)).toBeCloseTo(1.271, 3);
  });

  it("слабые валюты (TRY/RUB) — как раньше", () => {
    expect(usdtPer("TRY", getRate)).toBeCloseTo(0.02137, 4);
    expect(usdtPer("RUB", getRate)).toBeCloseTo(0.012987, 5);
  });

  it("нет курса / мусор → NaN", () => {
    expect(usdtPer("JPY", getRate)).toBeNaN();
    expect(usdtPer("GBP", () => 0)).toBeNaN();
    expect(usdtPer("GBP", () => -1)).toBeNaN();
  });
});
