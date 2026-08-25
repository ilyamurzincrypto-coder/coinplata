// Период ленты «Сделки»: пилюля «Неделя» расширяет запрос через fromIso.
// Проверяем именно границу — она уходит в loadCashierDeals как фильтр по
// effective_date, поэтому ошибка на сутки молча теряет/добавляет день сделок.
import { describe, it, expect } from "vitest";
import { weekStartIso } from "./DealsLedger.jsx";

describe("weekStartIso", () => {
  it("возвращает начало суток 6 днями раньше — окно ровно 7 календарных дней", () => {
    const now = new Date("2026-08-25T15:42:31.123Z");
    const got = new Date(weekStartIso(now));
    expect(got.getFullYear()).toBe(2026);
    expect(got.getMonth()).toBe(7); // август
    expect(got.getDate()).toBe(19); // 25 − 6
    expect(got.getHours()).toBe(0);
    expect(got.getMinutes()).toBe(0);
    expect(got.getSeconds()).toBe(0);
    expect(got.getMilliseconds()).toBe(0);
  });

  it("корректно переходит через границу месяца", () => {
    const got = new Date(weekStartIso(new Date("2026-09-03T09:00:00Z")));
    expect(got.getMonth()).toBe(7); // август
    expect(got.getDate()).toBe(28);
  });

  it("не мутирует переданную дату", () => {
    const now = new Date("2026-08-25T15:42:31.000Z");
    const copy = new Date(now.getTime());
    weekStartIso(now);
    expect(now.getTime()).toBe(copy.getTime());
  });

  it("всегда раньше текущего момента", () => {
    const now = new Date("2026-08-25T00:00:00Z");
    expect(new Date(weekStartIso(now)).getTime()).toBeLessThan(now.getTime());
  });
});
