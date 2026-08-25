// Расчётный модуль блочной модели курсов. Числа взяты из живой системы:
// TRY/USDT 44,0025 · EUR/USDT 1,1532 · QR-спред 1% · утренний ввод «USDT->USD -0,80%».
import { describe, it, expect } from "vitest";
import {
  num,
  priceKey,
  computeRowPrice,
  deviationPct,
  isOutOfBand,
  computeAll,
  pricesToMap,
  staleSources,
} from "./rateEngine.js";

const blockUsdt = { code: "usdt", kind: "manual", config: {}, position: 2 };
const blockCash = { code: "cash", kind: "auto", config: { provider: "tolunay", spread_pct: 0 }, position: 1 };
const blockQr = { code: "qr", kind: "auto", config: { provider: "cbr", spread_pct: 1 }, position: 4 };
const blockPer = {
  code: "perestanovka",
  kind: "derived",
  config: { base_block_code: "usdt", margin_pct: 1.5 },
  position: 3,
};

describe("num", () => {
  it("принимает запятую — утренний ввод пишут через неё", () => {
    expect(num("44,0025")).toBe(44.0025);
    expect(num("1.1532")).toBe(1.1532);
    expect(num(46.8)).toBe(46.8);
  });
  it("мусор → null, а не NaN", () => {
    expect(num("")).toBe(null);
    expect(num("abc")).toBe(null);
    expect(num(null)).toBe(null);
    expect(num(Infinity)).toBe(null);
  });
});

describe("computeRowPrice — проценты (USD, обе стороны)", () => {
  it("−0,80% → 0,992 (маржа на паре ~1:1)", () => {
    const r = computeRowPrice({ value_mode: "pct", value: -0.8 }, blockUsdt);
    expect(r.rate).toBeCloseTo(0.992, 10);
  });
  it("+0,50% → 1,005 — обратная сторона задаётся своей строкой", () => {
    const r = computeRowPrice({ value_mode: "pct", value: 0.5 }, blockUsdt);
    expect(r.rate).toBeCloseTo(1.005, 10);
  });
  it("0% → ровно 1", () => {
    expect(computeRowPrice({ value_mode: "pct", value: 0 }, blockUsdt).rate).toBe(1);
  });
  it("нет значения → ошибка, а не тихий null", () => {
    expect(computeRowPrice({ value_mode: "pct", value: null }, blockUsdt).error).toMatch(/pct/);
  });
});

describe("computeRowPrice — абсолюты (TRY/EUR/RUB)", () => {
  it("TRY абсолютом отдаётся как есть, читаемым числом > 1", () => {
    expect(computeRowPrice({ value_mode: "abs", value: 44.0025 }, blockUsdt).rate).toBe(44.0025);
  });
  it("EUR 1,1532 — тоже как есть, движок НЕ инвертирует", () => {
    expect(computeRowPrice({ value_mode: "abs", value: 1.1532 }, blockUsdt).rate).toBe(1.1532);
  });
  it("RUB абсолютом", () => {
    expect(computeRowPrice({ value_mode: "abs", value: 81.5 }, blockUsdt).rate).toBe(81.5);
  });
  it("ноль и минус — ошибка (курс не бывает ≤ 0)", () => {
    expect(computeRowPrice({ value_mode: "abs", value: 0 }, blockUsdt).error).toBeTruthy();
    expect(computeRowPrice({ value_mode: "abs", value: -5 }, blockUsdt).error).toBeTruthy();
  });
});

describe("computeRowPrice — source (auto)", () => {
  it("Нал: спред 0 → отдаём 1:1 цену Толуная", () => {
    const r = computeRowPrice({ value_mode: "source" }, blockCash, { sourcePrice: 42.17 });
    expect(r.rate).toBe(42.17);
  });
  it("QR ₽: ЦБ × (1 + 1%)", () => {
    const r = computeRowPrice({ value_mode: "source" }, blockQr, { sourcePrice: 80 });
    expect(r.rate).toBeCloseTo(80.8, 10);
  });
  it("нет котировки → ошибка (не подставляем единицу)", () => {
    expect(computeRowPrice({ value_mode: "source" }, blockCash, {}).error).toMatch(/source/);
  });
});

describe("computeRowPrice — derived (перестановка)", () => {
  it("USDT-цена × (1 + 1,5%)", () => {
    const r = computeRowPrice({ value_mode: "derived" }, blockPer, { basePrice: 44.0025 });
    expect(r.rate).toBeCloseTo(44.0025 * 1.015, 10);
  });
  it("маржа 0 → цена базового блока без изменений", () => {
    const b = { ...blockPer, config: { base_block_code: "usdt", margin_pct: 0 } };
    expect(computeRowPrice({ value_mode: "derived" }, b, { basePrice: 44 }).rate).toBe(44);
  });
  it("нет базовой цены → ошибка", () => {
    expect(computeRowPrice({ value_mode: "derived" }, blockPer, {}).error).toMatch(/derived/);
  });
});

describe("границы (band_pct)", () => {
  it("отклонение считается от прошлой публикации", () => {
    expect(deviationPct(46, 44)).toBeCloseTo(4.5454, 3);
    expect(deviationPct(42, 44)).toBeCloseTo(-4.5454, 3);
  });
  it("первая публикация строки не нарушает границу", () => {
    expect(deviationPct(44, undefined)).toBe(null);
    expect(isOutOfBand(44, undefined, 5)).toBe(false);
  });
  it("в пределах band — не нарушение, за пределами — нарушение", () => {
    expect(isOutOfBand(46, 44, 5)).toBe(false); // 4.5% < 5%
    expect(isOutOfBand(47, 44, 5)).toBe(true); // 6.8% > 5%
    expect(isOutOfBand(41, 44, 5)).toBe(true); // −6.8%
  });
  it("граница симметрична — падение ловится так же, как рост", () => {
    expect(isOutOfBand(44 * 1.06, 44, 5)).toBe(true);
    expect(isOutOfBand(44 * 0.94, 44, 5)).toBe(true);
  });
});

describe("computeAll — полный прогон", () => {
  const blocks = [blockCash, blockUsdt, blockPer, blockQr];
  const rows = [
    { block_code: "usdt", scope: "ANT", from_ccy: "USDT", to_ccy: "USD", value_mode: "pct", value: -0.8, band_pct: 5 },
    { block_code: "usdt", scope: "ANT", from_ccy: "USDT", to_ccy: "TRY", value_mode: "abs", value: 44.0025, band_pct: 5 },
    { block_code: "perestanovka", scope: "ANT", from_ccy: "USDT", to_ccy: "TRY", value_mode: "derived", band_pct: 5 },
    { block_code: "cash", scope: null, from_ccy: "USD", to_ccy: "TRY", value_mode: "source", band_pct: 5 },
    { block_code: "qr", scope: null, from_ccy: "USDT", to_ccy: "RUB", value_mode: "source", band_pct: 5 },
  ];
  const sources = { "tolunay|USD|TRY": 42.17, "cbr|USDT|RUB": 80 };

  it("считает все блоки и раскладывает в плоский прайс", () => {
    const { prices, errors } = computeAll({ blocks, rows, sources });
    expect(errors).toEqual([]);
    expect(prices).toHaveLength(5);
    const m = pricesToMap(prices);
    expect(m["usdt|ANT|USDT|USD"]).toBeCloseTo(0.992, 10);
    expect(m["usdt|ANT|USDT|TRY"]).toBe(44.0025);
    expect(m["cash||USD|TRY"]).toBe(42.17);
    expect(m["qr||USDT|RUB"]).toBeCloseTo(80.8, 10);
  });

  it("derived считается ПОСЛЕ базового блока, даже если стоит раньше по position", () => {
    // перестановка объявлена первой в массиве — порядок должен решаться зависимостью
    const shuffled = [blockPer, blockQr, blockUsdt, blockCash];
    const { prices, errors } = computeAll({ blocks: shuffled, rows, sources });
    expect(errors).toEqual([]);
    const m = pricesToMap(prices);
    expect(m["perestanovka|ANT|USDT|TRY"]).toBeCloseTo(44.0025 * 1.015, 10);
  });

  it("выключенные строки и блоки в прайс не попадают", () => {
    const withDisabled = [
      ...rows,
      { block_code: "usdt", scope: "SPB", from_ccy: "USDT", to_ccy: "RUB", value_mode: "abs", value: 81, band_pct: 5, enabled: false },
    ];
    const { prices } = computeAll({ blocks, rows: withDisabled, sources });
    expect(pricesToMap(prices)["usdt|SPB|USDT|RUB"]).toBeUndefined();
  });

  it("отсутствие котировки не роняет прогон — строка уходит в errors", () => {
    const { prices, errors } = computeAll({ blocks, rows, sources: {} });
    expect(errors.length).toBe(2); // cash и qr без источников
    expect(prices.length).toBe(3); // остальные посчитались
    expect(errors[0]).toHaveProperty("key");
  });

  it("нарушения границ собираются списком, прайс всё равно считается", () => {
    const previous = { "usdt|ANT|USDT|TRY": 30 }; // +46% — далеко за 5%
    const { prices, violations } = computeAll({ blocks, rows, sources, previous });
    expect(prices).toHaveLength(5);
    expect(violations).toHaveLength(1);
    expect(violations[0].key).toBe("usdt|ANT|USDT|TRY");
    expect(violations[0].deviationPct).toBeCloseTo(46.675, 2);
    expect(violations[0].bandPct).toBe(5);
  });

  it("цикл в derived не вешает расчёт", () => {
    const a = { code: "a", kind: "derived", config: { base_block_code: "b", margin_pct: 1 }, position: 1 };
    const b = { code: "b", kind: "derived", config: { base_block_code: "a", margin_pct: 1 }, position: 2 };
    const r = computeAll({
      blocks: [a, b],
      rows: [{ block_code: "a", scope: null, from_ccy: "X", to_ccy: "Y", value_mode: "derived", band_pct: 5 }],
      sources: {},
    });
    expect(r.errors).toHaveLength(1); // базовой цены нет — но не зависли
  });
});

describe("staleSources", () => {
  const now = new Date("2026-08-25T12:00:00Z").getTime();
  it("свежая котировка проходит", () => {
    expect(staleSources({ tolunay: { fetched_at: "2026-08-25T11:30:00Z" } }, now)).toEqual([]);
  });
  it("старше 2 часов — блокирует публикацию", () => {
    const r = staleSources({ tolunay: { fetched_at: "2026-08-25T09:00:00Z" } }, now);
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe("устарело");
  });
  it("нет отметки времени — тоже блокирует, а не считается свежим", () => {
    expect(staleSources({ cbr: {} }, now)[0].reason).toMatch(/нет отметки/);
  });
});
