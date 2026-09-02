// Ориентация курса — класс багов B2/B3: число выглядит правдоподобно, а
// сделка по нему убыточна в разы. Тесты держат оба перевода на реальных
// числах утреннего сообщения 01.09 и живого рынка того же дня.

import { describe, it, expect } from "vitest";
import { documentInverted, toCanonical, toDocument, unitLabel, CURRENCY_STRENGTH } from "./rateOrientation.js";

describe("documentInverted", () => {
  it("сильная слева — документ уже в каноне", () => {
    expect(documentInverted("USDT", "TRY")).toBe(false); // «лир за 1 USDT»
    expect(documentInverted("USDT", "RUB")).toBe(false);
    expect(documentInverted("EUR", "USDT")).toBe(false); // «USDT за 1 EUR»
  });

  it("слабая слева — документ перевёрнут относительно канона", () => {
    expect(documentInverted("TRY", "USDT")).toBe(true);
    expect(documentInverted("RUB", "USDT")).toBe(true);
    expect(documentInverted("USDT", "EUR")).toBe(true); // евро сильнее тезера
  });

  it("равная сила — инверсии нет (USD ↔ USDT)", () => {
    expect(documentInverted("USD", "USDT")).toBe(false);
    expect(documentInverted("USDT", "USD")).toBe(false);
  });

  it("неизвестная валюта не переворачивается молча", () => {
    expect(documentInverted("USDT", "XYZ")).toBe(false);
    expect(documentInverted("XYZ", "USDT")).toBe(false);
  });
});

describe("toCanonical — числа реального сообщения 01.09", () => {
  it("«USDT → TRY 47,40» уже канон: 47,40 лиры за 1 USDT", () => {
    expect(toCanonical("USDT", "TRY", 47.4)).toBe(47.4);
  });

  it("«TRY → USDT 48,35» → 0,020683 USDT за 1 лиру", () => {
    expect(toCanonical("TRY", "USDT", 48.35)).toBeCloseTo(1 / 48.35, 10);
  });

  it("«USDT → EUR 1,173» → 0,8525 евро за 1 USDT", () => {
    // Здесь и был баг на 20,8%: 1,173 это «USDT за 1 евро», а формула QR
    // считала его как «евро за 1 USDT» и делила вместо умножения.
    expect(toCanonical("USDT", "EUR", 1.173)).toBeCloseTo(0.85251, 4);
  });

  it("якорь QR «RUB → USDT 93,45» → 0,010701 USDT за 1 рубль", () => {
    expect(toCanonical("RUB", "USDT", 93.45)).toBeCloseTo(1 / 93.45, 10);
  });

  it("паритетная пара с процентом остаётся как есть", () => {
    expect(toCanonical("USDT", "USD", 0.991)).toBe(0.991);
  });

  it("запятая принимается, ноль и мусор — null", () => {
    expect(toCanonical("USDT", "TRY", "47,40")).toBe(47.4);
    expect(toCanonical("USDT", "TRY", 0)).toBeNull();
    expect(toCanonical("USDT", "TRY", "абв")).toBeNull();
  });
});

describe("toDocument — кассир видит то же, что в сообщении", () => {
  it("канон возвращается в вид документа без потерь", () => {
    for (const [from, to, doc] of [
      ["USDT", "TRY", 47.4], ["TRY", "USDT", 48.35],
      ["USDT", "EUR", 1.173], ["EUR", "USDT", 1.152],
      ["RUB", "USDT", 93.45], ["USDT", "USD", 0.991],
    ]) {
      expect(toDocument(from, to, toCanonical(from, to, doc))).toBeCloseTo(doc, 10);
    }
  });
});

describe("канон делает формулу QR одинаковой для всех валют", () => {
  // Ради этого всё и затевалось: одна формула «якорь × плечо» вместо
  // «делить для лиры, умножать для евро».
  const anchor = toCanonical("RUB", "USDT", 93.45);   // USDT за 1 рубль
  const rubPer = (ccy, docValue) => 1 / (anchor * toCanonical("USDT", ccy, docValue));

  it("рублей за 1 лиру ≈ 1,97 (рынок 1,80 + маржа)", () => {
    expect(rubPer("TRY", 47.4)).toBeCloseTo(1.9715, 3);
  });

  it("рублей за 1 евро ≈ 109,6, а НЕ 79,67 (рынок 100,6)", () => {
    expect(rubPer("EUR", 1.173)).toBeCloseTo(109.62, 1);
  });

  it("рублей за 1 доллар ≈ 94,3 (рынок 86,75)", () => {
    expect(rubPer("USD", 0.991)).toBeCloseTo(94.30, 1);
  });
});

describe("unitLabel", () => {
  it("подпись называет единицу человеческим языком", () => {
    expect(unitLabel("USDT", "TRY")).toBe("TRY за 1 USDT");
    expect(unitLabel("USDT", "EUR")).toBe("USDT за 1 EUR");
  });
});

describe("таблица силы", () => {
  it("порядок: рубль < лира < доллар/тезер < евро", () => {
    const S = CURRENCY_STRENGTH;
    expect(S.RUB).toBeLessThan(S.TRY);
    expect(S.TRY).toBeLessThan(S.USD);
    expect(S.USD).toBe(S.USDT);
    expect(S.USDT).toBeLessThan(S.EUR);
  });
});
