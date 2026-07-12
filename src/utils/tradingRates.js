// src/utils/tradingRates.js
// Возвращает РЕАЛЬНЫЕ rates обоих направлений из БД.
//
//   forward  = getRate(base, quote)   — сколько quote за 1 base (ask)
//   backward = getRate(quote, base)   — сколько base за 1 quote (bid)
//
// В БД хранятся обе пары как отдельные records (после миграции 0036),
// каждая со своим rate. Это и есть реальные sell/buy курсы офиса.
// Раньше тут добавлялся искусственный ±spread (0.2%/0.3%) — он давал
// разные числа в Sidebar и RatesBar по сравнению с тем, что подставляла
// форма создания сделки (которая берёт чистый getRate без спреда).
//
// Если обратная пара отсутствует в БД — fallback на 1/forward
// (математическая инверсия). Помечаем синтетическим флагом
// backwardSynthetic=true чтобы UI мог это отобразить (например серым).

export function getTradingRates({ getRate, base, quote }) {
  const forward = getRate(base, quote);
  const backwardRaw = getRate(quote, base);
  const hasForward = Number.isFinite(forward) && forward > 0;
  const hasBackwardReal = Number.isFinite(backwardRaw) && backwardRaw > 0;
  const backward = hasBackwardReal
    ? backwardRaw
    : hasForward
    ? 1 / forward
    : null;
  return {
    forward: hasForward ? forward : null,
    backward,
    backwardSynthetic: !hasBackwardReal && hasForward,
    // back-compat aliases (RatesBar/Sidebar читают ask/bid)
    ask: hasForward ? forward : null,
    bid: backward,
    market: hasForward ? forward : null,
  };
}

// Форматирование курса — единый форматтер приложения: import { formatRate }
// from "../lib/rates.js" (B6). Локальный formatTradingRate удалён (мёртвый код).
