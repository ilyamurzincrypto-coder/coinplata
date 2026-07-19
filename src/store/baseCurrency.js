// src/store/baseCurrency.js
// Hook: useBaseCurrency() — единая точка доступа к base-валюте для агрегированных метрик.
// Зависит от settings.baseCurrency (в auth) и rates (для конвертации).
//
// fxRates priority: для пересчёта между display валютами (USD, EUR…) на
// дашборде используется БИРЖЕВОЙ курс из settings.fxRates (заданный
// в Settings → General). Это отдельно от обменных пар офиса (которые
// содержат маржу). Если fx-курса нет — fallback на getRate().

import { useCallback, useMemo } from "react";
import { useAuth } from "./auth.jsx";
import { useRates } from "./rates.jsx";
import { convert } from "../utils/convert.js";
import { fmt, curSymbol } from "../utils/money.js";

// USD-pegged stablecoins — для display-конверсий в base используем 1:1
// если в settings.fxRates явно не задан другой курс. Иначе офисный
// getRate (с маржой!) может вернуть, например, USDT/TRY вместо USDT/USD
// и раздуть метрику в base в 50+ раз (Treasury ДДС, dashboard итоги).
const USD_STABLES = new Set(["USDT", "USDC", "DAI", "BUSD"]);

// Чистые фабрики (без React) — чтобы ту же base-конверсию можно было переиспользовать
// вне провайдера (напр. в публичном share-view раздела «Счета»), не копируя логику.
export function makeGetRateFx(fxRates = {}, getRate) {
  return (from, to) => {
    if (!from || !to) return undefined;
    if (from === to) return 1;
    const direct = fxRates[`${from}_${to}`];
    if (Number.isFinite(Number(direct)) && Number(direct) > 0) return Number(direct);
    const reverse = fxRates[`${to}_${from}`];
    if (Number.isFinite(Number(reverse)) && Number(reverse) > 0) return 1 / Number(reverse);
    if (USD_STABLES.has(from) && to === "USD") return 1;
    if (from === "USD" && USD_STABLES.has(to)) return 1;
    if (USD_STABLES.has(from) && USD_STABLES.has(to)) return 1;
    return getRate(from, to);
  };
}

export function makeToBase(base, fxRates, getRate) {
  const fx = makeGetRateFx(fxRates, getRate);
  return (amount, from) => {
    if (!from) return amount || 0;
    return convert(amount, from, base, fx);
  };
}

export function useBaseCurrency() {
  const { settings } = useAuth();
  const { getRate } = useRates();
  const base = settings.baseCurrency || "USD";
  // Стабильная ссылка — иначе `|| {}` рождает новый объект каждый рендер и
  // дёргает useMemo(toBase) (кормит дашборд-агрегаты) на пустом месте.
  const fxRates = useMemo(() => settings.fxRates || {}, [settings.fxRates]);

  // getRateFx — приоритетно использует биржевой курс из settings.fxRates.
  // Если не задан — стэйблкоин-предположение (USDT≈USD≈USDC=1:1), затем
  // fallback на офисный getRate. Используется ТОЛЬКО для дашборд-конверсий
  // в base валюту. Логика — в чистой makeGetRateFx (переиспуется в share-view).
  const getRateFx = useMemo(() => makeGetRateFx(fxRates, getRate), [fxRates, getRate]);

  const toBase = useMemo(() => makeToBase(base, fxRates, getRate), [base, fxRates, getRate]);

  const formatBase = useCallback(
    (amount, from) => {
      const v = from && from !== base ? toBase(amount, from) : amount;
      return `${curSymbol(base)}${fmt(v, base)}`;
    },
    [base, toBase]
  );

  return useMemo(
    () => ({ base, toBase, formatBase, getRateFx }),
    [base, toBase, formatBase, getRateFx]
  );
}
