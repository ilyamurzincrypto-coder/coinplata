// Проверка каждой котировки против рынка. Тесты держат ровно те случаи, из-за
// которых модуль появился: перевёрнутый курс, разнобой единиц и «слишком
// хорошая» цена, которую границы вчерашнего дня не поймают.

import { describe, it, expect } from "vitest";
import {
  marketIndex, auditQuote, auditSpread, auditOrientation, auditAll,
  VERDICT, pairKey,
} from "./ratesAudit.js";

const MARKET = marketIndex([
  { source: "binance", pair: "USDT_TRY", mid: 48.185 },
  { source: "binance", pair: "EUR_USDT", mid: 1.1617 },
  { source: "rapira", pair: "USDT_RUB", mid: 88.5 },
  { source: "cbr", pair: "TRY_RUB", mid: 1.79919 },
  { source: "cbr", pair: "EUR_RUB", mid: 100.599 },
  { source: "tolunay", pair: "USD_TRY", mid: 47.9 },
  { source: "tcmb", pair: "USD_TRY", mid: 48.2325 },
]);

const q = (from, to, rate, block = "usdt", scope = "ANT") => ({ block, scope, from, to, rate });

describe("marketIndex", () => {
  it("пара неупорядочена: EUR/USDT и USDT/EUR — одна", () => {
    expect(pairKey("USDT", "EUR")).toBe(pairKey("EUR", "USDT"));
    expect(MARKET[pairKey("USDT", "EUR")].value).toBe(1.1617);
  });

  it("приоритет источников фиксирован — вердикт не пляшет от прогона", () => {
    // USD/TRY есть и у tolunay, и у tcmb: берётся tcmb (выше в списке).
    expect(MARKET[pairKey("USD", "TRY")].source).toBe("tcmb");
  });
});

describe("auditQuote", () => {
  it("наш курс с маржой — в норме", () => {
    expect(auditQuote(q("USDT", "TRY", 47.4), MARKET).verdict).toBe(VERDICT.OK);
  });

  it("отклонение в разы — плохо", () => {
    expect(auditQuote(q("USDT", "TRY", 62), MARKET).verdict).toBe(VERDICT.BAD);
  });

  it("обратная ориентация распознаётся и НАЗЫВАЕТСЯ", () => {
    // 0,0208 = «USDT за 1 лиру». Число верное, единицы другие.
    const r = auditQuote(q("USDT", "TRY", 1 / 48.185), MARKET);
    expect(r.inverted).toBe(true);
    expect(r.note).toMatch(/обратная ориентация/);
  });

  it("обратная ориентация сама по себе НЕ приговор", () => {
    // Нал берёт RUB/TRY у Толуная как «лир за рубль» — здоровая цифра.
    // Если бы это считалось поломкой, тревога горела бы каждый день.
    const r = auditQuote(q("RUB", "TRY", 0.5558, "cash", null), MARKET);
    expect(r.verdict).toBe(VERDICT.OK);
  });

  it("паритет USDT↔USD проверяется без рынка", () => {
    expect(auditQuote(q("USDT", "USD", 0.991), MARKET).verdict).toBe(VERDICT.OK);
    expect(auditQuote(q("USDT", "USD", 1.4), MARKET).verdict).toBe(VERDICT.BAD);
  });

  it("нет рыночной пары — честное «сверить нечем», а не «ok»", () => {
    expect(auditQuote(q("GBP", "CHF", 1.1), MARKET).verdict).toBe(VERDICT.NOREF);
  });

  it("ноль и мусор — плохо", () => {
    expect(auditQuote(q("USDT", "TRY", 0), MARKET).verdict).toBe(VERDICT.BAD);
    expect(auditQuote(q("USDT", "TRY", NaN), MARKET).verdict).toBe(VERDICT.BAD);
  });
});

describe("auditOrientation — разнобой единиц в одной публикации", () => {
  it("одна пара в двух ориентациях — ловится", () => {
    // Именно это и опасно для моста: каждое число само по себе сходится с
    // рынком, а потребитель читает список по одному правилу.
    const quotes = [
      auditQuote(q("RUB", "TRY", 0.5, "cash", null), MARKET),
      auditQuote(q("TRY", "RUB", 1.857, "perestanovka", "a→b"), MARKET),
    ];
    const clash = auditOrientation(quotes);
    expect(clash).toHaveLength(1);
    expect(clash[0].pair).toBe("RUB/TRY");
    expect(clash[0].examples).toHaveLength(2);
  });

  it("единая ориентация — тишина", () => {
    const quotes = [
      auditQuote(q("USDT", "TRY", 47.4), MARKET),
      auditQuote(q("TRY", "USDT", 48.35), MARKET),
    ];
    expect(auditOrientation(quotes)).toHaveLength(0);
  });
});

describe("auditSpread", () => {
  it("обе стороны равны — спреда нет, это предупреждение", () => {
    const r = auditSpread([q("USDT", "TRY", 47.4), q("TRY", "USDT", 47.4)]);
    expect(r[0].verdict).toBe(VERDICT.WARN);
  });

  it("нормальный спред — ok, и он посчитан", () => {
    const r = auditSpread([q("USDT", "TRY", 47.4), q("TRY", "USDT", 48.35)]);
    expect(r[0].verdict).toBe(VERDICT.OK);
    expect(r[0].spreadPct).toBeCloseTo(2.0, 1);
  });

  it("пара без обратной стороны в проверку не попадает", () => {
    expect(auditSpread([q("USDT", "TRY", 47.4)])).toHaveLength(0);
  });
});

describe("auditAll", () => {
  it("сводка считает всё по категориям", () => {
    const r = auditAll([q("USDT", "TRY", 47.4), q("USDT", "TRY", 62, "usdt", "IST")], [
      { source: "binance", pair: "USDT_TRY", mid: 48.185 },
    ]);
    expect(r.summary.total).toBe(2);
    expect(r.summary.ok).toBe(1);
    expect(r.summary.bad).toBe(1);
  });
});
