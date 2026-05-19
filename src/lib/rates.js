// src/lib/rates.js
//
// Display-helpers для курсов. Главное правило: если raw < 1 — UI
// автоматически показывает 1/raw и меняет from/to местами. Кассир видит
// читаемое число типа 44.60, а не 0.022422. БД хранит оригинал — инверсия
// чисто в display-слое.

/**
 * Возвращает читаемое представление курса.
 *   • raw >= 1   → как есть, wasInverted=false
 *   • raw < 1    → 1/raw, from↔to swap, wasInverted=true
 *   • невалидно  → rate=null, wasInverted=false
 *
 * `wasInverted` нужен формам редактирования чтобы конвертировать ввод
 * пользователя обратно перед сохранением в БД. В UI rate-карточек этот
 * флаг НЕ используется — никаких визуальных индикаторов инверсии.
 */
export function displayRate(rawRate, fromCcy, toCcy) {
  if (!Number.isFinite(rawRate) || rawRate <= 0) {
    return { rate: null, from: fromCcy, to: toCcy, wasInverted: false };
  }
  if (rawRate >= 1) {
    return { rate: rawRate, from: fromCcy, to: toCcy, wasInverted: false };
  }
  return {
    rate: 1 / rawRate,
    from: toCcy,
    to: fromCcy,
    wasInverted: true,
  };
}

/**
 * Форматирование курса для отображения.
 *   • >= 10    → 2 знака (44.60, 1234.56)
 *   • 1-9.99   → 4 знака (1.1670)
 *   • < 1      → 6 знаков (fallback; после displayRate не должно встречаться)
 */
export function formatRate(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 10) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

/**
 * Форматирование курса с обрезкой trailing-нулей (для inputs после reverse).
 * Тот же набор precision-buckets, но 32.5 не превращается в "32.5000".
 *   1/32.5  → "0.030769"  (а не "0.030769230769230770")
 *   1/0.030769 ≈ 32.500024 → "32.50"
 *   32.5    → "32.5"      (без хвоста ".0000")
 *   1.167   → "1.167"
 */
export function formatRateCompact(value) {
  const formatted = formatRate(value);
  if (formatted === "—") return formatted;
  // обрезаем trailing нули и опциональную точку
  return formatted.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
