// src/components/deal-form/DealRateBlock.jsx
//
// Чёрная капсула с курсом — визуальный «шарнир» между блоками IN и OUT.
// Phase 2: подключён DealRateAutocomplete — dropdown с курсами по офисам.

import React from "react";
import { ArrowLeftRight } from "lucide-react";
import DealRateAutocomplete from "./DealRateAutocomplete.jsx";

export default function DealRateBlock({
  rate,             // string-input value
  onRateChange,
  onSelectSuggestion,   // callback при выборе из dropdown — пробрасывает source
  fromCcy,
  toCcy,
  sourceLabel,      // например "Terra City" или "Global"
  ageLabel,         // "6m" / "2h"
  marginUsd,        // number — маржа в USD (опц.)
  spreadPct,        // number — % спред (опц.)
  onReverse,        // swap from/to
  warning,          // string | null — текст предупреждения (например «одинаковые валюты»)
}) {
  const hasMargin = Number.isFinite(marginUsd) && marginUsd !== 0;
  const marginPositive = (marginUsd || 0) >= 0;
  return (
    <div className="mx-7 my-4 bg-surface-dark text-white rounded-card-lg px-5 py-4 flex items-center gap-4">
      {/* Иконка */}
      <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center shrink-0">
        <ArrowLeftRight className="w-4 h-4 text-white" strokeWidth={2.2} />
      </div>

      {/* Курс + источник */}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider font-bold text-white/60 mb-0.5">
          Курс обмена
        </div>
        <div className="flex items-baseline gap-2">
          <DealRateAutocomplete
            value={rate}
            onChange={onRateChange}
            onSelect={onSelectSuggestion}
            from={fromCcy}
            to={toCcy}
            inputClassName="bg-transparent text-white font-mono tabular text-h2 font-bold border-b border-transparent focus:border-white/40 outline-none transition-colors w-32 min-w-0 placeholder:text-white/30"
          />
          <span className="text-body-sm text-white/60 font-mono">
            {fromCcy} → {toCcy}
          </span>
        </div>
        {warning ? (
          <div className="mt-1 text-tiny text-rose-300 inline-flex items-center gap-1.5 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            {warning}
          </div>
        ) : sourceLabel ? (
          <div className="mt-1 text-tiny text-white/50 inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" style={{ boxShadow: "0 0 6px rgba(16,185,129,0.6)" }} />
            <span>Источник: {sourceLabel}{ageLabel ? ` · ${ageLabel}` : ""}</span>
          </div>
        ) : null}
      </div>

      {/* Right side */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        {onReverse && (
          <button
            type="button"
            onClick={onReverse}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-white/10 hover:bg-white/15 text-white text-tiny font-semibold transition-colors"
            title="Обратный курс"
          >
            <ArrowLeftRight className="w-3 h-3" strokeWidth={2.2} />
            Обратный
          </button>
        )}
        {hasMargin && !warning && (
          <div className={`text-tiny font-mono tabular font-bold ${marginPositive ? "text-accent-glow" : "text-rose-400"}`}>
            {marginPositive ? "+" : "−"}${Math.abs(marginUsd).toFixed(2)}
            {Number.isFinite(spreadPct) && spreadPct !== 0 && (
              <span className="text-white/40 font-normal ml-1">· {(spreadPct * 100).toFixed(2)}%</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
