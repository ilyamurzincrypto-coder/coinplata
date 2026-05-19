// src/components/deal-form/DealSummary.jsx
//
// Bottom-полоса формы: summary slice (что обмен в одну строку) +
// Cancel + большая чёрная submit с emerald-glow (anchor).

import React from "react";

export default function DealSummary({
  summary,           // string — "10 000 USDT × 44.60 = 346 000 ₺"
  marginUsd,         // number (опц.)
  spreadPct,         // number (опц.)
  canSubmit,
  submitting,
  onCancel,
  onSubmit,
  draftAgeText,      // string | null — «2 сек назад» / null если нет draft
}) {
  const hasMargin = Number.isFinite(marginUsd);
  return (
    <div className="m-6 p-4 bg-surface-soft rounded-card-lg">
      {/* Summary line */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0 flex-1">
          <div className="text-caption text-muted font-mono tabular mb-0.5">
            Резюме
          </div>
          <div className="text-body font-mono tabular text-ink font-semibold truncate">
            {summary || "—"}
          </div>
        </div>
        {hasMargin && (
          <div className="text-right shrink-0">
            <div className="text-caption text-muted">Маржа</div>
            <div className={`font-mono tabular text-h3 font-bold ${marginUsd >= 0 ? "text-success" : "text-danger"}`}>
              {marginUsd >= 0 ? "+" : "−"}${Math.abs(marginUsd).toFixed(2)}
            </div>
            {Number.isFinite(spreadPct) && (
              <div className="text-tiny text-muted font-mono">
                {(spreadPct * 100).toFixed(2)}% спред
              </div>
            )}
          </div>
        )}
      </div>

      {/* Submit row */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="h-12 px-5 rounded-button bg-surface border border-border text-ink text-body-sm font-semibold hover:bg-surface-sunk transition-colors shrink-0"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit || submitting}
          className={`flex-1 h-12 inline-flex items-center justify-center gap-3 rounded-button text-white text-body font-semibold transition-all ${
            (!canSubmit || submitting)
              ? "bg-ink/40 cursor-not-allowed"
              : "bg-ink hover:bg-black hover:-translate-y-px shadow-cta-glow-big"
          }`}
        >
          {submitting ? "Создание…" : "Создать сделку"}
          {!submitting && (
            <kbd className="inline-flex items-center justify-center h-5 px-1.5 bg-white/15 border border-white/20 rounded text-tiny font-mono font-semibold">
              ⌘↵
            </kbd>
          )}
        </button>
      </div>

      {/* Draft autosave подпись — внизу centred mono caption */}
      {draftAgeText && (
        <div className="mt-3 text-center text-tiny text-muted-soft font-mono inline-flex items-center justify-center gap-1.5 w-full">
          <span className="w-1.5 h-1.5 rounded-full bg-success/60" />
          Черновик сохранён · {draftAgeText}
        </div>
      )}
    </div>
  );
}
