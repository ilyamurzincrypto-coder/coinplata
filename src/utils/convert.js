// src/utils/convert.js
// Универсальная конвертация сумм между валютами через rates store.
// Использует triangulation через USD если прямого курса нет.

import { multiplyAmount, precisionOf } from "./money.js";

// A rate is only usable if it's a finite positive number. `getRate` may return
// `undefined`/`null` (no pair) or, after a botched edit, `0` — all of those mean
// "no rate" and must NOT be treated as a valid 0× conversion (that would silently
// zero out a whole currency's balances/P&L in base).
function validRate(r) {
  return typeof r === "number" && Number.isFinite(r) && r > 0;
}

// Throttle the "no rate path" warning so a render loop can't spam the console —
// one line per ordered (from→to) pair per session.
const _warnedPairs = new Set();
function warnNoRate(from, to) {
  const k = `${from}→${to}`;
  if (_warnedPairs.has(k)) return;
  _warnedPairs.add(k);
  // eslint-disable-next-line no-console
  console.warn(`[convert] no rate path ${k} — amount treated as 0 in ${to}. Set the rate in Settings → Rates.`);
}

/**
 * Конвертирует amount из валюты `from` в валюту `to`.
 * getRate — функция из useRates().
 *
 * Приоритет:
 * 1. Если from === to → возвращает исходную сумму
 * 2. Прямой курс from → to (если положительный)
 * 3. Через USD: from → USD → to
 *
 * Если нигде нет валидного курса — возвращает 0 и пишет предупреждение в консоль.
 */
export function convert(amount, from, to, getRate) {
  if (!amount || amount === 0) return 0;
  if (from === to) return amount;

  const direct = getRate(from, to);
  if (validRate(direct)) {
    return multiplyAmount(amount, direct, precisionOf(to));
  }

  // Triangulation через USD. Промежуточное USD-значение держим в высокой точности
  // (12 знаков), чтобы не терять доли цента на каждом шаге при агрегировании.
  let inUsd;
  if (from === "USD") {
    inUsd = amount;
  } else {
    const fromToUsd = getRate(from, "USD");
    if (!validRate(fromToUsd)) { warnNoRate(from, to); return 0; }
    inUsd = multiplyAmount(amount, fromToUsd, 12);
  }

  if (to === "USD") return multiplyAmount(inUsd, 1, precisionOf("USD"));

  const usdToTarget = getRate("USD", to);
  if (!validRate(usdToTarget)) { warnNoRate(from, to); return 0; }

  return multiplyAmount(inUsd, usdToTarget, precisionOf(to));
}

/**
 * True if there is a usable rate path from `from` to `to` (direct positive rate,
 * or via USD with positive legs). Lets callers surface a visible "rate missing"
 * warning before relying on `convert` (which silently returns 0 otherwise).
 */
export function hasRatePath(from, to, getRate) {
  if (from === to) return true;
  if (validRate(getRate(from, to))) return true;
  const fromLeg = from === "USD" ? 1 : getRate(from, "USD");
  const toLeg = to === "USD" ? 1 : getRate("USD", to);
  return validRate(fromLeg) && validRate(toLeg);
}
