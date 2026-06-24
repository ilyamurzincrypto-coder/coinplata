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

// «Читаемое» значение строки: для percent-пар — процент; для абсолютных —
// всегда число > 1 (если курс < 1, показываем 1/курс), как в листе менеджеров.
export function displayValue(from, to, rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return NaN;
  if (isPercentPair(from, to)) return rateToPercent(r);
  return r < 1 ? 1 / r : r;
}

// Обратная конвертация «читаемое → stored». Для абсолютной пары, если текущий
// stored < 1 (направление котируется реципрокно), вводимое число — это 1/stored.
export function toStoredRate(from, to, readable, currentStored) {
  const v = Number(readable);
  if (isPercentPair(from, to)) return percentToRate(v);
  const cur = Number(currentStored);
  return Number.isFinite(cur) && cur > 0 && cur < 1 ? 1 / v : v;
}

export function formatRateValue(from, to, rate) {
  if (!Number.isFinite(Number(rate)) || Number(rate) <= 0) return "—";
  if (isPercentPair(from, to)) {
    const pct = rateToPercent(rate);
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${ru(pct, 2)} %`.replace("+−", "−");
  }
  const disp = displayValue(from, to, rate);
  return ru(disp, absDigits(disp));
}
