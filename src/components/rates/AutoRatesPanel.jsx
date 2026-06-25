// src/components/rates/AutoRatesPanel.jsx
// Секция «Авто» — производные кросс-курсы кеш-кеш между USD/EUR/TRY/RUB,
// выведенные из мастера через USDT-пивот (convert). Read-only, вторичный вес:
// утопленный фон отделяет «считаемое» от редактируемого мастера.

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
    <section className="px-1 pt-2">
      <div className="flex items-center gap-2 px-1.5 pb-1">
        <span className="text-micro font-bold uppercase tracking-wider text-muted-soft">
          Авто
        </span>
        <span className="text-tiny font-mono text-muted-soft">производные · кросс</span>
        <span className="flex-1 h-px bg-border-soft" />
      </div>

      <div className="rounded-[10px] bg-surface-sunk/60 px-1 py-1 grid grid-cols-2 gap-x-1">
        {pairs.map(([a, b]) => {
          const rate = convert(1, a, b, getRate);
          const ok = Number.isFinite(rate) && rate > 0;
          return (
            <div
              key={`${a}_${b}`}
              className="flex items-center justify-between gap-1.5 px-1.5 py-[3px] rounded-[6px] hover:bg-surface"
            >
              <span className="font-mono text-tiny text-muted whitespace-nowrap">
                {a}
                <span className="text-muted-soft mx-0.5">→</span>
                {b}
              </span>
              <span
                className={`font-mono tabular-nums text-tiny ${
                  ok ? "text-ink-soft" : "text-muted-soft"
                }`}
              >
                {ok ? formatRateValue(a, b, rate) : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
