// src/lib/dealForm/pickRate.js
// Pure helper для RatesPanel click-to-fill (2.5.4).
//
// Получает (from, to, rate) от RatesPanel + active OUT leg + первая IN leg
// → возвращает patch для updateLeg.
//
// Direction matching:
//   • inCurrency = from AND outCurrency = to       → as-is rate (market default)
//   • inCurrency = to AND outCurrency = from       → 1/rate (inverse, market)
//   • else                                          → as-is rate, marked manual

/**
 * @param {Object} args
 * @param {string} args.from         — base currency from RatesPanel cell
 * @param {string} args.to           — quote currency from RatesPanel cell
 * @param {number} args.rate         — picked rate
 * @param {string} args.inCurrency   — currency первой IN leg (или null)
 * @param {string} args.outCurrency  — currency active OUT leg (или null)
 * @returns {{rate: string, rateManual: boolean} | null}
 *   null если matching не возможен (no active leg).
 */
export function computePickedRate({ from, to, rate, inCurrency, outCurrency }) {
  if (!outCurrency || !Number.isFinite(rate) || rate <= 0) return null;
  // Standard direction: IN=from, OUT=to → as-is
  if (outCurrency === to && inCurrency === from) {
    return { rate: String(rate), rateManual: false };
  }
  // Inverse direction: IN=to, OUT=from → 1/rate
  if (outCurrency === from && inCurrency === to) {
    return { rate: String(1 / rate), rateManual: false };
  }
  // Mismatch — fill raw rate, mark manual (менеджер сам разберётся)
  return { rate: String(rate), rateManual: true };
}
