import { describe, expect, it } from "vitest";
import { ROLE, SECTION, presentAmount, presentSign, roleLabel, roleOf, sectionOf } from "./accountRoles.js";

describe("роль счёта", () => {
  it("активы, обязательства и капитал распознаются", () => {
    expect(roleOf({ type: "cash" })).toBe(ROLE.ASSET);
    expect(roleOf({ type: "bank" })).toBe(ROLE.ASSET);
    expect(roleOf({ type: "liability" })).toBe(ROLE.LIABILITY);
    expect(roleOf({ type: "equity" })).toBe(ROLE.CAPITAL);
  });

  /**
   * 🔴 Неизвестное ПОКАЗЫВАЕМ. Тихая раскладка нераспознанного счёта в «ближайший подходящий»
   * раздел искажает итог раздела и при этом выглядит нормально — ровно та ложь витрины, из-за
   * которой в CoinPay зелёная галочка стояла над неработающим механизмом.
   */
  it("нераспознанный тип уходит в отдельный раздел, а не в ближайший", () => {
    expect(roleOf({ type: "что-то новое" })).toBe(ROLE.UNKNOWN);
    expect(sectionOf({ type: "что-то новое" })).toBe(SECTION.UNSORTED);
    expect(roleLabel({ type: "что-то новое" })).toContain("не распознан");
  });

  it("счёт без типа тоже виден, а не прячется", () => {
    expect(sectionOf({})).toBe(SECTION.UNSORTED);
  });
});

describe("раздел экрана", () => {
  it("активы — в Ностро и кассы", () => {
    expect(sectionOf({ type: "cash" })).toBe(SECTION.NOSTRO);
  });

  it("обязательство ПЕРЕД КЛИЕНТОМ — Лоро", () => {
    // Лоро отличает требование клиентского измерения: остаток такого счёта всегда «чей-то».
    expect(sectionOf({ type: "liability", clientDimRequired: true })).toBe(SECTION.LORO);
    expect(sectionOf({ type: "liability", partnerDimRequired: true })).toBe(SECTION.LORO);
  });

  it("обязательство БЕЗ клиента — не Лоро, а Капитал", () => {
    // Это наше собственное обязательство, а не чужие деньги у нас.
    expect(sectionOf({ type: "liability" })).toBe(SECTION.CAPITAL);
  });
});

describe("знак показываемого остатка", () => {
  /**
   * Канон: presented = asset ? −raw : raw. Благодаря ему выполняется тождество
   * Ностро − Лоро = Капитал построчно по валюте.
   */
  it("актив показывается с обратным знаком", () => {
    expect(presentSign(ROLE.ASSET)).toBe(-1);
    expect(presentAmount("-100.50", ROLE.ASSET)).toBe("100.50");
    expect(presentAmount("100.50", ROLE.ASSET)).toBe("-100.50");
  });

  it("пассив и капитал — как есть", () => {
    expect(presentAmount("-100.50", ROLE.LIABILITY)).toBe("-100.50");
    expect(presentAmount("100.50", ROLE.CAPITAL)).toBe("100.50");
  });

  it("ноль знака не меняет", () => {
    // «−0,00» на экране выглядит как ошибка и заставляет искать несуществующую недостачу.
    expect(presentAmount("0", ROLE.ASSET)).toBe("0");
    expect(presentAmount("0.00", ROLE.ASSET)).toBe("0.00");
  });

  it("отсутствующий остаток остаётся отсутствующим", () => {
    expect(presentAmount(null, ROLE.ASSET)).toBeNull();
    expect(presentAmount("", ROLE.ASSET)).toBeNull();
  });
});
