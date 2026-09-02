// src/lib/ratesHealth.js
// Здоровье курсов: одним взглядом видно, чем сейчас торгуем и можно ли этому
// верить. Чистый модуль — считает из данных, ничего не грузит сам.
//
// ЗАЧЕМ ОТДЕЛЬНО. Неделю дашборд показывал «Курс ЦБ ещё не загрузился», и это
// считали особенностью фронта, пока не оказалось, что вьюха падает по
// таймауту. Проблема была не в том, что фид сломался, а в том, что НИГДЕ не
// было написано «фид сломался». Здоровье — это место, где такое видно сразу.
//
// ТРИ УРОВНЯ и что они значат для денег:
//   ok    — торгуем спокойно
//   warn  — торговать можно, но человек должен знать (курс стареет)
//   bad   — цифре верить нельзя: её нет, она протухла или не посчиталась

export const LEVEL = { OK: "ok", WARN: "warn", BAD: "bad" };

/** Худший уровень из набора — сводка не имеет права быть зеленее худшей строки. */
export function worst(levels) {
  if (levels.includes(LEVEL.BAD)) return LEVEL.BAD;
  if (levels.includes(LEVEL.WARN)) return LEVEL.WARN;
  return LEVEL.OK;
}

/** Возраст в минутах или null. */
export function ageMin(iso, nowMs = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 60000));
}

/** Человеческий возраст: «12 мин», «3 ч», «2 дня». */
export function ageLabel(min) {
  if (min == null) return "нет данных";
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  const word = d % 10 === 1 && d % 100 !== 11 ? "день" : d % 10 >= 2 && d % 10 <= 4 && (d % 100 < 12 || d % 100 > 14) ? "дня" : "дней";
  return `${d} ${word}`;
}

/**
 * Здоровье авто-фида (Толунай, ЦБ, Rapira).
 * Пороги: до 2 часов — норма (столько же требует publish_rates при проверке
 * свежести), до суток — предупреждение, дальше — цифре верить нельзя.
 */
export function feedHealth(provider, fetchedAt, nowMs = Date.now()) {
  const min = ageMin(fetchedAt, nowMs);
  if (min == null) return { key: provider, kind: "feed", level: LEVEL.BAD, age: null, note: "не отвечает" };
  if (min <= 120) return { key: provider, kind: "feed", level: LEVEL.OK, age: min, note: ageLabel(min) };
  if (min <= 1440) return { key: provider, kind: "feed", level: LEVEL.WARN, age: min, note: `${ageLabel(min)} назад` };
  return { key: provider, kind: "feed", level: LEVEL.BAD, age: min, note: `${ageLabel(min)} назад` };
}

/**
 * Здоровье публикации. Курсы ставят утром, поэтому сутки — граница: вчерашний
 * курс на витрине опаснее отсутствующего, клиент придёт по цене, которой нет.
 */
export function publicationHealth(published, nowMs = Date.now()) {
  if (!published) return { key: "publication", kind: "publication", level: LEVEL.BAD, age: null, note: "публикаций нет" };
  const min = ageMin(published.published_at, nowMs);
  const label = `v. ${published.version} · ${ageLabel(min)}`;
  if (min == null) return { key: "publication", kind: "publication", level: LEVEL.BAD, age: null, note: label };
  if (min <= 720) return { key: "publication", kind: "publication", level: LEVEL.OK, age: min, note: label };
  if (min <= 1440) return { key: "publication", kind: "publication", level: LEVEL.WARN, age: min, note: `${label} назад` };
  return { key: "publication", kind: "publication", level: LEVEL.BAD, age: min, note: `${label} назад` };
}

/**
 * Здоровье покрытия: сколько строк модели осталось без цены.
 * Пустая строка — это не «ноль», это «курса нет», и витрина обязана её скрыть,
 * а не показать прочерком рядом с ценой.
 */
export function coverageHealth(pricesCount, errorsCount, closedCount = 0) {
  const total = pricesCount + errorsCount;
  const tail = closedCount > 0 ? ` · ${closedCount} не торгуем` : "";
  if (total === 0 && closedCount === 0) return { key: "coverage", kind: "coverage", level: LEVEL.BAD, note: "строк нет" };
  // Закрытая строка — осознанное решение менялы, а не пробел в работе:
  // жёлтый индикатор из-за неё загорался бы каждый день, когда Paramon
  // присылает прочерк, и перестал бы что-либо значить.
  if (errorsCount === 0) return { key: "coverage", kind: "coverage", level: LEVEL.OK, note: `${pricesCount} строк${tail}` };
  return {
    key: "coverage",
    kind: "coverage",
    level: errorsCount > pricesCount ? LEVEL.BAD : LEVEL.WARN,
    note: `${pricesCount} с ценой · ${errorsCount} без${tail}`,
  };
}

/**
 * Здоровье доставки в каналы. Моста пока нет — и это ЧЕСТНОЕ состояние, а не
 * ошибка: показываем серым «мост не включён», чтобы никто не решил, что курсы
 * уже уехали на сайт.
 */
export function deliveryHealth(bridgeEnabled, delivery, nowMs = Date.now()) {
  const state = delivery?.state;

  // Мост выключен рубильником — ЧЕСТНОЕ состояние, а не ошибка: показываем
  // серым, чтобы никто не решил, что курсы уже уехали на сайт.
  if (state === "skipped" || (!bridgeEnabled && !state)) {
    return { key: "delivery", kind: "delivery", level: LEVEL.OK, muted: true, note: "мост не включён" };
  }
  if (state === "sent") {
    return {
      key: "delivery", kind: "delivery", level: LEVEL.OK,
      note: `доставлено ${ageLabel(ageMin(delivery.delivered_at, nowMs))} назад`,
    };
  }
  if (state === "failed") {
    return {
      key: "delivery", kind: "delivery", level: LEVEL.BAD,
      note: `не доставлено${delivery.attempts ? ` · попыток ${delivery.attempts}` : ""}`,
      detail: delivery.error || null,
    };
  }
  // pending: опубликовано, но отправка ещё не завершилась. Это НЕ норма —
  // курсы уже считаются актуальными, а каналы их не видели.
  return { key: "delivery", kind: "delivery", level: LEVEL.WARN, note: "ожидает отправки" };
}

/**
 * Сводка для строки-индикатора.
 *   sources  { provider: { fetched_at } }
 *   computed { prices: [], errors: [] }
 */
export function ratesHealth({ sources = {}, published = null, computed = { prices: [], errors: [] }, bridgeEnabled = false, delivery = null } = {}, nowMs = Date.now()) {
  const items = [
    ...Object.entries(sources).map(([p, meta]) => feedHealth(p, meta?.fetched_at, nowMs)),
    publicationHealth(published, nowMs),
    coverageHealth(computed.prices?.length || 0, computed.errors?.length || 0, computed.closed?.length || 0),
    deliveryHealth(bridgeEnabled, delivery, nowMs),
  ];
  return { items, level: worst(items.filter((i) => !i.muted).map((i) => i.level)) };
}
