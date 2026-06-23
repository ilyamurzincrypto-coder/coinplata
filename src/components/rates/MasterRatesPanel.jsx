// src/components/rates/MasterRatesPanel.jsx
// Секция «Мастер» — USDT кеш-кеш, 6 направленных строк (их лист).
// USDT↔USD → проценты, TRY/EUR → абсолют. Клик по значению — inline-правка
// в том же формате; commit → onCommit(from,to,absoluteRate).

import React, { useState, useRef, useEffect } from "react";
import { isPercentPair, percentToRate, formatRateValue } from "../../utils/ratesFormat.js";

export const MASTER_ROWS = [
  ["USDT", "USD"],
  ["USD", "USDT"],
  ["USDT", "TRY"],
  ["TRY", "USDT"],
  ["USDT", "EUR"],
  ["EUR", "USDT"],
];

function ValueCell({ from, to, rate, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef(null);
  const pct = isPercentPair(from, to);

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select(); }
  }, [editing]);

  const start = () => {
    const shown = pct ? ((Number(rate) - 1) * 100).toFixed(2) : String(rate ?? "");
    setDraft(shown.replace(".", ","));
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const raw = String(draft).trim().replace("−", "-").replace(",", ".").replace("%", "");
    if (raw === "") return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const next = pct ? percentToRate(n) : n;
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
          if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
        }}
        className="w-[92px] bg-white border border-accent rounded-[6px] px-1.5 py-0.5 text-right text-body-sm font-mono tabular-nums outline-none"
      />
    );
  }
  const neg = pct && Number(rate) < 1;
  return (
    <button
      type="button"
      onClick={start}
      title="Клик — изменить"
      className={`w-[92px] text-right font-mono tabular-nums text-body-sm font-semibold cursor-text rounded-[4px] hover:bg-amber-50 px-1 ${
        pct ? (neg ? "text-danger" : "text-success") : "text-ink"
      }`}
    >
      {formatRateValue(from, to, rate)}
    </button>
  );
}

export default function MasterRatesPanel({ getRate, onCommit, pairUpdatedAt, hasOverride }) {
  return (
    <div className="px-1">
      <div className="flex items-center gap-2 px-1 pb-1">
        <span className="text-micro font-bold uppercase tracking-wider text-muted-soft">Мастер · USDT кеш-кеш</span>
        <span className="flex-1 h-px bg-border-soft" />
      </div>
      <div className="space-y-0.5">
        {MASTER_ROWS.map(([from, to]) => {
          const rate = Number(getRate?.(from, to));
          const ovr = hasOverride?.(from, to);
          return (
            <div key={`${from}_${to}`} className="grid items-center gap-2 px-1.5 py-1 rounded-[6px] hover:bg-surface-soft"
                 style={{ gridTemplateColumns: "minmax(96px,1fr) 92px" }}>
              <span className="font-mono font-bold text-body-sm text-ink whitespace-nowrap">
                {from}<span className="text-muted-soft mx-0.5">→</span>{to}
                {ovr && <span className="ml-1 text-micro font-bold text-accent">OFC</span>}
              </span>
              <ValueCell from={from} to={to} rate={rate} onCommit={onCommit} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
