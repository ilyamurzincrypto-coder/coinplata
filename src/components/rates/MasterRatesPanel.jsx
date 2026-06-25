// src/components/rates/MasterRatesPanel.jsx
// Табло курсов USDT (кеш-кеш) — read-only, информационное. Строка на валюту,
// два направления в колонках: USDT→X и X→USDT (bid/ask со спредом).
// Валюты зависят от офиса (USD/TRY/EUR для турецких, RUB для российских).
// Правка курсов — НЕ здесь (через «Изм.» / «Вставить курсы»).

import React from "react";
import { formatRateValue } from "../../utils/ratesFormat.js";

const DEFAULT_QUOTES = ["USD", "TRY", "EUR"];
const GRID = { gridTemplateColumns: "1fr 84px 84px" };

export default function MasterRatesPanel({ getRate, hasOverride, quotes }) {
  const list = quotes && quotes.length ? quotes : DEFAULT_QUOTES;
  return (
    <section className="px-1">
      {/* Заголовок секции */}
      <div className="flex items-center gap-2 px-2 pb-1">
        <span className="text-micro font-bold uppercase tracking-wider text-muted">
          USDT
        </span>
        <span className="text-tiny font-mono text-muted-soft">кеш-кеш</span>
        <span className="flex-1 h-px bg-border-soft" />
      </div>

      {/* Заголовки колонок-направлений */}
      <div className="grid items-center px-2 pb-0.5" style={GRID}>
        <span />
        <span className="text-right text-tiny font-mono text-muted-soft">USDT→</span>
        <span className="text-right text-tiny font-mono text-muted-soft">→USDT</span>
      </div>

      {/* Строки-валюты */}
      <div className="space-y-0.5">
        {list.map((q) => {
          const fwd = Number(getRate?.("USDT", q));
          const rev = Number(getRate?.(q, "USDT"));
          const ovr = hasOverride?.("USDT", q) || hasOverride?.(q, "USDT");
          return (
            <div
              key={q}
              className="grid items-center px-2 py-1 rounded-[8px] hover:bg-surface-soft transition-colors"
              style={GRID}
            >
              <span className="flex items-center gap-1.5 font-mono font-bold text-body text-ink">
                {q}
                {ovr && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-accent"
                    title="Переопределено для офиса"
                  />
                )}
              </span>
              <span className="text-right font-mono tabular-nums text-body-sm font-semibold text-ink">
                {formatRateValue("USDT", q, fwd)}
              </span>
              <span className="text-right font-mono tabular-nums text-body-sm font-semibold text-ink">
                {formatRateValue(q, "USDT", rev)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
