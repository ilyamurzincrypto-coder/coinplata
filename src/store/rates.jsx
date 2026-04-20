// src/store/rates.js
// Система курсов: пара валют -> курс. Применяется всегда в направлении A -> B.
// Используем контекст + хук, чтобы не тащить библиотеку state management.

import { createContext, useContext, useState, useCallback } from "react";

// Ключ пары: "FROM_TO"
export const rateKey = (from, to) => `${from}_${to}`;

const INITIAL_RATES = {
  USDT_TRY: 38.9,
  USDT_USD: 0.9985,
  USDT_EUR: 0.9180,
  USDT_GBP: 0.7870,
  USD_TRY: 38.95,
  USD_EUR: 0.9195,
  USD_GBP: 0.7880,
  EUR_TRY: 42.35,
  EUR_USD: 1.0875,
  EUR_USDT: 1.0880,
  TRY_USD: 0.02567,
  TRY_USDT: 0.02570,
  TRY_EUR: 0.02362,
  GBP_USD: 1.2690,
  GBP_TRY: 49.45,
  GBP_USDT: 1.2710,
};

const RatesContext = createContext(null);

export function RatesProvider({ children }) {
  const [rates, setRates] = useState(INITIAL_RATES);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const getRate = useCallback(
    (from, to) => {
      if (from === to) return 1;
      return rates[rateKey(from, to)];
    },
    [rates]
  );

  const setRate = useCallback((from, to, value) => {
    setRates((prev) => ({ ...prev, [rateKey(from, to)]: parseFloat(value) || 0 }));
    setLastUpdated(new Date());
  }, []);

  const updateMany = useCallback((patch) => {
    setRates((prev) => ({ ...prev, ...patch }));
    setLastUpdated(new Date());
  }, []);

  return (
    <RatesContext.Provider value={{ rates, getRate, setRate, updateMany, lastUpdated }}>
      {children}
    </RatesContext.Provider>
  );
}

export function useRates() {
  const ctx = useContext(RatesContext);
  if (!ctx) throw new Error("useRates must be inside RatesProvider");
  return ctx;
}

// Самые «интересные» пары для отображения в RatesBar
export const FEATURED_PAIRS = [
  ["USDT", "TRY"],
  ["USD", "TRY"],
  ["EUR", "TRY"],
  ["GBP", "TRY"],
  ["USDT", "USD"],
];
