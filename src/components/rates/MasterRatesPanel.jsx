// src/components/rates/MasterRatesPanel.jsx
// Секция «Мастер» — рабочий лист курсов против USDT (как у менеджеров в чате):
// 6 направленных строк «ОТКУДА → КУДА  значение», сгруппированных по валюте.
// Направления НЕ совпадают — это bid/ask со спредом (USDT→TRY ≠ TRY→USDT).
// USDT↔USD — в процентах, TRY/EUR — абсолютом. Клик по значению — inline-правка.

import React, { useState, useRef, useEffect } from "react";
import {
  isPercentPair,
  percentToRate,
  displayValue,
  toStoredRate,
  formatRateValue,
} from "../../utils/ratesFormat.js";

// Валюты мастера зависят от офиса (турецкие → USD/TRY/EUR, российские → RUB).
// Из списка валют строим направленные строки: USDT→X, затем X→USDT.
const DEFAULT_QUOTES = ["USD", "TRY", "EUR"];

function rowsFromQuotes(quotes) {
  return (quotes || DEFAULT_QUOTES).flatMap((q) => [
    ["USDT", q],
    [q, "USDT"],
  ]);
}

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
        className="w-[88px] bg-surface border border-accent rounded-[6px] px-1.5 py-1 text-right text-body-sm font-mono tabular-nums outline-none shadow-input-focus"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      title="Клик — изменить"
      className="w-[88px] text-right font-mono tabular-nums text-body-sm font-semibold text-ink cursor-text rounded-[6px] px-1.5 py-1 transition-colors hover:bg-surface-sunk"
    >
      {formatRateValue(from, to, rate)}
    </button>
  );
}

export default function MasterRatesPanel({ getRate, onCommit, hasOverride, quotes }) {
  const rows = rowsFromQuotes(quotes);
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

      {/* Направленные строки листа, сгруппированы по валюте */}
      <div>
        {rows.map(([from, to], i) => {
          const rate = Number(getRate?.(from, to));
          const ovr = hasOverride?.(from, to);
          const groupBreak = i !== 0 && i % 2 === 0; // новая валюта — каждые 2 строки
          return (
            <div
              key={`${from}_${to}`}
              className={`flex items-center justify-between gap-2 px-2 py-[3px] rounded-[8px] hover:bg-surface-soft transition-colors ${
                groupBreak ? "mt-1.5" : ""
              }`}
            >
              <span className="flex items-center gap-1 font-mono text-body-sm whitespace-nowrap">
                <span className="font-bold text-ink">{from}</span>
                <span className="text-muted-soft">→</span>
                <span className="font-bold text-ink">{to}</span>
                {ovr && (
                  <span
                    className="ml-1 w-1.5 h-1.5 rounded-full bg-accent"
                    title="Переопределено для офиса"
                  />
                )}
              </span>
              <ValueCell from={from} to={to} rate={rate} onCommit={onCommit} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
