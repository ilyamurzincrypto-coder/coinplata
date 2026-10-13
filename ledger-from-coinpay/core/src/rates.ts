/**
 * (Волна 4 к) Чистая логика рыночных курсов — БЕЗ сети/БД (адаптеры и cron отдельно).
 * Курсы у нас в RUB-пивоте: pair 'RUB/USD' rateE6 = RUB за 1 USD; 'RUB/EUR' = RUB за 1 EUR.
 * Источник и время фиксации — в строке курса. Фолбэк — carry-forward с пометкой, не ноль.
 * ЕЦБ (Frankfurter) НЕ отдаёт RUB (санкции) → RUB/EUR ВЫЧИСЛЯЕМ из RUB/USD × USD-per-EUR.
 */
export interface RateQuote {
  pair: string;
  rateE6: bigint;
  source: string; // 'Frankfurter (ЕЦБ)' | 'CoinGecko' | 'ЦБ РФ' | 'перенос с YYYY-MM-DD'
}

/**
 * Сколько дней курс считается годным для денежной операции.
 *
 * 🔴 Свежесть курса — ОДИН ответ на всю платформу. Выплата отказывалась по курсу старше трёх
 * дней, а автоконвертация брала любой, какой лежит: на dev это был 53-дневный евро — со 100 000 ₽
 * клиент получал на ≈78 € больше, чем стоила валюта. Одна и та же сделка проходила или
 * отбивалась в зависимости от того, какой дверью пришли деньги.
 */
export const RATE_MAX_AGE_DAYS = 3;

/**
 * Устарел ли курс этой даты. `date` — 'YYYY-MM-DD' (дата курса, не время записи).
 * `now` параметром, а не из `Date.now()`: величину, от которой зависит отказ по деньгам, тест
 * обязан уметь задать.
 */
export function rateStale(date: string, now: number = Date.now()): boolean {
  const d = new Date(`${date}T00:00:00Z`).getTime();
  if (Number.isNaN(d)) return true; // дата не разобралась — считаем негодной, а не свежей
  return (now - d) / 86_400_000 > RATE_MAX_AGE_DAYS;
}

/** Число → E6 (rateE6 хранит ×1e6). */
export function e6(n: number): bigint {
  return BigInt(Math.round(n * 1_000_000));
}

/** RUB за 1 EUR = (RUB за 1 USD) × (USD за 1 EUR). Оба ×1e6. */
export function deriveRubPerEurE6(rubPerUsdE6: bigint, usdPerEurE6: bigint): bigint {
  return (rubPerUsdE6 * usdPerEurE6) / 1_000_000n;
}

/**
 * (С8-2) Витринный (клиентский) курс = базовый × (1 + курсовой спред). Спред в bp (450 = 4,5%).
 * Спред живёт в КУРСАХ (per-валюта), отдельно от эквайринг-тарифа (% с рублёвого оборота). Integer-точно.
 */
export function applySpread(baseE6: bigint, spreadBp: number): bigint {
  return (baseE6 * BigInt(10_000 + Math.trunc(spreadBp))) / 10_000n;
}

/**
 * (С8-2) Эффективный спред дня = постоянный + разовый (разовый «поверх» на сегодня, ночной синк его обнуляет).
 * `onceBp` null → только постоянный.
 */
export function effectiveSpreadBp(persistentBp: number, onceBp: number | null): number {
  return persistentBp + (onceBp ?? 0);
}

/**
 * (С8-2, доп12в) Кросс-согласованность: ожидаемый RUB/TRY = (RUB/USD) ÷ (рыночный USD/TRY, т.е. TRY за 1 USD).
 * Все ×1e6. Сравнивается с НАШИМ RUB/TRY; отклонение > допуска → сторож-warn «кросс разъехался».
 */
export function crossExpectedRubPerTryE6(rubPerUsdE6: bigint, marketTryPerUsdE6: bigint): bigint {
  if (marketTryPerUsdE6 <= 0n) return 0n;
  return (rubPerUsdE6 * 1_000_000n) / marketTryPerUsdE6;
}

/** Отклонение нашего RUB/TRY от расчётного (кросс) в bp; null если базы нет. */
export function crossDeviationBp(ourRubPerTryE6: bigint, expectedRubPerTryE6: bigint): number | null {
  return rateDeltaBp(ourRubPerTryE6, expectedRubPerTryE6);
}

/** (R4) Пороги скачка день-к-дню по умолчанию (перекрываются fx_settings): фиат 20% / крипта 50%. */
export const RATE_SPIKE_FIAT_BP = 2000;
export const RATE_SPIKE_CRYPTO_BP = 5000;

/** Отклонение fresh от last в bp (|Δ|/last×10000). last≤0 → null (нет базы). */
export function rateDeltaBp(fresh: bigint, last: bigint | null): number | null {
  if (last === null || last <= 0n) return null;
  const diff = fresh > last ? fresh - last : last - fresh;
  return Number((diff * 10000n) / last);
}

/**
 * (R4) Санити-чек курса ПЕРЕД фиксацией: мусорным курсом считаются деньги, поэтому отвергаем
 * ≤0 и скачок >maxDeltaBp от последнего известного. Первый курс (нет базы) — принимаем, если >0.
 */
export function isRateAnomaly(fresh: bigint, last: bigint | null, maxDeltaBp: number): boolean {
  if (fresh <= 0n) return true; // ноль/отрицательное — всегда мусор
  const d = rateDeltaBp(fresh, last);
  if (d === null) return false; // нет базы сравнения → принимаем положительный
  return d > maxDeltaBp;
}

/**
 * Решение по фиксации: свежий прошёл санити → он (первый курс — пометка «первичный»);
 * источник недоступен (fresh=null) ИЛИ фиксация аномальна (≤0/скачок) → перенос последнего С
 * ПОМЕТКОЙ «источник дал аномалию (отклонение X%)» (мусор НЕ пишется — переписывать нечего);
 * нет и последнего → null. `maxDeltaBp` — из fx_settings по типу валюты (фиат/крипта).
 */
export function carryForward(pair: string, fresh: bigint | null, freshSource: string, last: { rateE6: bigint; rateDate: string } | null, maxDeltaBp: number = RATE_SPIKE_FIAT_BP): RateQuote | null {
  if (fresh !== null && fresh > 0n && last && isRateAnomaly(fresh, last.rateE6, maxDeltaBp)) {
    const pct = ((rateDeltaBp(fresh, last.rateE6) ?? 0) / 100).toFixed(1);
    return { pair, rateE6: last.rateE6, source: `перенос с ${last.rateDate} · источник дал аномалию (отклонение ${pct}%)` };
  }
  if (fresh !== null && fresh > 0n) return { pair, rateE6: fresh, source: last ? freshSource : `${freshSource} · первичный` };
  if (last) return { pair, rateE6: last.rateE6, source: `перенос с ${last.rateDate}` };
  return null;
}
