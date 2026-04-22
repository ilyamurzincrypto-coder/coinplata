// src/utils/spread.js
// Производные значения "mid rate" и "spread %" от реального rate.
// Формулы (по спеке):
//   — toCurrency === "USD"  →  midRate = 1, spread = (rate - 1) * 100
//   — non-USD               →  midRate = triangulation через USD, spread = (rate / midRate - 1) * 100
//
// Пары НЕ форсируются быть инверсиями. spread — чисто derived вьюшка от rate;
// источник правды остаётся rate в store.

export function getMidRate(fromCur, toCur, getRate) {
  if (!fromCur || !toCur) return null;
  if (fromCur === toCur) return 1;
  // Спец-случай: к USD mid = 1 (так было задано).
  if (toCur === "USD") return 1;
  // от USD — стандартная котировка USD→X. Спред в этом случае будет деривативно 0,
  // потому что сам rate и есть midRate — это ожидаемое поведение.
  if (fromCur === "USD") {
    const r = getRate("USD", toCur);
    return typeof r === "number" && r > 0 ? r : null;
  }
  // Обычный кросс — триангуляция через USD.
  const fromToUsd = getRate(fromCur, "USD");
  const usdToTo = getRate("USD", toCur);
  if (!fromToUsd || fromToUsd <= 0) return null;
  if (!usdToTo || usdToTo <= 0) return null;
  return fromToUsd * usdToTo;
}

export function computeSpread(rate, fromCur, toCur, getRate) {
  const r =
    typeof rate === "number"
      ? rate
      : parseFloat(String(rate ?? "").replace(",", "."));
  if (!r || r <= 0 || isNaN(r)) return null;
  const mid = getMidRate(fromCur, toCur, getRate);
  if (!mid || mid <= 0) return null;
  return (r / mid - 1) * 100;
}

export function computeRateFromSpread(spread, fromCur, toCur, getRate) {
  const s =
    typeof spread === "number"
      ? spread
      : parseFloat(String(spread ?? "").replace(",", "."));
  if (isNaN(s)) return null;
  const mid = getMidRate(fromCur, toCur, getRate);
  if (!mid || mid <= 0) return null;
  const r = mid * (1 + s / 100);
  return r > 0 ? r : null;
}

export function formatSpread(spread, digits = 2) {
  if (spread === null || spread === undefined || isNaN(spread)) return "";
  const sign = spread > 0 ? "+" : "";
  return `${sign}${spread.toFixed(digits)}`;
}
