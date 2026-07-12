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
/**
 * usdtPer(cur, getRate, officeId) — сколько USDT стоит 1 единица `cur`.
 *
 * ЕДИНСТВЕННЫЙ источник ориентации курса к USDT (инвариант B2/B3/D5/D6 —
 * копировать этот хелпер в компоненты запрещено, только импортировать).
 *
 * Касса хранит направленные множители: getRate("USDT", cur) = «cur за 1 USDT».
 * Значит «USDT за 1 cur» = 1/raw — ВСЕГДА, для любой валюты. Никаких
 * STRONG-вайтлистов: они ломали сильные валюты вне списка (GBP/CHF отдавали raw
 * вместо 1/raw — перевёрнутый курс). Для percent-пар прежний код тоже возвращал
 * 1/raw, так что формула едина.
 *
 *   USD  → ~1.0     EUR → 1.167    GBP → 1.348    CHF → 1.271
 *   TRY  → 0.0214   RUB → 0.0130   USDT → 1
 *
 * Возвращает NaN, если курс не найден/невалиден.
 */
export function usdtPer(cur, getRate, officeId) {
  if (cur === "USDT") return 1;
  const raw = Number(getRate?.("USDT", cur, officeId));
  if (!(raw > 0)) return NaN;
  return 1 / raw;
}

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
