// src/utils/ratesFormat.js
// Конвертация курса ↔ процент для «парных» валют (USDT↔USD) и форматирование
// значения строки таблицы. Процент — ТОЛЬКО формат отображения/ввода; в сторе
// курс всегда абсолютный rate (для percent-пар rate = 1 + %/100).

export const PERCENT_CCYS = ["USD"];

export function isPercentPair(from, to) {
  const a = String(from).toUpperCase();
  const b = String(to).toUpperCase();
  const pair = new Set([a, b]);
  return pair.has("USDT") && PERCENT_CCYS.some((c) => pair.has(c));
}

export function rateToPercent(rate) {
  return (Number(rate) - 1) * 100;
}

export function percentToRate(pct) {
  return 1 + Number(pct) / 100;
}

function ru(n, digits) {
  const fixed = Number(n).toFixed(digits);
  return fixed.replace("-", "−").replace(".", ",");
}

function absDigits(rate) {
  return Math.abs(Number(rate)) >= 10 ? 2 : 3;
}

export function formatRateValue(from, to, rate) {
  if (!Number.isFinite(Number(rate)) || Number(rate) <= 0) return "—";
  if (isPercentPair(from, to)) {
    const pct = rateToPercent(rate);
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${ru(pct, 2)} %`.replace("+−", "−");
  }
  return ru(rate, absDigits(rate));
}
