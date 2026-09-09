// src/lib/feedStaleness.js
// Свежесть внешнего фида курсов (Tolunay / Rapira / …).
//
// Зачем: панель курсов рисует цену фида без пометки возраста. Когда источник
// падает (9 сентября tolunaylar.com.tr отдавал Cloudflare 520 больше четырёх
// часов), крон корректно ничего не пишет — а в кассе висит последний снимок
// как будто он текущий, и колонка тренда сравнивает замороженный ряд сам с
// собой и показывает «без изменений». Это деньги, поэтому возраст нужно
// показывать явно.
//
// Порог по умолчанию — 30 минут: крон Tolunay ходит раз в 10 минут, значит
// три пропущенных запуска подряд. Разовый сбой сети не мигает пометкой.

export const DEFAULT_STALE_MIN = 30;

/**
 * @param {{fetchedAt?: string}[]} history — снимки фида, любой порядок
 * @param {{thresholdMin?: number, now?: number}} opts
 * @returns {{lastAt: Date|null, ageMin: number|null, stale: boolean, empty: boolean}}
 *   empty — истории нет вообще (фид ни разу не отдавал; это не «устарел»)
 */
export function feedStaleness(history, { thresholdMin = DEFAULT_STALE_MIN, now = Date.now() } = {}) {
  let newest = null;
  for (const r of history || []) {
    const t = r?.fetchedAt ? new Date(r.fetchedAt).getTime() : NaN;
    if (!Number.isFinite(t)) continue;
    if (newest === null || t > newest) newest = t;
  }
  if (newest === null) return { lastAt: null, ageMin: null, stale: false, empty: true };
  const ageMin = Math.max(0, Math.floor((now - newest) / 60000));
  return { lastAt: new Date(newest), ageMin, stale: ageMin >= thresholdMin, empty: false };
}

// «4 ч 25 мин» / «40 мин» — для подписи под ценой.
export function formatAge(ageMin) {
  if (ageMin == null) return "";
  if (ageMin < 60) return `${ageMin} мин`;
  const h = Math.floor(ageMin / 60);
  const m = ageMin % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}
