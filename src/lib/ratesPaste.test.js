// Матрица адаптера вставки (PR-B2). Проверяется ровно то, что ломается тихо:
// форма значения (процент против абсолюта), сырое значение в поле, город вне
// модели, непристланная строка и мусорная строка.

import { describe, it, expect } from "vitest";
import { pasteToDraft, pasteSummary } from "./ratesPaste.js";
import { toDocument } from "./rateOrientation.js";

/** Значение строки в том виде, в каком его написал Paramon. */
const asDocument = (draft, rowId, from, to) =>
  toDocument(from, to, String(draft[rowId]).replace(",", "."));

// Модель как в проде: USD — процент, TRY/EUR — абсолют, SPB в блоке нет.
const BLOCKS = [
  {
    code: "usdt",
    scopes: ["ANT", "IST", "MSK"],
    rows: [
      { id: "r-ant-usd", scope: "ANT", from_ccy: "USDT", to_ccy: "USD", value_mode: "pct" },
      { id: "r-ant-try", scope: "ANT", from_ccy: "USDT", to_ccy: "TRY", value_mode: "abs" },
      { id: "r-ant-eur", scope: "ANT", from_ccy: "USDT", to_ccy: "EUR", value_mode: "abs" },
      { id: "r-msk-rub", scope: "MSK", from_ccy: "USDT", to_ccy: "RUB", value_mode: "abs" },
      { id: "r-off", scope: "IST", from_ccy: "USDT", to_ccy: "TRY", value_mode: "abs", enabled: false },
    ],
  },
  {
    code: "qr",
    scopes: ["ANT", "IST"],
    rows: [
      { id: "r-qr-ant", scope: "ANT", from_ccy: "RUB", to_ccy: "USDT", value_mode: "abs" },
      { id: "r-qr-ist", scope: "IST", from_ccy: "RUB", to_ccy: "USDT", value_mode: "abs" },
    ],
  },
  {
    code: "nerez",
    scopes: ["TOD-TOD", "TOD-TOM"],
    rows: [
      { id: "r-nz-sell", scope: "TOD-TOD", from_ccy: "USDT", to_ccy: "RUB", value_mode: "abs" },
      { id: "r-nz-buy", scope: "TOD-TOD", from_ccy: "RUB", to_ccy: "USDT", value_mode: "abs" },
    ],
  },
];

describe("pasteToDraft", () => {
  it("процент кладёт СЫРЫМ: −1,00% → «-1», а не 0,99", () => {
    const { draft } = pasteToDraft({ blocks: BLOCKS, text: "ANT\nUSDT -> USD  -1,00%" });
    // Пересчёт в 0,99 — работа rateEngine. Если он произойдёт здесь, формула
    // окажется в двух местах и разойдётся.
    expect(draft["r-ant-usd"]).toBe("-1");
  });

  it("абсолют кладётся как есть, запятой", () => {
    const { draft } = pasteToDraft({ blocks: BLOCKS, text: "ANT\nUSDT -> TRY  45,50" });
    expect(draft["r-ant-try"]).toBe("45,5");
  });

  it("процент из документа в абсолютную строку НЕ кладётся", () => {
    const { draft, unmatched } = pasteToDraft({ blocks: BLOCKS, text: "ANT\nUSDT -> TRY  -0,80%" });
    expect(draft["r-ant-try"]).toBeUndefined();
    expect(unmatched[0].reason).toMatch(/абсолюте, в документе процент/);
  });

  it("абсолют из документа в процентную строку НЕ кладётся", () => {
    const { unmatched } = pasteToDraft({ blocks: BLOCKS, text: "ANT\nUSDT -> USD  1,02" });
    expect(unmatched[0].reason).toMatch(/процентах, в документе абсолют/);
  });

  it("город вне модели (SPB) — в «не распознано», остальное применяется", () => {
    const { draft, unmatched } = pasteToDraft({
      blocks: BLOCKS,
      text: "SPB\nUSDT -> RUB  81,00\nANT\nUSDT -> TRY  45,50",
    });
    expect(draft["r-ant-try"]).toBe("45,5");
    expect(unmatched.some((u) => /SPB USDT→RUB/.test(u.reason))).toBe(true);
  });

  it("непристланная пара просто отсутствует в черновике — значение наследуется", () => {
    const { draft } = pasteToDraft({ blocks: BLOCKS, text: "ANT\nUSDT -> TRY  45,50" });
    // EUR в документе не было: ключа нет вовсе, и публикация возьмёт
    // сохранённое значение строки. Пустая строка тут означала бы «сотри курс».
    expect(Object.prototype.hasOwnProperty.call(draft, "r-ant-eur")).toBe(false);
    expect(draft["r-ant-eur"]).toBeUndefined();
  });

  it("мусорная строка не мешает соседним", () => {
    const { draft, unmatched } = pasteToDraft({
      blocks: BLOCKS,
      text: "ANT\nзвонил Мехмет, курс держим\nUSDT -> TRY  45,50",
    });
    expect(draft["r-ant-try"]).toBe("45,5");
    expect(unmatched.length).toBe(1);
  });

  it("выключенная строка не получает значение", () => {
    const { draft, unmatched } = pasteToDraft({ blocks: BLOCKS, text: "IST\nUSDT -> TRY  45,50" });
    expect(draft["r-off"]).toBeUndefined();
    expect(unmatched.some((u) => /выключена/.test(u.reason))).toBe(true);
  });

  it("СБП ложится во все города QR-блока: в документе он без города", () => {
    const { draft } = pasteToDraft({ blocks: BLOCKS, text: "RUB QR СБП>> USDT 75,50" });
    // В МОДЕЛИ — канон «USDT за 1 рубль», в ДОКУМЕНТЕ — присланные 75,50.
    expect(asDocument(draft, "r-qr-ant", "RUB", "USDT")).toBeCloseTo(75.5, 10);
    expect(asDocument(draft, "r-qr-ist", "RUB", "USDT")).toBeCloseTo(75.5, 10);
    expect(Number(String(draft["r-qr-ant"]).replace(",", "."))).toBeCloseTo(1 / 75.5, 10);
  });

  it("НЕРЕЗ: Sell → USDT→RUB, Buy → RUB→USDT", () => {
    const { draft } = pasteToDraft({
      blocks: BLOCKS,
      text: "USDT - RUB (НЕРЕЗ)\nSell:\nTOD-TOD 81,20\nBuy:\nTOD-TOD 80,10",
    });
    // Продажа: USDT сильнее рубля, документ уже в каноне.
    expect(draft["r-nz-sell"]).toBe("81,2");
    // Покупка: RUB→USDT — документ перевёрнут, в модели канон.
    expect(asDocument(draft, "r-nz-buy", "RUB", "USDT")).toBeCloseTo(80.1, 10);
  });

  it("НЕРЕЗ с базисом вне модели — в «не распознано»", () => {
    const { unmatched } = pasteToDraft({
      blocks: BLOCKS,
      text: "USDT - RUB (НЕРЕЗ)\nSell:\nTOM-TOM 81,20",
    });
    expect(unmatched.some((u) => /TOM-TOM/.test(u.reason))).toBe(true);
  });

  it("пустой текст — пустой черновик, без исключений", () => {
    const r = pasteToDraft({ blocks: BLOCKS, text: "" });
    expect(r.draft).toEqual({});
    expect(r.matched).toEqual([]);
  });

  it("сводка считает по блокам", () => {
    const r = pasteToDraft({
      blocks: BLOCKS,
      text: "ANT\nUSDT -> USD -1,00%\nUSDT -> TRY 45,50\nRUB QR СБП>> USDT 75,50",
    });
    const s = pasteSummary(r);
    expect(s.byBlock).toEqual({ usdt: 2, qr: 2 });
    expect(s.total).toBe(4);
  });
});

describe("«не торгуем сегодня» из прочерка", () => {
  const NEREZ = `USDT - RUB (НЕРЕЗ)
Sell
TOD-TOD ---
TOD-TOM 87,13
Buy
TOD-TOD 86,34`;

  it("прочерк помечает строку закрытой, а не оставляет её пустой", () => {
    const r = pasteToDraft({ blocks: BLOCKS, text: NEREZ });
    expect(r.closed["r-nz-sell"]).toBe(true);
    expect(r.draft["r-nz-sell"]).toBeUndefined();
  });

  it("вчерашнее значение по закрытой строке снимается", () => {
    // Иначе унаследованная цена уедет в публикацию как сегодняшняя — это и
    // есть «торговать по курсу, которого нет».
    const twice = `USDT - RUB (НЕРЕЗ)
Sell
TOD-TOD 81,00
TOD-TOD ---`;
    const r = pasteToDraft({ blocks: BLOCKS, text: twice });
    expect(r.draft["r-nz-sell"]).toBeUndefined();
    expect(r.closed["r-nz-sell"]).toBe(true);
  });

  it("соседние базисы и вторая сторона не задеты", () => {
    const r = pasteToDraft({ blocks: BLOCKS, text: NEREZ });
    expect(asDocument(r.draft, "r-nz-buy", "RUB", "USDT")).toBeCloseTo(86.34, 10);
  });

  it("в сводке закрытые считаются отдельно от распознанных", () => {
    const s = pasteSummary(pasteToDraft({ blocks: BLOCKS, text: NEREZ }));
    expect(s.closed).toBe(1);
    expect(s.byBlock).toEqual({ nerez: 1 });
  });
});
