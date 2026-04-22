// src/components/ui/CurrencyTabs.jsx
import React from "react";
import { useCurrencies } from "../../store/currencies.jsx";

export default function CurrencyTabs({ value, onChange, accent = "slate", currencies: currenciesProp }) {
  const { codes } = useCurrencies();
  const currencies = currenciesProp || codes;
  const activeCls =
    accent === "emerald"
      ? "bg-white text-emerald-700 ring-1 ring-emerald-200 shadow-sm"
      : accent === "rose"
      ? "bg-white text-rose-700 ring-1 ring-rose-200 shadow-sm"
      : "bg-white text-slate-900 ring-1 ring-slate-200 shadow-sm";
  return (
    <div className="inline-flex bg-slate-100 p-1 rounded-[11px] gap-0.5 flex-wrap">
      {currencies.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`px-3.5 py-1.5 text-[13px] font-bold tracking-wide rounded-[9px] transition-all ${
            value === c ? activeCls : "text-slate-500 hover:text-slate-900"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
