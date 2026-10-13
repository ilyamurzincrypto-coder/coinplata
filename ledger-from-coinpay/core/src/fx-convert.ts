/**
 * (Волна 4 и) Приведение сумм к $/€ — ЧИСТО и ТОЛЬКО для ВИТРИНЫ (display-слой).
 * ГРАНИЦА ТОЧНОСТИ (подтверждено владельцем 07-28): в проводки, Σ-контроль и леджер этот
 * пересчёт НЕ лезет — леджер живёт в своих валютах, приведение $/€ это отображение.
 * Никаких balance += x: конвертация не создаёт и не двигает деньги, только показывает эквивалент.
 *
 * Опора расчёта — RUB-пивот (курсы у нас в RUB за 1 единицу): rubPerUsdE6 из пары RUB/USD,
 * rubPerEurE6 из RUB/EUR (появится в (к) — до него евро-колонка = «—»/null). Крипта без
 * курса → null. rateE6: 1 единица = rateE6/1e6 RUB.
 */
export interface DisplayRates {
  rubPerUsdE6: bigint | null;
  rubPerEurE6?: bigint | null;
}

/** Эквивалент суммы в USD (minor, 2 знака). null — курса нет (крипта/нет пары). */
export function toUsdMinor(amountMinor: bigint, currency: string, r: DisplayRates): bigint | null {
  if (currency === 'USD') return amountMinor;
  if (currency === 'RUB') return r.rubPerUsdE6 ? (amountMinor * 1_000_000n) / r.rubPerUsdE6 : null;
  if (currency === 'EUR') return r.rubPerEurE6 && r.rubPerUsdE6 ? (amountMinor * r.rubPerEurE6) / r.rubPerUsdE6 : null; // EUR→RUB→USD
  return null;
}

/** Эквивалент суммы в EUR (minor). null — курса евро ещё нет (до (к)) или крипта. */
export function toEurMinor(amountMinor: bigint, currency: string, r: DisplayRates): bigint | null {
  if (!r.rubPerEurE6) return null;
  if (currency === 'EUR') return amountMinor;
  if (currency === 'RUB') return (amountMinor * 1_000_000n) / r.rubPerEurE6;
  if (currency === 'USD') return r.rubPerUsdE6 ? (amountMinor * r.rubPerUsdE6) / r.rubPerEurE6 : null; // USD→RUB→EUR
  return null;
}

/** Сумма эквивалентов по списку (для строки «Итого» в валюте приведения). null-строки пропускаются. */
export function sumUsdMinor(rows: { amountMinor: bigint; currency: string }[], r: DisplayRates): bigint {
  return rows.reduce((s, x) => s + (toUsdMinor(x.amountMinor, x.currency, r) ?? 0n), 0n);
}
export function sumEurMinor(rows: { amountMinor: bigint; currency: string }[], r: DisplayRates): bigint | null {
  if (!r.rubPerEurE6) return null;
  return rows.reduce((s, x) => s + (toEurMinor(x.amountMinor, x.currency, r) ?? 0n), 0n);
}
