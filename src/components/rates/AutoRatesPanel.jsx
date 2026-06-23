// src/components/rates/AutoRatesPanel.jsx
// Секция «Авто» — производные кросс-курсы кеш-кеш между USD/EUR/TRY/RUB,
// выведенные из мастера через USDT-пивот (convert). Read-only.

import React from "react";
import { convert } from "../../utils/convert.js";
import { formatRateValue } from "../../utils/ratesFormat.js";

export const AUTO_CCYS = ["USD", "EUR", "TRY", "RUB"];

function autoPairs() {
  const out = [];
  for (const a of AUTO_CCYS) for (const b of AUTO_CCYS) if (a !== b) out.push([a, b]);
  return out;
}

export default function AutoRatesPanel({ getRate }) {
  const pairs = autoPairs();
  return (
    <div className="px-1 pt-1">
      <div className="flex items-center gap-2 px-1 pb-1">
        <span className="text-micro font-bold uppercase tracking-wider text-muted-soft">Авто · кеш-кеш</span>
        <span className="flex-1 h-px bg-border-soft" />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {pairs.map(([a, b]) => {
          const rate = convert(1, a, b, getRate);
          return (
            <div key={`${a}_${b}`} className="flex items-center justify-between px-1.5 py-0.5 rounded-[5px] opacity-80">
              <span className="font-mono text-tiny text-muted whitespace-nowrap">
                {a}<span className="text-muted-soft mx-0.5">→</span>{b}
              </span>
              <span className="font-mono tabular-nums text-tiny text-muted">
                {Number.isFinite(rate) && rate > 0 ? formatRateValue(a, b, rate) : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
