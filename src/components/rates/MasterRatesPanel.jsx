// src/components/rates/MasterRatesPanel.jsx
// Секция «Мастер» — табло курсов обменника против USDT (кеш-кеш).
// 3 строки-валюты (USD/TRY/EUR), две котировки направлений тесной парой
// справа: USDT→X и X→USDT (bid/ask). USDT↔USD — в процентах, TRY/EUR —
// абсолютом >1. Клик по значению — inline-правка; commit → onCommit(from,to,rate).

import React, { useState, useRef, useEffect } from "react";
import {
  isPercentPair,
  percentToRate,
  displayValue,
  toStoredRate,
  formatRateValue,
} from "../../utils/ratesFormat.js";

// Валюты, котируемые против USDT (строки табло).
export const MASTER_QUOTES = ["USD", "TRY", "EUR"];

const CELL_W = "w-[84px]";

function ValueCell({ from, to, rate, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef(null);
  const pct = isPercentPair(from, to);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [editing]);

  const start = () => {
    const disp = displayValue(from, to, rate);
    const shown = Number.isFinite(disp) ? (pct ? disp.toFixed(2) : String(disp)) : "";
    setDraft(shown.replace(".", ","));
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const raw = String(draft).trim().replace("−", "-").replace(",", ".").replace("%", "");
    if (raw === "") return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const next = pct ? percentToRate(n) : toStoredRate(from, to, n, rate);
    if (Math.abs(next - Number(rate)) < 1e-9) return;
    onCommit?.(from, to, next);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.,\-−]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        className={`${CELL_W} bg-surface border border-accent rounded-[6px] px-1.5 py-1 text-right text-body-sm font-mono tabular-nums outline-none shadow-input-focus`}
      />
    );
  }

  const neg = pct && Number(rate) < 1;
  return (
    <button
      type="button"
      onClick={start}
      title="Клик — изменить"
      className={`${CELL_W} text-right font-mono tabular-nums text-body-sm font-semibold cursor-text rounded-[6px] px-1.5 py-1 transition-colors hover:bg-surface-sunk ${
        pct ? (neg ? "text-danger" : "text-success") : "text-ink"
      }`}
    >
      {formatRateValue(from, to, rate)}
    </button>
  );
}

export default function MasterRatesPanel({ getRate, onCommit, hasOverride }) {
  return (
    <section className="px-1">
      {/* Заголовок секции */}
      <div className="flex items-center gap-2 px-2 pb-1.5">
        <span className="text-micro font-bold uppercase tracking-wider text-muted">
          Мастер
        </span>
        <span className="text-tiny font-mono text-muted-soft">USDT · кеш-кеш</span>
        <span className="flex-1 h-px bg-border-soft" />
      </div>

      {/* Заголовки колонок-направлений (выровнены над значениями справа) */}
      <div className="flex items-center justify-end gap-1.5 px-2 pb-1">
        <span className={`${CELL_W} text-right text-tiny font-mono text-muted-soft pr-1.5`}>
          USDT→
        </span>
        <span className={`${CELL_W} text-right text-tiny font-mono text-muted-soft pr-1.5`}>
          →USDT
        </span>
      </div>

      {/* Строки-валюты: валюта слева, две котировки (bid/ask) тесной парой справа */}
      <div className="space-y-0.5">
        {MASTER_QUOTES.map((q) => {
          const fRate = Number(getRate?.("USDT", q));
          const rRate = Number(getRate?.(q, "USDT"));
          const ovr = hasOverride?.("USDT", q) || hasOverride?.(q, "USDT");
          return (
            <div
              key={q}
              className="flex items-center justify-between gap-2 px-2 py-0.5 rounded-[8px] hover:bg-surface-soft transition-colors"
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
              <div className="flex items-center gap-1.5 shrink-0">
                <ValueCell from="USDT" to={q} rate={fRate} onCommit={onCommit} />
                <ValueCell from={q} to="USDT" rate={rRate} onCommit={onCommit} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
