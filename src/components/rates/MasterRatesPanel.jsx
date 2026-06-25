// src/components/rates/MasterRatesPanel.jsx
// Табло курсов USDT (read-only, информационное). Валюты зависят от офиса.
// Адаптивно: если у направлений нет спреда (обратный = 1/прямого), показываем
// ОДНО значение на валюту; если спред задан (прямой ≠ обратный) — две колонки
// USDT→X и X→USDT (bid/ask), как в листе менеджеров.
// Правка курсов — НЕ здесь (через «Изм.» / «Вставить курсы»).

import React from "react";
import { formatRateValue, displayValue } from "../../utils/ratesFormat.js";

const DEFAULT_QUOTES = ["USD", "TRY", "EUR"];
const GRID2 = { gridTemplateColumns: "1fr 84px 84px" };

// Спред считаем значимым, если стороны расходятся больше чем на ~0,08%.
function hasSpread(fwdDisp, revDisp) {
  if (!Number.isFinite(fwdDisp) || !Number.isFinite(revDisp) || fwdDisp === 0) return false;
  return Math.abs(fwdDisp - revDisp) / Math.abs(fwdDisp) > 0.0008;
}

export default function MasterRatesPanel({ getRate, hasOverride, quotes }) {
  const list = quotes && quotes.length ? quotes : DEFAULT_QUOTES;

  const rows = list.map((q) => {
    const fwd = Number(getRate?.("USDT", q));
    const rev = Number(getRate?.(q, "USDT"));
    return {
      q,
      fwd,
      rev,
      spread: hasSpread(displayValue("USDT", q, fwd), displayValue(q, "USDT", rev)),
      ovr: hasOverride?.("USDT", q) || hasOverride?.(q, "USDT"),
    };
  });
  const anySpread = rows.some((r) => r.spread);

  return (
    <section className="px-1 pt-1">
      {anySpread && (
        <div className="grid items-center px-2 pb-0.5" style={GRID2}>
          <span />
          <span className="text-right text-tiny font-mono text-muted-soft">USDT→</span>
          <span className="text-right text-tiny font-mono text-muted-soft">→USDT</span>
        </div>
      )}

      <div className="space-y-0.5">
        {rows.map(({ q, fwd, rev, ovr }) => (
          <div
            key={q}
            className={`items-center px-2 py-1 rounded-[8px] hover:bg-surface-soft transition-colors ${
              anySpread ? "grid" : "flex justify-between"
            }`}
            style={anySpread ? GRID2 : undefined}
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
            {anySpread && (
              <span className="text-right font-mono tabular-nums text-body-sm font-semibold text-ink">
                {formatRateValue(q, "USDT", rev)}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
