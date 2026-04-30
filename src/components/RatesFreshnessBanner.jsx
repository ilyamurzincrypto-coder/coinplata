// src/components/RatesFreshnessBanner.jsx
//
// Глобальный banner на Cashier dashboard:
// показывает количество устаревших / устаревающих курсов.
//
// Не показывается если все курсы актуальны.
// Клик → открывает Rates page (через onOpenRates callback).

import React, { useMemo } from "react";
import { AlertTriangle, Clock, ArrowRight } from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { freshnessOf, countFreshness } from "../utils/rateFreshness.jsx";

export default function RatesFreshnessBanner({ onOpenRates }) {
  const { pairs } = useRates();

  // Считаем только default pairs (одна пара = одна запись актуальности)
  const counts = useMemo(() => {
    if (!Array.isArray(pairs)) return { fresh: 0, stale: 0, outdated: 0, total: 0 };
    const defaults = pairs.filter((p) => p.isDefault);
    return countFreshness(defaults, (p) => p.updatedAt);
  }, [pairs]);

  // Если все актуальные — скрываемся.
  if (counts.outdated === 0 && counts.stale === 0) return null;

  const isCritical = counts.outdated > 0;
  const tone = isCritical ? "rose" : "amber";

  const cls = {
    rose: {
      bg: "bg-rose-50",
      border: "border-rose-200",
      text: "text-rose-900",
      icon: "text-rose-600",
      ring: "hover:ring-rose-300",
    },
    amber: {
      bg: "bg-amber-50",
      border: "border-amber-200",
      text: "text-amber-900",
      icon: "text-amber-600",
      ring: "hover:ring-amber-300",
    },
  }[tone];

  const Icon = isCritical ? AlertTriangle : Clock;

  return (
    <button
      type="button"
      onClick={onOpenRates}
      className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-[12px] border ${cls.bg} ${cls.border} ${cls.text} hover:ring-2 ${cls.ring} transition-all`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon className={`w-4 h-4 ${cls.icon} shrink-0 ${isCritical ? "animate-pulse" : ""}`} />
        <div className="text-left min-w-0">
          <div className="text-[12.5px] font-bold tracking-tight">
            {isCritical
              ? `${counts.outdated} устаревш${pluralRu(counts.outdated, "ий курс", "их курса", "их курсов")}`
              : `${counts.stale} устарева${pluralRu(counts.stale, "ющий курс", "ющих курса", "ющих курсов")}`}
            {counts.outdated > 0 && counts.stale > 0 && (
              <span className="opacity-70 font-semibold ml-1">
                · ещё {counts.stale} устаревает
              </span>
            )}
          </div>
          <div className="text-[10.5px] opacity-70 truncate">
            {isCritical
              ? "Не обновлялись более 6 часов — обнови перед сделками"
              : "Обновлялись 1-6 часов назад — стоит проверить"}
          </div>
        </div>
      </div>
      <div className={`inline-flex items-center gap-1 text-[10.5px] font-bold ${cls.text} opacity-90 shrink-0`}>
        Курсы
        <ArrowRight className="w-3 h-3" />
      </div>
    </button>
  );
}

function pluralRu(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
