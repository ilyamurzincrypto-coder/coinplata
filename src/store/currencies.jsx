// src/store/currencies.jsx
// Единый источник валют для UI. Стартует с seed CURRENCIES_DICT из data.js.
// CURRENCIES (массив кодов) в data.js оставлен как deprecated для обратной совместимости.

import { createContext, useContext, useState, useCallback, useMemo } from "react";
import { CURRENCIES_DICT as SEED } from "./data.js";

const CurrenciesContext = createContext(null);

export function CurrenciesProvider({ children }) {
  const [currencies, setCurrencies] = useState(SEED);

  const codes = useMemo(() => currencies.map((c) => c.code), [currencies]);
  const dict = useMemo(() => {
    const m = {};
    currencies.forEach((c) => (m[c.code] = c));
    return m;
  }, [currencies]);

  const findByCode = useCallback(
    (code) => currencies.find((c) => c.code === code),
    [currencies]
  );

  const addCurrency = useCallback((input) => {
    const code = String(input.code || "").toUpperCase().trim();
    if (!code) return { ok: false, warning: "Code required" };
    const full = {
      code,
      type: input.type === "crypto" ? "crypto" : "fiat",
      symbol: input.symbol || "",
      name: input.name || code,
      decimals: Number.isFinite(input.decimals) ? input.decimals : 2,
    };
    let ok = true;
    setCurrencies((prev) => {
      if (prev.some((c) => c.code === code)) {
        ok = false;
        return prev;
      }
      return [...prev, full];
    });
    return ok ? { ok: true, currency: full } : { ok: false, warning: `${code} already exists` };
  }, []);

  const updateCurrency = useCallback((code, patch) => {
    setCurrencies((prev) => prev.map((c) => (c.code === code ? { ...c, ...patch } : c)));
  }, []);

  const removeCurrency = useCallback((code) => {
    setCurrencies((prev) => prev.filter((c) => c.code !== code));
  }, []);

  const value = useMemo(
    () => ({
      currencies,
      codes,
      dict,
      findByCode,
      addCurrency,
      updateCurrency,
      removeCurrency,
    }),
    [currencies, codes, dict, findByCode, addCurrency, updateCurrency, removeCurrency]
  );

  return <CurrenciesContext.Provider value={value}>{children}</CurrenciesContext.Provider>;
}

export function useCurrencies() {
  const ctx = useContext(CurrenciesContext);
  if (!ctx) throw new Error("useCurrencies must be inside CurrenciesProvider");
  return ctx;
}
