// Колонка «Встреча» в секции «Заявки». Логика неочевидная и легко ломается на
// границах суток, а цена ошибки — забытая заявка: если просроченная перестанет
// помечаться, она визуально сольётся с актуальными.
import { describe, it, expect } from "vitest";
import { meetingView, orderInPeriod } from "./DealsLedger.jsx";

// Полдень, чтобы сдвиги на часы не перескакивали через полночь сами по себе.
const NOW = new Date("2026-08-27T12:00:00");

describe("meetingView", () => {
  it("сегодня → лайм-тег с временем, без подписи", () => {
    const v = meetingView(new Date("2026-08-27T09:30:00").toISOString(), NOW);
    expect(v.kind).toBe("today");
    expect(v.label).toBe("сегодня · 09:30");
    expect(v.sub).toBe("");
    expect(v.stale).toBe(false);
  });

  it("сегодня, но время уже прошло — всё ещё «сегодня», не просрочка", () => {
    // 09:00 при NOW=12:00: день тот же, заявку ещё ждут
    const v = meetingView(new Date("2026-08-27T09:00:00").toISOString(), NOW);
    expect(v.kind).toBe("today");
    expect(v.stale).toBe(false);
  });

  it("завтра → «завтра · HH:MM» + подпись «встреча»", () => {
    const v = meetingView(new Date("2026-08-28T18:40:00").toISOString(), NOW);
    expect(v.kind).toBe("future");
    expect(v.label).toBe("завтра · 18:40");
    expect(v.sub).toBe("встреча");
    expect(v.stale).toBe(false);
  });

  it("дальше в будущем → дата вместо слова", () => {
    const v = meetingView(new Date("2026-09-03T10:05:00").toISOString(), NOW);
    expect(v.kind).toBe("future");
    expect(v.label).toBe("03.09 · 10:05");
    expect(v.stale).toBe(false);
  });

  it("прошедшая → гасится и считает дни", () => {
    const v = meetingView(new Date("2026-08-14T19:08:00").toISOString(), NOW);
    expect(v.kind).toBe("past");
    expect(v.label).toBe("14.08 · 19:08");
    expect(v.sub).toBe("прошла · 13 дней");
    expect(v.stale).toBe(true);
  });

  it("вчера → «1 день», а не «1 дней»", () => {
    const v = meetingView(new Date("2026-08-26T15:00:00").toISOString(), NOW);
    expect(v.sub).toBe("прошла · 1 день");
    expect(v.stale).toBe(true);
  });

  it("2-4 дня назад → «дня»", () => {
    expect(meetingView(new Date("2026-08-25T15:00:00").toISOString(), NOW).sub).toBe("прошла · 2 дня");
    expect(meetingView(new Date("2026-08-23T15:00:00").toISOString(), NOW).sub).toBe("прошла · 4 дня");
  });

  it("5+ дней → «дней»", () => {
    expect(meetingView(new Date("2026-08-22T15:00:00").toISOString(), NOW).sub).toBe("прошла · 5 дней");
  });

  it("граница полуночи: вчера 23:59 — просрочка, сегодня 00:01 — нет", () => {
    expect(meetingView(new Date("2026-08-26T23:59:00").toISOString(), NOW).stale).toBe(true);
    const v = meetingView(new Date("2026-08-27T00:01:00").toISOString(), NOW);
    expect(v.kind).toBe("today");
    expect(v.stale).toBe(false);
  });

  it("нет времени встречи или мусор → прочерк, не падает", () => {
    expect(meetingView(null, NOW)).toMatchObject({ kind: "none", label: "—", stale: false });
    expect(meetingView("", NOW)).toMatchObject({ kind: "none" });
    expect(meetingView("не-дата", NOW)).toMatchObject({ kind: "none", label: "—" });
  });
});

// ── Семантика вкладки «Сегодня» ────────────────────────────────────────
// Зафиксировано как РЕШЕНИЕ: просрочка обязана мозолить глаза в дефолтной
// вкладке, иначе забытая заявка морозит резерв и не попадается на глаза.
describe("orderInPeriod", () => {
  const at = (iso) => ({ meetingAt: iso });

  it("«Сегодня» показывает встречи сегодня", () => {
    expect(orderInPeriod(at("2026-08-27T09:30:00"), "today", NOW)).toBe(true);
    expect(orderInPeriod(at("2026-08-27T23:00:00"), "today", NOW)).toBe(true);
  });

  it("«Сегодня» показывает ВСЕ просроченные — они не прячутся во «Все»", () => {
    expect(orderInPeriod(at("2026-08-26T15:00:00"), "today", NOW)).toBe(true);
    expect(orderInPeriod(at("2026-08-11T15:47:00"), "today", NOW)).toBe(true);
    expect(orderInPeriod(at("2026-05-01T10:00:00"), "today", NOW)).toBe(true);
  });

  it("«Сегодня» скрывает будущее — оно всплывёт само", () => {
    expect(orderInPeriod(at("2026-08-28T12:27:00"), "today", NOW)).toBe(false);
    expect(orderInPeriod(at("2026-09-03T10:05:00"), "today", NOW)).toBe(false);
  });

  it("заявка без времени встречи видна всегда — иначе потеряется молча", () => {
    expect(orderInPeriod({ meetingAt: null }, "today", NOW)).toBe(true);
    expect(orderInPeriod({}, "today", NOW)).toBe(true);
    expect(orderInPeriod({ meetingAt: "мусор" }, "today", NOW)).toBe(true);
  });

  it("«Все» пропускает всё, включая будущее", () => {
    expect(orderInPeriod(at("2026-08-28T12:27:00"), "all", NOW)).toBe(true);
    expect(orderInPeriod(at("2026-08-11T15:47:00"), "all", NOW)).toBe(true);
    expect(orderInPeriod({ meetingAt: null }, "all", NOW)).toBe(true);
  });
});
