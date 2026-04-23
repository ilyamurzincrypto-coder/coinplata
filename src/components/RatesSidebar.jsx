// src/components/RatesSidebar.jsx
// Компактный вертикальный список курсов для CREATE-режима CashierPage.
// Кассир всегда видит курсы пока заполняет форму (sticky слева).
//
// Layout: grid 4 rows × flow-col → первые 4 пары в первой колонке, остальные
// автоматически сваливаются во вторую. Это даёт стабильное количество строк
// независимо от того сколько featured pairs.
//
// НЕ содержит hover-dropdown как RatesBar — тут нет места и нет смысла,
// все популярные пары уже видны.

import React from "react";
import { TrendingUp } from "lucide-react";
import { useRates, FEATURED_PAIRS } from "../store/rates.jsx";
import { useTranslation } from "../i18n/translations.jsx";

function formatRate(value) {
  if (!value && value !== 0) return "—";
  if (value >= 10) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function timeAgo(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

export default function RatesSidebar() {
  const { getRate, lastUpdated } = useRates();
  const { t } = useTranslation();

  return (
    <aside className="bg-white rounded-[16px] border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_12px_rgba(15,23,42,0.06)]">
      <header className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700">
            <TrendingUp className="w-3 h-3" />
          </div>
          <h2 className="text-[12px] font-bold text-slate-900 tracking-tight uppercase">
            {t("rates") || "Rates"}
          </h2>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
          {timeAgo(lastUpdated)} ago
        </span>
      </header>

      {/* 4 строки в колонке. При >4 parах — свалится во вторую колонку. */}
      <div className="p-2 grid grid-rows-4 grid-flow-col auto-cols-fr gap-1">
        {FEATURED_PAIRS.map(([from, to]) => {
          const r = getRate(from, to);
          return (
            <div
              key={`${from}-${to}`}
              className="px-3 py-2 rounded-[10px] bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <div className="text-[9px] font-bold text-slate-500 tracking-[0.12em] mb-0.5">
                {from} <span className="text-slate-300">→</span> {to}
              </div>
              <div className="text-[15px] font-bold tabular-nums tracking-tight leading-none text-slate-900">
                {formatRate(r)}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
