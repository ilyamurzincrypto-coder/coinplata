// Колонка «Активность»: показываем давность, а не сырую метку.
//
// «2001-04-20 12:58» формально точнее, но по ней не видно главного — насколько
// давно это было, а именно за этим в колонку и смотрят.
import { describe, it, expect } from "vitest";
import { formatActivity } from "./ListTab.jsx";

const t = (k) => ({
  cp_today: "сегодня", cp_yesterday: "вчера", cp_days_ago: "{n} дн назад",
}[k] || "");

const NOW = new Date("2026-09-08T18:00:00").getTime();

describe("formatActivity", () => {
  it("сегодня — с временем сделки", () => {
    expect(formatActivity("2026-09-08 14:03", t, NOW)).toBe("сегодня · 14:03");
  });

  it("вчера — без времени: точность там уже не нужна", () => {
    expect(formatActivity("2026-09-07 11:16", t, NOW)).toBe("вчера");
  });

  it("на этой неделе — в днях", () => {
    expect(formatActivity("2026-09-05 10:00", t, NOW)).toBe("3 дн назад");
  });

  it("дальше месяца — датой: «40 дн назад» уже ни о чём не говорит", () => {
    expect(formatActivity("2026-04-20 12:58", t, NOW)).toBe("20.04.26");
  });

  it("дата без времени не превращается в «сегодня · 00:00»", () => {
    expect(formatActivity("2026-09-08", t, NOW)).toBe("сегодня");
  });

  it("пустое и мусор не роняют строку", () => {
    expect(formatActivity("", t, NOW)).toBe("");
    expect(formatActivity(null, t, NOW)).toBe("");
    expect(formatActivity("не дата", t, NOW)).toBe("не дата");
  });
});
