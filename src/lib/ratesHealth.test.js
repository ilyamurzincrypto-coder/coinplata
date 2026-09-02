// Здоровье курсов. Главное правило, которое тут проверяется: сводка НЕ имеет
// права быть зеленее худшей своей строки. Именно так неделю жил дашборд —
// панель выглядела рабочей, а ЦБ не грузился вовсе.

import { describe, it, expect } from "vitest";
import {
  LEVEL, worst, ageMin, ageLabel, feedHealth, publicationHealth,
  coverageHealth, deliveryHealth, ratesHealth,
} from "./ratesHealth.js";

const NOW = new Date("2026-09-02T12:00:00Z").getTime();
const agoMin = (m) => new Date(NOW - m * 60000).toISOString();

describe("worst", () => {
  it("одна плохая строка красит всю сводку", () => {
    expect(worst([LEVEL.OK, LEVEL.OK, LEVEL.BAD])).toBe(LEVEL.BAD);
    expect(worst([LEVEL.OK, LEVEL.WARN])).toBe(LEVEL.WARN);
    expect(worst([LEVEL.OK, LEVEL.OK])).toBe(LEVEL.OK);
  });
});

describe("feedHealth", () => {
  it("свежий фид — ok", () => {
    expect(feedHealth("tolunay", agoMin(8), NOW).level).toBe(LEVEL.OK);
  });
  it("граница 2 часа — та же, что у проверки свежести при публикации", () => {
    expect(feedHealth("cbr", agoMin(120), NOW).level).toBe(LEVEL.OK);
    expect(feedHealth("cbr", agoMin(121), NOW).level).toBe(LEVEL.WARN);
  });
  it("старше суток — цифре верить нельзя", () => {
    expect(feedHealth("cbr", agoMin(1441), NOW).level).toBe(LEVEL.BAD);
  });
  it("фид молчит — bad, а не «просто нет данных»", () => {
    // Ровно этот случай неделю выглядел как «курс ещё не загрузился».
    const h = feedHealth("cbr", null, NOW);
    expect(h.level).toBe(LEVEL.BAD);
    expect(h.note).toBe("не отвечает");
  });
});

describe("publicationHealth", () => {
  it("нет публикаций — bad", () => {
    expect(publicationHealth(null, NOW).level).toBe(LEVEL.BAD);
  });
  it("утренняя публикация в течение дня — ok", () => {
    expect(publicationHealth({ version: 1, published_at: agoMin(180) }, NOW).level).toBe(LEVEL.OK);
  });
  it("вчерашний курс — не ok", () => {
    expect(publicationHealth({ version: 1, published_at: agoMin(1500) }, NOW).level).toBe(LEVEL.BAD);
  });
  it("в подписи виден номер версии", () => {
    expect(publicationHealth({ version: 7, published_at: agoMin(30) }, NOW).note).toMatch(/v\. 7/);
  });
});

describe("coverageHealth", () => {
  it("все строки с ценой — ok", () => {
    expect(coverageHealth(42, 0).level).toBe(LEVEL.OK);
  });
  it("часть без цены — предупреждение", () => {
    expect(coverageHealth(42, 1).level).toBe(LEVEL.WARN);
  });
  it("без цены больше, чем с ценой — bad", () => {
    expect(coverageHealth(6, 37).level).toBe(LEVEL.BAD);
  });
});

describe("deliveryHealth", () => {
  it("моста нет — это честное состояние, а не ошибка", () => {
    const h = deliveryHealth(false, null);
    expect(h.level).toBe(LEVEL.OK);
    expect(h.muted).toBe(true);
    expect(h.note).toBe("мост не включён");
  });
  it("мост включён, но не доставлено — bad", () => {
    expect(deliveryHealth(true, null).level).toBe(LEVEL.BAD);
    expect(deliveryHealth(true, { error: "502" }).note).toBe("502");
  });
});

describe("ratesHealth — сводка", () => {
  const base = {
    sources: { tolunay: { fetched_at: agoMin(8) }, cbr: { fetched_at: agoMin(4) } },
    published: { version: 1, published_at: agoMin(120) },
    computed: { prices: new Array(42), errors: [] },
  };

  it("всё живое — зелено", () => {
    expect(ratesHealth(base, NOW).level).toBe(LEVEL.OK);
  });

  it("упавший фид красит сводку, даже если остальное в порядке", () => {
    const h = ratesHealth({ ...base, sources: { ...base.sources, cbr: { fetched_at: null } } }, NOW);
    expect(h.level).toBe(LEVEL.BAD);
  });

  it("«мост не включён» НЕ портит сводку — он приглушён", () => {
    const h = ratesHealth(base, NOW);
    expect(h.items.find((i) => i.kind === "delivery").muted).toBe(true);
    expect(h.level).toBe(LEVEL.OK);
  });

  it("строка на каждый фид плюс публикация, покрытие и доставка", () => {
    expect(ratesHealth(base, NOW).items).toHaveLength(5);
  });
});

describe("ageLabel", () => {
  it("склонения дней", () => {
    expect(ageLabel(1441)).toBe("1 день");
    expect(ageLabel(1440 * 3)).toBe("3 дня");
    expect(ageLabel(1440 * 7)).toBe("7 дней");
  });
  it("нет данных не превращается в ноль минут", () => {
    expect(ageLabel(null)).toBe("нет данных");
    expect(ageMin(null)).toBeNull();
  });
});

describe("«не торгуем» не портит здоровье", () => {
  it("закрытые строки не делают покрытие жёлтым", () => {
    // Paramon присылает прочерк регулярно. Если бы он желтил панель, индикатор
    // был бы жёлтым каждый день и перестал бы что-либо значить.
    const h = coverageHealth(42, 0, 1);
    expect(h.level).toBe(LEVEL.OK);
    expect(h.note).toBe("42 строк · 1 не торгуем");
  });
  it("а настоящий пробел — по-прежнему жёлтый", () => {
    expect(coverageHealth(42, 1, 1).level).toBe(LEVEL.WARN);
    expect(coverageHealth(42, 1, 1).note).toMatch(/1 без · 1 не торгуем/);
  });
});
