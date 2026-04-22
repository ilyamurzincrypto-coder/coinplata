// src/store/baseCurrency.js
// Hook: useBaseCurrency() — единая точка доступа к base-валюте для агрегированных метрик.
// Зависит от settings.baseCurrency (в auth) и rates (для конвертации).

import { useCallback, useMemo } from "react";
import { useAuth } from "./auth.jsx";
import { useRates } from "./rates.jsx";
import { convert } from "../utils/convert.js";
import { fmt, curSymbol } from "../utils/money.js";

export function useBaseCurrency() {
  const { settings } = useAuth();
  const { getRate } = useRates();
  const base = settings.baseCurrency || "USD";

  const toBase = useCallback(
    (amount, from) => {
      if (!from) return amount || 0;
      return convert(amount, from, base, getRate);
    },
    [base, getRate]
  );

  const formatBase = useCallback(
    (amount, from) => {
      const v = from && from !== base ? toBase(amount, from) : amount;
      return `${curSymbol(base)}${fmt(v, base)}`;
    },
    [base, toBase]
  );

  return useMemo(() => ({ base, toBase, formatBase }), [base, toBase, formatBase]);
}
