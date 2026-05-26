// src/components/rates/RatesTable.jsx
//
// Табличный вид курсов — единый компонент для Кассы (view) и редактора
// (edit). Никаких CurrencyIcon — только текст и числа, как на
// investing.com / TradingView. Колонки выровнены CSS Grid'ом.
//
// View mode:  ★ | Пара | Курс | Обратный | ● Возраст
// Edit mode:  ★ | Пара | Курс* | Spread%* | Обратный | ● Возраст
//   (* — клик → inline-input, Enter/blur — commit, Esc — отмена)
//
// Логику favorites / office tabs / search / expand держит родитель
// (RatesSidebar / RatesPage) — этот компонент только рендерит строки.

import React, { useState, useEffect, useRef } from "react";
import { Star } from "lucide-react";
import { freshnessOf, shortAge, tooltipFor } from "../../utils/rateFreshness.jsx";

// Стиль точки «возраста». Зелёная если < 1ч, янтарная 1-6ч, красная >6ч.
function ageDotClass(state) {
  if (state === "fresh") return "bg-success";
  if (state === "stale") return "bg-warning";
  return "bg-danger";
}

// Форматирование курса: ≥ 1 — 4 знака, < 1 — 6 значащих цифр без хвостовых
// нулей. Согласовано с formatInverseRate из RatesPage.
function formatNum(v) {
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1) return v.toFixed(4);
  const s = v.toPrecision(6);
  return s.includes("e") ? s : s.replace(/\.?0+$/, "");
}

// Inline cell с числом + опционально кликом для редактирования.
function NumCell({
  value,
  editable = false,
  onCommit,
  width = "w-[88px]",
  suffix = null,
  align = "right",
  placeholder = "",
  format = formatNum,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = () => {
    if (!editable) return;
    setDraft(Number.isFinite(value) ? String(value) : "");
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (!onCommit) return;
    const raw = String(draft).trim().replace(",", ".");
    if (raw === "") return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    if (n === Number(value)) return;
    onCommit(n);
  };

  const cancel = () => {
    setEditing(false);
    setDraft("");
  };

  if (editing) {
    return (
      <div className={`${width} relative`}>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) =>
            setDraft(e.target.value.replace(/[^\d.,-]/g, ""))
          }
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className={`w-full bg-white border border-accent rounded-[6px] px-1.5 py-0.5 text-body-sm font-mono tabular-nums outline-none ${
            align === "right" ? "text-right" : "text-left"
          } ${suffix ? "pr-4" : ""}`}
        />
        {suffix && (
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-tiny text-muted-soft pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      disabled={!editable}
      title={editable ? "Клик — редактировать" : undefined}
      className={`${width} font-mono tabular-nums text-body-sm ${
        align === "right" ? "text-right" : "text-left"
      } ${
        editable
          ? "cursor-text rounded-[4px] hover:bg-amber-50 -mx-1 px-1"
          : "cursor-default text-muted"
      }`}
    >
      {Number.isFinite(value) && value > 0 ? (
        <>
          {format(value)}
          {suffix && (
            <span className="ml-0.5 text-tiny text-muted-soft">{suffix}</span>
          )}
        </>
      ) : (
        <span className="text-muted-soft">{placeholder || "—"}</span>
      )}
    </button>
  );
}

// Один ряд таблицы. Кликабельные ячейки (Rate/Spread) — только в edit mode.
function Row({
  a,
  b,
  isFavorite,
  onToggleFavorite,
  rate,                 // effective rate (с учётом spread)
  inverseRate,          // 1/rate
  hasOverride,
  updatedAt,
  // edit-only
  mode,
  baseRate,
  spreadPercent,
  onCommitBase,
  onCommitSpread,
  gridCols,
}) {
  const { state, ageMs } = freshnessOf(updatedAt);
  const ageLabel = shortAge(ageMs);
  const dot = ageDotClass(state);

  return (
    <div
      className={`grid items-center gap-2 px-2 py-1.5 rounded-[6px] transition-colors ${
        isFavorite ? "bg-fav-bg hover:bg-fav-bg-hover" : "hover:bg-surface-soft"
      }`}
      style={{ gridTemplateColumns: gridCols }}
    >
      {/* ★ Favorite */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite?.(a, b);
        }}
        className={`shrink-0 ${
          isFavorite
            ? "text-[#FBBF24] hover:text-warning"
            : "text-border hover:text-amber-400"
        }`}
        title={isFavorite ? "Убрать из избранного" : "В избранное"}
        aria-label={isFavorite ? "Убрать из избранного" : "В избранное"}
      >
        <Star
          className="w-3.5 h-3.5"
          strokeWidth={2}
          fill={isFavorite ? "currentColor" : "none"}
        />
      </button>

      {/* Pair label */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-mono font-bold text-body-sm text-ink tracking-tight whitespace-nowrap">
          {a}
          <span className="text-muted-soft mx-0.5">/</span>
          {b}
        </span>
        {hasOverride && (
          <span
            className="inline-flex items-center h-4 px-1 rounded-[3px] font-mono text-micro font-bold bg-accent-bg text-accent tracking-wide"
            title="Office override активен"
          >
            OFC
          </span>
        )}
      </div>

      {/* Rate — editable в edit-mode (показываем baseRate; spread отдельно).
          В view-mode показываем effective rate. */}
      {mode === "edit" ? (
        <NumCell
          value={Number(baseRate)}
          editable
          onCommit={(n) => onCommitBase?.(a, b, n)}
          width="w-full"
          align="right"
        />
      ) : (
        <div className="font-mono tabular-nums text-body-sm font-bold text-ink text-right">
          {formatNum(rate)}
        </div>
      )}

      {/* Spread% — только в edit */}
      {mode === "edit" && (
        <NumCell
          value={Number(spreadPercent)}
          editable
          onCommit={(n) => onCommitSpread?.(a, b, n)}
          width="w-full"
          align="right"
          suffix="%"
          format={(v) => (Number.isFinite(v) ? v.toString() : "0")}
        />
      )}

      {/* Inverse rate (read-only всегда) */}
      <div className="font-mono tabular-nums text-body-sm text-muted text-right">
        {formatNum(inverseRate)}
      </div>

      {/* ● Age */}
      <div
        className="flex items-center gap-1 justify-end"
        title={tooltipFor(updatedAt)}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden />
        <span className="font-mono tabular-nums text-tiny text-muted">
          {ageLabel}
        </span>
      </div>
    </div>
  );
}

export default function RatesTable({
  mode = "view",
  pairs = [],
  favorites,
  onToggleFavorite,
  getRate,
  getBaseRate,
  getSpreadPercent,
  hasOverride,
  pairUpdatedAt,
  onCommitBase,
  onCommitSpread,
  groupSeparators = null,
  emptyText = "ничего не найдено",
  showHeader = true,
}) {
  // Column template: ★(20) | pair(1fr) | rate(80) [| spread(72)] | inverse(80) | age(60)
  const gridCols =
    mode === "edit"
      ? "20px minmax(110px,1fr) 96px 80px 90px 64px"
      : "20px minmax(110px,1fr) 96px 90px 64px";

  const isFav = React.useCallback(
    (a, b) => favorites?.has([a, b].sort().join("_")) ?? false,
    [favorites]
  );

  if (!pairs.length) {
    return (
      <div className="text-center py-6 text-caption text-muted">{emptyText}</div>
    );
  }

  // Build rows with optional group separators interleaved by index.
  const sepBefore = new Map();
  (groupSeparators || []).forEach((g) => {
    if (Number.isFinite(g.beforeIndex)) sepBefore.set(g.beforeIndex, g);
  });

  return (
    <div className="text-ink">
      {showHeader && (
        <div
          className="grid items-center gap-2 px-2 pb-1.5 border-b border-border-soft"
          style={{ gridTemplateColumns: gridCols }}
        >
          <span />
          <span className="text-micro font-bold uppercase tracking-wider text-muted-soft">
            Пара
          </span>
          <span className="text-micro font-bold uppercase tracking-wider text-muted-soft text-right">
            Курс
          </span>
          {mode === "edit" && (
            <span className="text-micro font-bold uppercase tracking-wider text-muted-soft text-right">
              Spread
            </span>
          )}
          <span className="text-micro font-bold uppercase tracking-wider text-muted-soft text-right">
            Обратный
          </span>
          <span className="text-micro font-bold uppercase tracking-wider text-muted-soft text-right">
            Возр.
          </span>
        </div>
      )}

      <div className="py-1 space-y-0.5">
        {pairs.map(([a, b], idx) => {
          const sep = sepBefore.get(idx);
          const rate = getRate ? Number(getRate(a, b)) : NaN;
          const baseRate = getBaseRate ? Number(getBaseRate(a, b)) : rate;
          const spreadPercent = getSpreadPercent
            ? Number(getSpreadPercent(a, b))
            : 0;
          const inverse = Number.isFinite(rate) && rate > 0 ? 1 / rate : NaN;
          const ovr = hasOverride ? !!hasOverride(a, b) : false;
          const updatedAt = pairUpdatedAt ? pairUpdatedAt(a, b) : null;

          return (
            <React.Fragment key={`${a}_${b}`}>
              {sep && (
                <div className="px-2 pt-2 pb-1 flex items-center gap-2">
                  <span className="text-tiny font-bold tracking-wider text-muted-soft uppercase whitespace-nowrap shrink-0">
                    {sep.label}
                    {sep.count != null && (
                      <span className="ml-1 text-muted-soft">· {sep.count}</span>
                    )}
                  </span>
                  <span className="flex-1 h-px bg-border-soft" />
                </div>
              )}
              <Row
                a={a}
                b={b}
                isFavorite={isFav(a, b)}
                onToggleFavorite={onToggleFavorite}
                rate={rate}
                inverseRate={inverse}
                hasOverride={ovr}
                updatedAt={updatedAt}
                mode={mode}
                baseRate={baseRate}
                spreadPercent={spreadPercent}
                onCommitBase={onCommitBase}
                onCommitSpread={onCommitSpread}
                gridCols={gridCols}
              />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
