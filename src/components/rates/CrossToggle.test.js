// Мини-сводка — единственная логика тогла, которую можно проверить без DOM,
// и единственная, где легко соврать: два знака на мелком курсе дают «0,01».

import { describe, it, expect } from "vitest";
import { crossSummary } from "./CrossToggle.jsx";
import { formatCrossValue } from "../../utils/ratesFormat.js";

const S = (rows) => crossSummary(rows, formatCrossValue);

describe("crossSummary", () => {
  it("первое направление каждой пары, два знака, разделитель «·»", () => {
    expect(
      S([
        { a: "USD", b: "EUR", fwd: 0.8427, rev: 1.1333 },
        { a: "USD", b: "RUB", fwd: 80.6122, rev: 0.0103 },
        { a: "EUR", b: "RUB", fwd: 93.2823, rev: 0.0089 },
      ])
    ).toBe("USD/EUR 0,84 · USD/RUB 80,61 · EUR/RUB 93,28");
  });

  it("второе направление в сводку не попадает", () => {
    expect(S([{ a: "USD", b: "EUR", fwd: 0.8427, rev: 1.1333 }])).not.toMatch(/1,13/);
  });

  it("мелкий курс не схлопывается в «0,01» — берётся точный формат", () => {
    // Два знака требует эталон, но 0,0103 при них становится другим числом.
    expect(S([{ a: "RUB", b: "USD", fwd: 0.010330 }])).toBe("RUB/USD 0,01033");
  });

  it("пара без курса пропускается, а не показывает NaN", () => {
    expect(
      S([
        { a: "USD", b: "EUR", fwd: NaN },
        { a: "USD", b: "RUB", fwd: 80.6122 },
        { a: "EUR", b: "RUB", fwd: null },
      ])
    ).toBe("USD/RUB 80,61");
  });

  it("пусто — пустая строка, без «·» на краю", () => {
    expect(S([])).toBe("");
    expect(S(null)).toBe("");
  });
});
