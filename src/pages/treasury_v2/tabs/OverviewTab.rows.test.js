// Балансовая таблица Обзора: какие строки вообще существуют.
//
// Валюта, в которой открыт счёт, обязана быть в таблице, даже если по ней не
// было ни одного движения. Иначе пустой счёт неотличим от незаведённого — а
// это разные вещи: первое чинится сделкой, второе походом в «Счета».
import { describe, it, expect } from "vitest";
import { balanceRows } from "./OverviewTab.jsx";

const moved = [
  { currency: "USD", nostro: 96340, loro: 12400, nostroBase: 96340, loroBase: 12400, capital: 83940, capitalBase: 83940 },
  { currency: "RUB", nostro: 742500, loro: 1120000, nostroBase: 8249, loroBase: 12443, capital: -377500, capitalBase: -4194 },
];

describe("balanceRows", () => {
  it("валюта со счетами, но без движений, остаётся строкой с нулями", () => {
    const rows = balanceRows(moved, new Map([["USD", 7], ["RUB", 4], ["EUR", 2]]));
    const eur = rows.find((r) => r.currency === "EUR");
    expect(eur).toBeTruthy();
    expect(eur).toMatchObject({ nostro: 0, loro: 0, capital: 0, capitalBase: 0 });
  });

  it("нулевая строка сходится: 0 = 0 − 0", () => {
    const [eur] = balanceRows([], new Map([["EUR", 2]]));
    expect(eur.capital).toBe(eur.nostro - eur.loro);
    expect(eur.capital < 0).toBe(false); // значит галочка, а не «!»
  });

  it("валюта с движениями, но без счетов в срезе, не теряется", () => {
    // Офисный фильтр может отрезать счета, а остатки прийти из другого места —
    // деньги важнее аккуратности среза.
    const rows = balanceRows(moved, new Map([["EUR", 2]]));
    expect(rows.map((r) => r.currency).sort()).toEqual(["EUR", "RUB", "USD"]);
  });

  it("сначала валюты с деньгами, пустые — ниже и по алфавиту", () => {
    const rows = balanceRows(moved, new Map([["USD", 7], ["RUB", 4], ["TRY", 3], ["EUR", 2]]));
    expect(rows.map((r) => r.currency)).toEqual(["USD", "RUB", "EUR", "TRY"]);
  });

  it("совсем без счетов и движений строк нет — это другое состояние", () => {
    expect(balanceRows([], new Map())).toEqual([]);
  });
});
