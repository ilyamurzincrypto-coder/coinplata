// src/utils/tradingRates.js
// Bid/Ask логика торговых пар. НЕ используем 1/rate инверсию — она даёт
// кривые значения вроде 0.919118. Вместо этого:
//
//   market_rate = getRate(base, quote)          // канонический курс в "quote per base"
//   ask (sell)  = market_rate * (1 + spread)    // выше market → мы продаём base
//   bid (buy)   = market_rate * (1 - spread)    // ниже market → мы покупаем base
//
// Оба числа — в "quote per base" единице. Нет 0.025 для TRY→USDT.
//
// Спред зависит от типа валют: crypto-пары шире (0.3%), чистый fiat уже (0.2%).
// Админ может настраивать вручную через rates.spreadByPair (in-memory пока).

export const DEFAULT_SPREAD_CRYPTO = 0.003; // 0.3%
export const DEFAULT_SPREAD_FIAT = 0.002;   // 0.2%

// Типы валют передаются через функцию isCrypto(code) — чтобы не тащить
// сюда весь currency store. Обычно вызывается из компонента:
//   const isCrypto = (code) => currencyDict[code]?.type === "crypto";
export function getTradingRates({ getRate, isCrypto, base, quote, spreadOverride }) {
  const market = getRate(base, quote);
  if (!market || market <= 0) {
    return { ask: null, bid: null, market: null, spread: 0 };
  }
  const spread =
    spreadOverride != null
      ? spreadOverride
      : isCrypto && (isCrypto(base) || isCrypto(quote))
      ? DEFAULT_SPREAD_CRYPTO
      : DEFAULT_SPREAD_FIAT;
  return {
    market,
    spread,
    ask: market * (1 + spread),
    bid: market * (1 - spread),
  };
}

// Единый форматтер. Одинаковая точность в sell/buy:
//   ≥ 10  → 2 знака  (курс TRY)
//   ≥ 1   → 4 знака  (курс USD/EUR к USDT)
//   < 1   → 6 знаков (крипта к TRY/JPY)
export function formatTradingRate(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 10) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}
