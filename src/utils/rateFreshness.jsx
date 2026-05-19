// src/utils/rateFreshness.jsx
//
// Индикатор актуальности курсов.
//
// Состояния (порог настраивается через FRESH_THRESHOLDS):
//   fresh    🟢  обновлено < 1 часа назад
//   stale    🟡  1-6 часов
//   outdated 🔴  > 6 часов или нет updatedAt
//
// Используется в RatesSidebar / RatesBar / на дашборде в banner'е.

import React from "react";

export const FRESH_THRESHOLDS = {
  fresh: 60 * 60 * 1000,        // 1 час
  stale: 6 * 60 * 60 * 1000,    // 6 часов
};

export function freshnessOf(updatedAt) {
  if (!updatedAt) {
    return { state: "outdated", label: "—", ageMs: Infinity };
  }
  const t = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) {
    return { state: "outdated", label: "—", ageMs: Infinity };
  }
  const ageMs = Date.now() - t;
  let state = "outdated";
  if (ageMs < FRESH_THRESHOLDS.fresh) state = "fresh";
  else if (ageMs < FRESH_THRESHOLDS.stale) state = "stale";
  return { state, label: relativeTime(ageMs), ageMs };
}

// Короткая подпись «2h ago / 30m ago / just now».
export function relativeTime(ageMs) {
  if (ageMs < 0) return "—";
  const sec = Math.floor(ageMs / 1000);
  if (sec < 60) return "только что";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}м назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}ч назад`;
  const days = Math.floor(hours / 24);
  return `${days}д назад`;
}

// Сверх-короткая подпись для chip: «5m / 2h / 3d / now».
export function shortAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "—";
  const sec = Math.floor(ageMs / 1000);
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// Точное время для tooltip: «Обновлено сегодня в 14:32» / «вчера 09:15» / «28 апр 14:32».
export function tooltipFor(updatedAt) {
  if (!updatedAt) return "Не обновлялось";
  const d = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  if (!Number.isFinite(d.getTime())) return "Не обновлялось";
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const dateStr = d.toISOString().slice(0, 10);
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (dateStr === today) return `Обновлено сегодня в ${time}`;
  if (dateStr === yesterday) return `Обновлено вчера в ${time}`;
  const dateNice = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  return `Обновлено ${dateNice} в ${time}`;
}

const TONE_BG = {
  fresh:    "bg-success-soft0",
  stale:    "bg-warning-soft0",
  outdated: "bg-danger-soft0",
};

const TONE_TEXT = {
  fresh:    "text-success",
  stale:    "text-warning",
  outdated: "text-danger",
};

const TONE_RING = {
  fresh:    "ring-emerald-200",
  stale:    "ring-amber-200",
  outdated: "ring-rose-200",
};

export const STATE_LABELS = {
  fresh:    "Актуально",
  stale:    "Устаревает",
  outdated: "Устарело",
};

// Маленький цветной кружок + опциональный текст времени.
//   <FreshnessDot updatedAt={pair.updatedAt} />
//   <FreshnessDot updatedAt={pair.updatedAt} showLabel />
export function FreshnessDot({ updatedAt, showLabel = false, size = "sm" }) {
  const { state, label } = freshnessOf(updatedAt);
  const dotSize = size === "lg" ? "w-2.5 h-2.5" : size === "md" ? "w-2 h-2" : "w-1.5 h-1.5";
  const title = `${STATE_LABELS[state]} · ${label}`;
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <span
        className={`${dotSize} rounded-full ${TONE_BG[state]} ${state === "outdated" ? "animate-pulse" : ""}`}
      />
      {showLabel && (
        <span className={`text-[10px] font-bold tabular-nums ${TONE_TEXT[state]}`}>
          {label}
        </span>
      )}
    </span>
  );
}

// Компактный chip с короткой меткой времени и цветом по состоянию.
// Идеально для inline-отображения рядом с курсами.
//   <FreshnessChip updatedAt={pair.updatedAt} />  → [2h]
//
// Цвета фона:
//   fresh    — emerald-50 / emerald-700
//   stale    — amber-50 / amber-700
//   outdated — rose-50 / rose-700
//
// Tooltip с точным временем «Обновлено сегодня в 14:32».
export function FreshnessChip({ updatedAt }) {
  const { state, ageMs } = freshnessOf(updatedAt);
  const cls = {
    fresh:    "bg-success-soft text-success ring-emerald-200",
    stale:    "bg-warning-soft text-warning ring-amber-200",
    outdated: "bg-danger-soft text-danger ring-rose-200",
  }[state];
  return (
    <span
      className={`inline-flex items-center px-1.5 py-px rounded text-[9px] font-bold tabular-nums ring-1 ${cls}`}
      title={tooltipFor(updatedAt)}
    >
      {shortAge(ageMs)}
    </span>
  );
}

// Pill-вариант с иконкой и текстом — для banner'а / заголовков.
export function FreshnessPill({ updatedAt, compact = false }) {
  const { state, label } = freshnessOf(updatedAt);
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold ring-1 bg-white ${TONE_TEXT[state]} ${TONE_RING[state]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${TONE_BG[state]}`} />
      {compact ? label : `${STATE_LABELS[state]} · ${label}`}
    </span>
  );
}

// Подсчитать сколько устаревших среди пар.
//   countOutdated(pairs, (p) => p.updatedAt) → { fresh, stale, outdated, total }
export function countFreshness(items, getUpdatedAt) {
  const counts = { fresh: 0, stale: 0, outdated: 0, total: items.length };
  items.forEach((it) => {
    const { state } = freshnessOf(getUpdatedAt(it));
    counts[state] = (counts[state] || 0) + 1;
  });
  return counts;
}
