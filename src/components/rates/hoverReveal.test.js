// Направление расшифровки — по смыслу колонки, не по её позиции (r12).
// Ломается это молча: пара просто оказывается перевёрнутой, а число рядом
// правильное — ровно класс B2/B3. Плюс сторожим пробелы вокруг стрелки:
// прошлая механика их съедала на полпути анимации.

import { describe, it, expect } from "vitest";
import { COL_INTO, COL_OUT, makeCols } from "./hoverReveal.jsx";

describe("дескрипторы направлений", () => {
  it("«USDT →» — клиент отдаёт тезер", () => {
    expect(COL_OUT.pair("TRY")).toBe("USDT → TRY");
    expect(COL_OUT.caption).toBe("USDT →");
  });

  it("«→ USDT» — клиент отдаёт валюту", () => {
    expect(COL_INTO.pair("TRY")).toBe("TRY → USDT");
    expect(COL_INTO.caption).toBe("→ USDT");
  });

  it("пробелы вокруг стрелки на месте", () => {
    for (const col of [COL_INTO, COL_OUT]) {
      expect(col.pair("EUR")).toMatch(/\S → \S/);
    }
  });

  it("порядок колонок на пару не влияет", () => {
    // Переходная панель рисует [→USDT, USDT→], блочная — наоборот. Если
    // когда-нибудь пару начнут считать по индексу столбца, этот тест упадёт.
    const transitional = [COL_INTO, COL_OUT];
    const blocks = [COL_OUT, COL_INTO];
    const pairsOf = (cols) => Object.fromEntries(cols.map((c) => [c.key, c.pair("USD")]));
    expect(pairsOf(transitional)).toEqual(pairsOf(blocks));
    expect(pairsOf(blocks)).toEqual({ into: "USD → USDT", out: "USDT → USD" });
  });

  it("ключи направлений различимы", () => {
    expect(COL_INTO.key).not.toBe(COL_OUT.key);
  });
});

describe("makeCols — база блока задаётся, а не зашита", () => {
  it("нал считается к лире теми же правилами, что тезер к USDT", () => {
    const try_ = makeCols("TRY");
    expect(try_.into.caption).toBe("→ TRY");
    expect(try_.into.pair("USD")).toBe("USD → TRY");
    expect(try_.out.caption).toBe("TRY →");
    expect(try_.out.pair("USD")).toBe("TRY → USD");
  });

  it("готовые USDT-константы — тот же конструктор, не копия", () => {
    const u = makeCols("USDT");
    expect(u.into.pair("EUR")).toBe(COL_INTO.pair("EUR"));
    expect(u.out.pair("EUR")).toBe(COL_OUT.pair("EUR"));
  });
});
