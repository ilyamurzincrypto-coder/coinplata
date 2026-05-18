// src/components/RatesSidebar.jsx
// Виджет «Курсы» — левая колонка главной (Касса). Шаг 4.12 финал.
//
// КРИТИЧНО: виджет НЕ оборачивается в bg-surface карточку. Header,
// office switcher, rate-карточки, foot — всё рендерится прямо на bg-bg
// (#FAFAF7). Это убирает «белый хвост» когда правая колонка длиннее.
// Сетка-контейнер в CashierPage должна иметь items-start.
//
// Структура и состав данных не менялись: пары, обе стороны курса,
// age-индикатор, OFC-маркер, office switcher, favorites, edit, expand.
// Логика favorites/office override/search/freshness — anchor, не тронута.

import React, { useState, useEffect, useMemo } from "react";
import { TrendingUp, ArrowRight, Star, Pencil, Search, X, ChevronDown, ChevronUp } from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { useOffices } from "../store/offices.jsx";
import { useAuth } from "../store/auth.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { freshnessOf, shortAge, tooltipFor } from "../utils/rateFreshness.jsx";
import { useNow } from "../hooks/useNow.js";
import CurrencyIcon from "./ui/CurrencyIcon.jsx";

const DASHBOARD_FAV_KEY = "dashboardFavorites";
const EXPAND_STORAGE_KEY = "coinplata:rates-expanded";

const FALLBACK_PAIRS = [
  ["USDT", "USD"],
  ["USDT", "TRY"],
  ["USDT", "EUR"],
  ["USD", "TRY"],
  ["USD", "EUR"],
  ["TRY", "EUR"],
];

const GLOBAL_TAB = "__global__";
const COMPACT_LIMIT = 5;

function formatRate(value) {
  if (!value && value !== 0) return "—";
  if (value >= 10) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function timeAgoShort(date, nowMs = Date.now()) {
  if (!date) return "—";
  const diff = Math.floor((nowMs - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function shortOfficeName(name) {
  if (!name) return "Office";
  const firstWord = String(name).trim().split(/\s+/)[0];
  return firstWord.length > 10 ? firstWord.slice(0, 10) : firstWord;
}

// Age-pill: семантические цвета по ТЗ 4.12.
function AgePill({ updatedAt }) {
  const { ageMs } = freshnessOf(updatedAt);
  if (!Number.isFinite(ageMs)) {
    return (
      <span className="inline-flex items-center h-4 px-1.5 rounded-[3px] font-mono text-[9px] font-bold bg-surface-sunk text-muted">
        —
      </span>
    );
  }
  const days = ageMs / (24 * 60 * 60 * 1000);
  const tone = days <= 1
    ? "bg-success-soft text-success"
    : days <= 3
      ? "bg-warning-soft text-warning"
      : "bg-danger-soft text-danger";
  const label = days < 1
    ? `${Math.max(0, Math.round(days * 24))}h`
    : `${Math.round(days)}d`;
  return (
    <span
      className={`inline-flex items-center h-4 px-1.5 rounded-[3px] font-mono text-[9px] font-bold ${tone}`}
      title={tooltipFor(updatedAt)}
    >
      {label}
    </span>
  );
}

// QuoteSide — одна из двух колонок quotes-блока: [mini⚪ → mini⚪] + value.
function QuoteSide({ from, to, value, ringColorClass }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="inline-flex items-center gap-0.5 shrink-0">
        <CurrencyIcon ccy={from} pair={to} size="xs" ringColorClass={ringColorClass} />
      </span>
      <span className="font-mono tabular text-[13px] font-bold text-ink tracking-tight shrink-0">
        {value}
      </span>
    </div>
  );
}

// Inline-разделитель групп («★ Избранные · 5» + hairline)
function GroupSeparator({ label }) {
  return (
    <div className="px-3 pt-3 pb-1.5 flex items-center gap-2">
      <span className="text-[10px] font-bold tracking-wider text-muted-soft uppercase whitespace-nowrap shrink-0">
        {label}
      </span>
      <span className="flex-1 h-px bg-border-soft" />
    </div>
  );
}

export default function RatesSidebar({ currentOffice, onOpenRates, onExpandedChange }) {
  const { getRate: getRateRaw, lastUpdated, getOfficeOverride, allTradePairs, pairs, channels } = useRates();

  const pairUpdatedAt = React.useCallback((a, b) => {
    if (!Array.isArray(pairs) || !Array.isArray(channels)) return null;
    const matches = pairs.filter((p) => {
      const fromCh = channels.find((c) => c.id === p.fromChannelId);
      const toCh = channels.find((c) => c.id === p.toChannelId);
      const fromCur = fromCh?.currencyCode;
      const toCur = toCh?.currencyCode;
      return p.isDefault && (
        (fromCur === a && toCur === b) || (fromCur === b && toCur === a)
      );
    });
    if (matches.length === 0) return null;
    let latest = null;
    matches.forEach((m) => {
      if (!m.updatedAt) return;
      const t = new Date(m.updatedAt).getTime();
      if (Number.isFinite(t) && (!latest || t > latest)) latest = t;
    });
    return latest ? new Date(latest) : null;
  }, [pairs, channels]);

  const tradePairs = allTradePairs && allTradePairs.length > 0 ? allTradePairs : FALLBACK_PAIRS;
  const { activeOffices } = useOffices();
  const { currentUser, updatePreferences } = useAuth();
  const { t } = useTranslation();
  const nowMs = useNow(30_000);

  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(EXPAND_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(EXPAND_STORAGE_KEY, String(expanded));
    } catch {}
  }, [expanded]);

  const [query, setQuery] = useState("");

  const dashboardFavorites = useMemo(() => {
    const raw = currentUser?.preferences?.[DASHBOARD_FAV_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string"
    );
  }, [currentUser]);
  const favKeys = useMemo(() => {
    const set = new Set();
    dashboardFavorites.forEach(([a, b]) => set.add([a, b].sort().join("_")));
    return set;
  }, [dashboardFavorites]);
  const isFavorite = React.useCallback(
    (a, b) => favKeys.has([a, b].sort().join("_")),
    [favKeys]
  );
  const toggleFavorite = React.useCallback(
    async (a, b, e) => {
      if (e) { e.stopPropagation(); e.preventDefault(); }
      if (!updatePreferences) return;
      const key = [a, b].sort().join("_");
      const exists = favKeys.has(key);
      const next = exists
        ? dashboardFavorites.filter((p) => [p[0], p[1]].sort().join("_") !== key)
        : [...dashboardFavorites, [a, b]];
      await updatePreferences({ [DASHBOARD_FAV_KEY]: next });
    },
    [favKeys, dashboardFavorites, updatePreferences]
  );

  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  const [selectedTab, setSelectedTab] = useState(currentOffice || GLOBAL_TAB);
  useEffect(() => {
    if (currentOffice) setSelectedTab(currentOffice);
  }, [currentOffice]);

  const selectedIsOffice = selectedTab !== GLOBAL_TAB;
  const selectedOfficeId = selectedIsOffice ? selectedTab : null;

  const getRateForTab = React.useCallback(
    (from, to) => getRateRaw(from, to, selectedOfficeId),
    [getRateRaw, selectedOfficeId]
  );

  const hasOverride = React.useCallback(
    (from, to) => {
      if (!selectedOfficeId) return false;
      const ovr = getOfficeOverride?.(selectedOfficeId, from, to);
      const global = getRateRaw(from, to, null);
      return (
        !!ovr &&
        Number.isFinite(ovr.rate) &&
        Number.isFinite(global) &&
        Math.abs(ovr.rate - global) > 1e-9
      );
    },
    [selectedOfficeId, getOfficeOverride, getRateRaw]
  );

  const { favoritesList, othersList, totalCount } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filter = (pair) => {
      if (!q) return true;
      const [a, b] = pair;
      return (
        a.toLowerCase().includes(q) ||
        b.toLowerCase().includes(q) ||
        `${a} ${b}`.toLowerCase().includes(q) ||
        `${b} ${a}`.toLowerCase().includes(q)
      );
    };
    const favs = [];
    const rest = [];
    tradePairs.forEach((p) => {
      if (!filter(p)) return;
      if (isFavorite(p[0], p[1])) favs.push(p);
      else rest.push(p);
    });
    return { favoritesList: favs, othersList: rest, totalCount: tradePairs.length };
  }, [tradePairs, query, isFavorite]);

  // Compact: 5 favorites; если favorites нет — first 5 обычных.
  const collapsedList = useMemo(() => {
    if (favoritesList.length > 0) return favoritesList.slice(0, COMPACT_LIMIT);
    return othersList.slice(0, COMPACT_LIMIT);
  }, [favoritesList, othersList]);

  // Foot-кнопка показывается только если есть скрытые пары.
  const hiddenCount = Math.max(
    0,
    (favoritesList.length > COMPACT_LIMIT ? favoritesList.length - COMPACT_LIMIT : 0) + othersList.length
  );
  const showFootButton = expanded || hiddenCount > 0;

  const renderRateCard = ([a, b]) => {
    const fav = isFavorite(a, b);
    const rateAB = getRateForTab(a, b);
    const rateBA = getRateForTab(b, a);
    const pairHasOverride = hasOverride(a, b) || hasOverride(b, a);
    const updated = pairUpdatedAt(a, b);

    // Цвета фона и обводки иконок — рифмуются между картой и кругами.
    const cardBg = fav
      ? "bg-fav-bg hover:bg-fav-bg-hover"
      : "bg-transparent hover:bg-surface-soft";
    const ringColorClass = fav
      ? "border-fav-bg group-hover:border-fav-bg-hover"
      : "border-bg group-hover:border-surface-soft";
    const dividerBg = fav ? "bg-fav-divider" : "bg-border";

    return (
      <div
        key={`${a}-${b}`}
        className={`group rounded-[9px] px-3 py-2.5 transition-colors duration-150 ease-apple ${cardBg}`}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-1.5">
          <button
            type="button"
            onClick={(e) => toggleFavorite(a, b, e)}
            className={`shrink-0 transition-colors ${
              fav ? "text-[#FBBF24] hover:text-amber-500" : "text-border hover:text-amber-400"
            }`}
            title={fav ? "Убрать из избранного" : "В избранное"}
            aria-label={fav ? "Убрать из избранного" : "В избранное"}
          >
            <Star className="w-3 h-3" strokeWidth={2} fill={fav ? "currentColor" : "none"} />
          </button>
          <CurrencyIcon ccy={a} pair={b} size="sm" ringColorClass={ringColorClass} />
          <span className="font-mono font-bold text-[11px] text-ink tracking-tight">
            {a}<span className="text-muted-soft mx-0.5">·</span>{b}
          </span>
          <span className="flex-1" />
          {pairHasOverride && (
            <span
              className="inline-flex items-center h-4 px-1.5 rounded-[3px] font-mono text-[9px] font-bold bg-surface-sunk text-muted tracking-wide"
              title="Office override активен"
            >
              OFC
            </span>
          )}
          <AgePill updatedAt={updated} />
        </div>

        {/* Quotes — две колонки через 1px vertical divider */}
        <div className="pl-4 grid grid-cols-[1fr_1px_1fr] gap-2 items-center">
          <QuoteSide from={a} to={b} value={formatRate(rateAB)} ringColorClass={ringColorClass} />
          <div className={`self-stretch min-h-[20px] ${dividerBg}`} />
          <QuoteSide from={b} to={a} value={formatRate(rateBA)} ringColorClass={ringColorClass} />
        </div>
      </div>
    );
  };

  return (
    // Карточка с белым фоном, p-1.5 — компактный внешний padding.
    // Растягивания по высоте не будет: на CashierPage grid стоит items-start.
    <aside className="bg-surface rounded-card p-1.5 flex flex-col">
      {/* Header виджета: 📈 КУРСЫ + live-dot + relative time + Изм. */}
      <header className="px-2.5 pt-2.5 pb-1 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <TrendingUp className="w-3 h-3 text-accent shrink-0" strokeWidth={2.5} />
            <h2 className="text-caption text-ink font-semibold uppercase tracking-wide truncate">
              {t("rates") || "Курсы"}
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1 text-[11px] text-muted font-mono tabular">
              <span
                className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot"
                style={{ boxShadow: "0 0 6px rgba(16,185,129,0.6)" }}
                aria-hidden
              />
              {timeAgoShort(lastUpdated, nowMs)}
            </span>
            {onOpenRates && (
              <button
                type="button"
                onClick={onOpenRates}
                className="inline-flex items-center gap-1 h-6 px-2 rounded-[7px] bg-surface border border-border text-ink text-[11px] font-medium hover:bg-surface-soft transition-colors"
                title={t("edit_rates") || "Редактировать курсы"}
              >
                <Pencil className="w-2.5 h-2.5 text-muted" strokeWidth={2.2} />
                <span>Изм.</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Office switcher — pill style на DS-токенах, h-6 */}
      <div className="mx-2 my-1.5 inline-flex gap-0.5 p-0.5 bg-surface-sunk rounded-pill overflow-x-auto shrink-0">
        <button
          type="button"
          onClick={() => setSelectedTab(GLOBAL_TAB)}
          className={`h-6 px-2 rounded-pill text-[10px] font-medium font-mono tracking-wider transition-all duration-150 ease-apple whitespace-nowrap shrink-0 ${
            selectedTab === GLOBAL_TAB
              ? "bg-surface text-ink shadow-seg"
              : "text-muted hover:text-ink"
          }`}
          title="Global rates"
        >
          Global
        </button>
        {(activeOffices || []).map((off) => {
          const isSel = selectedTab === off.id;
          return (
            <button
              key={off.id}
              type="button"
              onClick={() => setSelectedTab(off.id)}
              className={`h-6 px-2 rounded-pill text-[10px] font-medium tracking-wide transition-all duration-150 ease-apple whitespace-nowrap shrink-0 ${
                isSel
                  ? "bg-surface text-ink shadow-seg"
                  : "text-muted hover:text-ink"
              }`}
              title={off.name || "Office"}
            >
              {shortOfficeName(off.name)}
            </button>
          );
        })}
      </div>

      {/* Search — только в expanded mode */}
      {expanded && (
        <div className="px-2 pb-1 shrink-0">
          <div className="flex items-center gap-1.5 bg-surface-sunk rounded-input px-2 py-1.5 ring-1 ring-inset ring-transparent focus-within:ring-accent focus-within:bg-surface transition-all">
            <Search className="w-3 h-3 text-muted shrink-0" strokeWidth={2} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="USD, TRY, EUR…"
              className="flex-1 min-w-0 bg-transparent outline-none text-caption text-ink placeholder:text-muted-soft"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="p-0.5 rounded hover:bg-surface-soft text-muted transition-colors shrink-0"
                title="Очистить"
              >
                <X className="w-3 h-3" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Список пар */}
      <div className={`px-1.5 py-1 space-y-0.5 ${expanded ? "max-h-[70vh] overflow-y-auto" : ""}`}>
        {expanded ? (
          <>
            {favoritesList.length > 0 && (
              <>
                <GroupSeparator label={`★ Избранные · ${favoritesList.length}`} />
                {favoritesList.map(renderRateCard)}
              </>
            )}
            {othersList.length > 0 && (
              <>
                <GroupSeparator label={`Все пары · ${othersList.length}`} />
                {othersList.map(renderRateCard)}
              </>
            )}
            {query && favoritesList.length === 0 && othersList.length === 0 && (
              <div className="text-center py-6 text-caption text-muted">
                ничего не найдено
              </div>
            )}
          </>
        ) : (
          collapsedList.map(renderRateCard)
        )}
      </div>

      {/* Footer — collapse/expand. Не показываем если нечего скрывать. */}
      {showFootButton && (
        <div className="px-2 py-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-muted hover:text-ink hover:bg-surface-soft text-[11px] font-semibold transition-colors"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-3 h-3" strokeWidth={2.2} />
                Свернуть
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" strokeWidth={2.2} />
                Показать все ({totalCount})
              </>
            )}
          </button>
        </div>
      )}
    </aside>
  );
}
