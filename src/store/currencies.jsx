// src/store/currencies.jsx
// Единый источник валют для UI.
//
// Stage 3: если Supabase настроен — на mount подгружаем currencies из БД и
// заменяем seed. Write ops остаются локальными (изменения не персистятся).

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import { CURRENCIES_DICT as SEED } from "./data.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { loadCurrencies } from "../lib/supabaseReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";

const CurrenciesContext = createContext(null);

export function CurrenciesProvider({ children }) {
  // В DB-режиме начинаем с пустого → seed не "мигает" при refresh перед
  // тем как loadCurrencies() заполнит из БД. В demo-режиме используем seed.
  const [currencies, setCurrencies] = useState(() =>
    isSupabaseConfigured ? [] : SEED
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const reload = () =>
      loadCurrencies()
        .then((rows) => {
          if (cancelled) return;
          if (rows && rows.length > 0) setCurrencies(rows);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[currencies] load failed — keeping seed", err);
        });
    reload();
    const unsub = onDataBump(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

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
