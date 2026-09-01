// Сцепка «офис → город» — место, где города и офисы легче всего перепутать.
// В Анталье три офиса, и город у них один; питерский офис называется «St.pt»
// и под наивное /spb|питер/ не подходил вовсе.

import { describe, it, expect } from "vitest";
import { officeCityMap } from "./ratesV2.js";

// Живой справочник прода на 02.09.2026.
const PROD = [
  { id: "o-liman", name: "Liman", city: "Antalya", active: true },
  { id: "o-mark", name: "Mark Antalya", city: "Antalya", active: true },
  { id: "o-terra", name: "Terra City", city: "Antalya", active: true },
  { id: "o-ist", name: "Istanbul", city: "Istanbul", active: true },
  { id: "o-msk", name: "Москва Вася", city: "Москва", active: true },
  { id: "o-spb", name: "St.pt", city: "St.pt", active: false },
  { id: "o-intl", name: "International Office", city: "Worldwide", active: false },
];

describe("officeCityMap", () => {
  it("три офиса Антальи дают ОДИН город, а не три", () => {
    const m = officeCityMap(PROD);
    expect([m["o-liman"], m["o-mark"], m["o-terra"]]).toEqual(["ANT", "ANT", "ANT"]);
  });

  it("«St.pt» — это SPB", () => {
    // Здесь была своя копия правил, разошедшаяся с оригиналом: под
    // /spb|питер|санкт/ строка «St.pt» не подходила, и питерский офис не
    // резолвился ни в один город. Матчер теперь импортируется.
    expect(officeCityMap(PROD)["o-spb"]).toBe("SPB");
  });

  it("офис вне городов курсов остаётся без кода, а не липнет к первому", () => {
    expect(officeCityMap(PROD)["o-intl"]).toBeUndefined();
  });

  it("Москва и Стамбул не путаются между собой", () => {
    const m = officeCityMap(PROD);
    expect(m["o-msk"]).toBe("MSK");
    expect(m["o-ist"]).toBe("IST");
  });

  it("пустой список не роняет", () => {
    expect(officeCityMap([])).toEqual({});
    expect(officeCityMap(null)).toEqual({});
  });
});
