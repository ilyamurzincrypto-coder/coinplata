// src/utils/dealKind.js
// Хелперы для отображения in_kind / out_kind / kind в UI.

import React from "react";

export const IN_KIND_LABELS = {
  ours_now:      { short: "Наш",       full: "Принимаем сейчас",     tone: "emerald" },
  partner_now:   { short: "Партнёр",   full: "Принимает партнёр",    tone: "indigo"  },
  ours_later:    { short: "Клиент → нам", full: "Клиент должен нам",  tone: "amber"   },
  partner_later: { short: "Партнёр → нам", full: "Партнёр должен нам", tone: "amber" },
};

export const OUT_KIND_LABELS = {
  ours_now:      { short: "Наш",       full: "Выдаём сейчас",         tone: "emerald" },
  partner_now:   { short: "Партнёр",   full: "Выдаёт партнёр",        tone: "indigo"  },
  ours_later:    { short: "Мы → клиенту",      full: "Мы должны клиенту",      tone: "amber" },
  partner_later: { short: "Партнёр → клиенту", full: "Партнёр должен клиенту", tone: "amber" },
};

export const KIND_LABELS = {
  regular: { label: "Обмен",    tone: "slate" },
  otc:     { label: "OTC",      tone: "indigo" },
  broker:  { label: "Брокеридж", tone: "violet" },
};

export const TONE_CLS = {
  slate:   "bg-surface-soft text-ink-soft ring-border-soft",
  emerald: "bg-success-soft text-success ring-emerald-200",
  indigo:  "bg-accent-bg text-accent ring-indigo-200",
  amber:   "bg-warning-soft text-amber-800 ring-amber-200",
  violet:  "bg-accent-bg text-accent ring-violet-200",
  rose:    "bg-danger-soft text-danger ring-rose-200",
};

// Side-status (pending/partial/completed) на основе planned vs actual.
// Возвращает {status, paid, planned}.
export function computeSideStatus(planned, actual) {
  const p = Number(planned) || 0;
  const a = Number(actual) || 0;
  if (a + 0.00000001 >= p && p > 0) return { status: "completed", paid: a, planned: p };
  if (a > 0 && a < p) return { status: "partial", paid: a, planned: p };
  return { status: "pending", paid: a, planned: p };
}

export const SIDE_STATUS_CLS = {
  completed: "bg-success-soft text-success ring-emerald-200",
  partial:   "bg-accent-bg text-accent ring-violet-200",
  pending:   "bg-warning-soft text-warning ring-amber-200",
};

export const SIDE_STATUS_LABEL = {
  completed: "Получено",
  partial:   "Частично",
  pending:   "Ожидание",
};

// Compact pill-component для inline-рендеринга в таблицах.
// Использование:
//   <KindPill type="in" kind={tx.inKind} />
//   <KindPill type="out" kind={leg.outKind} />
//   <KindPill type="deal" kind={tx.kind} />
export function KindPill({ type, kind, compact = false }) {
  if (!kind) return null;
  let label, tone;
  if (type === "in") {
    const m = IN_KIND_LABELS[kind];
    if (!m) return null;
    label = compact ? m.short : m.full;
    tone = m.tone;
  } else if (type === "out") {
    const m = OUT_KIND_LABELS[kind];
    if (!m) return null;
    label = compact ? m.short : m.full;
    tone = m.tone;
  } else if (type === "deal") {
    const m = KIND_LABELS[kind];
    if (!m || kind === "regular") return null;
    label = m.label;
    tone = m.tone;
  } else {
    return null;
  }
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[9.5px] font-bold ring-1 ${TONE_CLS[tone] || TONE_CLS.slate}`}
      title={
        type === "in"  ? IN_KIND_LABELS[kind]?.full :
        type === "out" ? OUT_KIND_LABELS[kind]?.full :
        KIND_LABELS[kind]?.label
      }
    >
      {label}
    </span>
  );
}
