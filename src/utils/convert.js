// src/utils/convert.js
// Универсальная конвертация сумм между валютами через rates store.
// Использует triangulation через USD если прямого курса нет.

import { multiplyAmount, precisionOf } from "./money.js";

/**
 * Конвертирует amount из валюты `from` в валюту `to`.
 * getRate — функция из useRates().
 *
 * Приоритет:
 * 1. Если from === to → возвращает исходную сумму
 * 2. Прямой курс from → to
 * 3. Через USD: from → USD → to
 *
 * Если нигде нет курса — возвращает 0.
 */
export function convert(amount, from, to, getRate) {
  if (!amount || amount === 0) return 0;
  if (from === to) return amount;

  const direct = getRate(from, to);
  if (direct !== undefined && direct !== null) {
    return multiplyAmount(amount, direct, precisionOf(to));
  }

  // Triangulation через USD
  let inUsd;
  if (from === "USD") {
    inUsd = amount;
  } else {
    const fromToUsd = getRate(from, "USD");
    if (fromToUsd === undefined || fromToUsd === null) return 0;
    inUsd = multiplyAmount(amount, fromToUsd, 2);
  }

  if (to === "USD") return inUsd;

  const usdToTarget = getRate("USD", to);
  if (usdToTarget === undefined || usdToTarget === null) return 0;

  return multiplyAmount(inUsd, usdToTarget, precisionOf(to));
}
