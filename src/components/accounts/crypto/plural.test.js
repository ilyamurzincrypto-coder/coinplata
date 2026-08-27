// Склонение счётчиков в строке-группе офиса («1 нулевой · 5 нулевых»).
// Русские правила легко ломаются на 11-14 и на 21/101 — прибиваем тестами.
import { describe, it, expect } from "vitest";
import { plural } from "./CryptoAccountsList.jsx";

const nul = (n) => `${n} ${plural(n, "нулевой", "нулевых", "нулевых")}`;
const day = (n) => `${n} ${plural(n, "день", "дня", "дней")}`;

describe("plural", () => {
  it("1 → одна форма, 2-4 → вторая, 5-20 → третья", () => {
    expect(day(1)).toBe("1 день");
    expect(day(2)).toBe("2 дня");
    expect(day(4)).toBe("4 дня");
    expect(day(5)).toBe("5 дней");
    expect(day(20)).toBe("20 дней");
  });

  it("11-14 — исключение: «дней», а не «день/дня»", () => {
    expect(day(11)).toBe("11 дней");
    expect(day(12)).toBe("12 дней");
    expect(day(13)).toBe("13 дней");
    expect(day(14)).toBe("14 дней");
  });

  it("21 / 101 снова берут первую форму", () => {
    expect(day(21)).toBe("21 день");
    expect(day(101)).toBe("101 день");
    expect(day(111)).toBe("111 дней"); // но 111 — снова исключение
  });

  it("22-24 → вторая форма", () => {
    expect(day(22)).toBe("22 дня");
    expect(day(23)).toBe("23 дня");
  });

  it("ноль → третья форма", () => {
    expect(day(0)).toBe("0 дней");
  });

  it("счётчик нулевых кошельков в группе офиса", () => {
    expect(nul(1)).toBe("1 нулевой");
    expect(nul(2)).toBe("2 нулевых");
    expect(nul(5)).toBe("5 нулевых");
  });
});
