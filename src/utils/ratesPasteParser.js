// src/utils/ratesPasteParser.js
// Парс блока пасты в формате менеджерской таблицы:
//   USDT -> USD  -1,00%
//   USDT → TRY 45,10
// Возвращает строки с rate (для percent-пар rate = 1 + %/100) и статусом.

import { isPercentPair, percentToRate } from "./ratesFormat.js";

const LINE_RE =
  /^\s*([A-Za-z]{2,6})\s*(?:->|→|>)\s*([A-Za-z]{2,6})\s*([-+]?\d[\d\s.,]*)\s*(%?)\s*$/;

function toNumber(raw) {
  const s = String(raw).replace(/\s/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function parseRatesPaste(text, { known, currentRate } = {}) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim() !== "");
  return lines.map((line) => {
    const m = LINE_RE.exec(line);
    if (!m) return { raw: line, status: "error", error: "формат строки" };
    const from = m[1].toUpperCase();
    const to = m[2].toUpperCase();
    const value = toNumber(m[3]);
    const hasPct = m[4] === "%";
    if (known && (!known.has(from) || !known.has(to))) {
      return { raw: line, from, to, status: "error", error: "валюта неизвестна" };
    }
    if (!Number.isFinite(value)) {
      return { raw: line, from, to, status: "error", error: "число" };
    }
    const isPercent = hasPct || isPercentPair(from, to);
    let rate;
    if (isPercent) {
      rate = percentToRate(value);
    } else {
      // Абсолютная пара: вводимое число — «читаемое» (>1). Если текущий stored
      // < 1 (реципрокное направление, напр. TRY→USDT), храним 1/value.
      const cur = currentRate ? Number(currentRate(from, to)) : NaN;
      rate = Number.isFinite(cur) && cur > 0 && cur < 1 ? 1 / value : value;
    }
    let status = "new";
    if (currentRate) {
      const prev = currentRate(from, to);
      if (Number.isFinite(prev)) {
        status = Math.abs(prev - rate) < 1e-9 ? "unchanged" : "updated";
      }
    }
    return { raw: line, from, to, rate, isPercent, status, prev: currentRate?.(from, to) };
  });
}
