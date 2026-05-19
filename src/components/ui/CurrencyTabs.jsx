// src/components/ui/CurrencyTabs.jsx
import React from "react";
import { useCurrencies } from "../../store/currencies.jsx";

export default function CurrencyTabs({ value, onChange, accent = "slate", currencies: currenciesProp }) {
  const { codes } = useCurrencies();
  const currencies = currenciesProp || codes;
  const activeCls =
    accent === "emerald"
      ? "bg-white text-success ring-1 ring-emerald-200 shadow-sm"
      : accent === "rose"
      ? "bg-white text-danger ring-1 ring-rose-200 shadow-sm"
      : "bg-white text-ink ring-1 ring-border-soft shadow-sm";
  return (
    <div className="inline-flex bg-surface-sunk p-1 rounded-[11px] gap-0.5 flex-wrap">
      {currencies.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`px-3.5 py-1.5 text-body-sm font-bold tracking-wide rounded-[9px] transition-all ${
            value === c ? activeCls : "text-muted hover:text-ink"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
