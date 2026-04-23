// src/components/RatesSidebar.jsx
// Компактный вертикальный список торговых пар для CREATE-режима CashierPage.
// Каждый блок = одна пара с двумя направлениями (a→b и b→a), как в RatesBar.
// Кассир видит и покупку и продажу не переключая внимание.

import React from "react";
import { TrendingUp, ArrowRight } from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { useTranslation } from "../i18n/translations.jsx";

const TRADE_PAIRS = [
  ["USDT", "TRY"],
  ["USDT", "USD"],
  ["USDT", "EUR"],
  ["USDT", "GBP"],
  ["USD", "TRY"],
];

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

      <div className="p-2 space-y-1">
        {TRADE_PAIRS.map(([a, b]) => {
          // Sell = клиент отдаёт A, получает B (rate "B per A").
          // Buy = клиент отдаёт B, получает A, отображаем в том же юните через 1/inverse.
          const sell = getRate(a, b);
          const inverseBuy = getRate(b, a);
          const buy = inverseBuy && inverseBuy > 0 ? 1 / inverseBuy : sell;
          return (
            <div
              key={`${a}-${b}`}
              className="px-3 py-2 rounded-[10px] bg-slate-50"
            >
              <div className="text-[9px] font-bold text-slate-500 tracking-[0.12em] mb-1.5 inline-flex items-center gap-1">
                <span>{a}</span>
                <span className="text-slate-400">⇄</span>
                <span>{b}</span>
              </div>
              <div className="flex items-baseline justify-between mb-0.5">
                <span className="text-[10px] font-semibold text-slate-500 inline-flex items-center">
                  {a} <ArrowRight className="w-2.5 h-2.5 mx-0.5" /> {b}
                </span>
                <span className="text-[13px] font-bold tabular-nums text-slate-900 leading-none">
                  {formatRate(sell)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] font-semibold text-slate-500 inline-flex items-center">
                  {b} <ArrowRight className="w-2.5 h-2.5 mx-0.5" /> {a}
                </span>
                <span className="text-[12px] font-bold tabular-nums text-slate-600 leading-none">
                  {formatRate(buy)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
