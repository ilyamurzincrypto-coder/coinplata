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

export function useBaseCurrency() {
  const { settings } = useAuth();
  const { getRate } = useRates();
  const base = settings.baseCurrency || "USD";
  const fxRates = settings.fxRates || {};

  // getRateFx — приоритетно использует биржевой курс из settings.fxRates.
  // Если не задан — стэйблкоин-предположение (USDT≈USD≈USDC=1:1), затем
  // fallback на офисный getRate. Используется ТОЛЬКО для дашборд-конверсий
  // в base валюту.
  const getRateFx = useCallback(
    (from, to) => {
      if (!from || !to) return undefined;
      if (from === to) return 1;
      // 1. Явный biржевой курс из настроек
      const direct = fxRates[`${from}_${to}`];
      if (Number.isFinite(Number(direct)) && Number(direct) > 0) return Number(direct);
      const reverse = fxRates[`${to}_${from}`];
      if (Number.isFinite(Number(reverse)) && Number(reverse) > 0) return 1 / Number(reverse);
      // 2. Стэйблкоин-пеглы: USDT/USDC/DAI/BUSD ↔ USD = 1:1; stablecoin↔stablecoin = 1.
      if (USD_STABLES.has(from) && to === "USD") return 1;
      if (from === "USD" && USD_STABLES.has(to)) return 1;
      if (USD_STABLES.has(from) && USD_STABLES.has(to)) return 1;
      // 3. Fallback — офисный курс (может включать маржу; для агрегированных
      //    метрик это допустимо когда других данных нет).
      return getRate(from, to);
    },
    [fxRates, getRate]
  );

  const toBase = useCallback(
    (amount, from) => {
      if (!from) return amount || 0;
      return convert(amount, from, base, getRateFx);
    },
    [base, getRateFx]
  );

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
