import { describe, it, expect } from "vitest";
import { feedStaleness, formatAge, DEFAULT_STALE_MIN } from "./feedStaleness.js";

const at = (min) => new Date(Date.UTC(2026, 8, 9, 12, 0, 0) - min * 60000).toISOString();
const NOW = Date.UTC(2026, 8, 9, 12, 0, 0);

describe("feedStaleness", () => {
  it("свежий фид: возраст меньше порога", () => {
    const s = feedStaleness([{ pair: "USD_TRY", fetchedAt: at(3) }], { now: NOW });
    expect(s.ageMin).toBe(3);
    expect(s.stale).toBe(false);
    expect(s.empty).toBe(false);
  });

  it("берёт самый свежий снимок, а не первый в массиве", () => {
    const s = feedStaleness(
      [{ fetchedAt: at(120) }, { fetchedAt: at(5) }, { fetchedAt: at(60) }],
      { now: NOW }
    );
    expect(s.ageMin).toBe(5);
  });

  it("устаревший фид: ровно на пороге уже считается устаревшим", () => {
    expect(feedStaleness([{ fetchedAt: at(29) }], { now: NOW }).stale).toBe(false);
    expect(feedStaleness([{ fetchedAt: at(DEFAULT_STALE_MIN) }], { now: NOW }).stale).toBe(true);
  });

  it("реальный кейс 09.09: Tolunay молчит 4 ч 25 мин", () => {
    const s = feedStaleness([{ fetchedAt: at(265) }], { now: NOW });
    expect(s.stale).toBe(true);
    expect(formatAge(s.ageMin)).toBe("4 ч 25 мин");
  });

  it("пустая история — это не «устарел», а «данных нет»", () => {
    const s = feedStaleness([], { now: NOW });
    expect(s).toMatchObject({ lastAt: null, ageMin: null, stale: false, empty: true });
    expect(feedStaleness(null, { now: NOW }).empty).toBe(true);
  });

  it("битые метки времени игнорируются", () => {
    const s = feedStaleness([{ fetchedAt: "не дата" }, { fetchedAt: at(7) }], { now: NOW });
    expect(s.ageMin).toBe(7);
  });

  it("свой порог перекрывает дефолтный", () => {
    expect(feedStaleness([{ fetchedAt: at(12) }], { now: NOW, thresholdMin: 10 }).stale).toBe(true);
  });

  it("formatAge", () => {
    expect(formatAge(0)).toBe("0 мин");
    expect(formatAge(45)).toBe("45 мин");
    expect(formatAge(60)).toBe("1 ч");
    expect(formatAge(125)).toBe("2 ч 5 мин");
    expect(formatAge(null)).toBe("");
  });
});
