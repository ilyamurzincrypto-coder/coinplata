// src/components/rates/CrossRatesPanel.jsx
// Кросс-курсы (кеш-кеш) офиса — ТОЛЬКО между валютами этого офиса, выведенные
// на лету через USDT-пивот по его же курсам (getRate офиса сам триангулирует
// через USDT). Bank-view: всегда сторона ≥1 (если <1 — инвертируем направление).
// Офис с одной фиат-валютой (Москва = RUB) кросса не имеет. Read-only.

import React from "react";
import { convert } from "../../utils/convert.js";
import { formatRateValue } from "../../utils/ratesFormat.js";

function uniquePairs(ccys) {
  const out = [];
  for (let i = 0; i < ccys.length; i++)
    for (let j = i + 1; j < ccys.length; j++) out.push([ccys[i], ccys[j]]);
  return out;
}

export default function CrossRatesPanel({ getRate, ccys }) {
  const fiats = (ccys || []).filter((c) => c !== "USDT");
  const rows = uniquePairs(fiats)
    .map(([a, b]) => {
      let rate = convert(1, a, b, getRate);
      let from = a;
      let to = b;
      if (Number.isFinite(rate) && rate > 0 && rate < 1) {
        rate = 1 / rate;
        from = b;
        to = a;
      }
      return { from, to, rate };
    })
    .filter((r) => Number.isFinite(r.rate) && r.rate > 0);

  if (rows.length === 0) return null; // один фиат (Москва) → кросса нет

  return (
    <div className="px-1 pt-1">
      <div className="flex items-center gap-2 px-2 pb-1">
        <span className="text-micro font-bold uppercase tracking-wider text-muted-soft">
          Кросс
        </span>
        <span className="text-tiny font-mono text-muted-soft">кеш-кеш</span>
        <span className="flex-1 h-px bg-border-soft" />
      </div>
      <div className="rounded-[10px] bg-surface-sunk/50 px-2 py-1 space-y-0.5">
        {rows.map(({ from, to, rate }) => (
          <div key={`${from}_${to}`} className="flex items-center justify-between px-1.5 py-0.5">
            <span className="font-mono text-tiny text-muted whitespace-nowrap">
              {from}
              <span className="text-muted-soft mx-0.5">→</span>
              {to}
            </span>
            <span className="font-mono tabular-nums text-tiny text-ink-soft">
              {formatRateValue(from, to, rate)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
