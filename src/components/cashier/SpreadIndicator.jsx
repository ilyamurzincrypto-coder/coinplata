// src/components/cashier/SpreadIndicator.jsx
// Spread indicator рядом с RateCell. Сравнивает текущий rate с market.
// Показывает direction (наш курс выше/ниже market) + percent.

import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

const SPREAD_WARN_PERCENT = 5; // > 5% off → красный

export default function SpreadIndicator({
  currentRate,
  marketRate,
}) {
  if (currentRate == null || marketRate == null) return null;
  const cur = Number(currentRate);
  const m = Number(marketRate);
  if (!Number.isFinite(cur) || !Number.isFinite(m) || cur <= 0 || m <= 0) return null;
  if (cur === m) {
    return (
      <span className="inline-flex items-center text-[10px] text-slate-400" title={`mid: ${m}`}>
        <Minus className="w-3 h-3" /> mid
      </span>
    );
  }
  const pct = ((cur - m) / m) * 100;
  const above = pct > 0;
  // Above mid (наша продажа > market) → profitable → зелёный.
  // Below mid (наша продажа < market) → less profitable → amber/red.
  const tone = Math.abs(pct) > SPREAD_WARN_PERCENT
    ? "text-rose-600"
    : above
      ? "text-emerald-600"
      : "text-amber-600";
  const Icon = above ? TrendingUp : TrendingDown;
  const sign = above ? "+" : "";
  const title =
    `current: ${cur}, market: ${m}, spread ${sign}${pct.toFixed(2)}% from mid`;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] tabular-nums ${tone}`} title={title}>
      <Icon className="w-3 h-3" />
      {sign}{pct.toFixed(1)}%
    </span>
  );
}
