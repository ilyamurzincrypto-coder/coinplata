// src/components/RatesSidebar.jsx
// Виджет «Курсы» — левая колонка главной (Касса).
//
// Структура и состав данных не менялись (Шаг 4.12):
//   • Office tabs (Global + офисы) — anchor SegmentedControl-стиль, токены DS
//   • Карточки пар — header (★ + парные иконки 18px + USDT·USD mono + OFC + age-pill)
//     + quotes (две колонки направлений с mini-coin → mini-coin + value)
//   • Favorited → тёплый фон #FFFCEF (тёплый, не конфликтует с emerald CTA)
//   • Expanded state — все пары + group separators («★ Избранные», «Все пары»),
//     state в localStorage `coinplata:rates-expanded`
//   • Edit-кнопка → «Изм.» с pencil 10px
//   • Поиск только в expanded mode
//
// Office switcher и логика favorites/expanded/search/freshness — anchor,
// бизнес-логика не тронута.

import React, { useState, useEffect, useMemo, useRef } from "react";
import { ArrowRight, Star, Pencil, Search, X, ChevronDown, ChevronUp } from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { useOffices } from "../store/offices.jsx";
import { useAuth } from "../store/auth.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { freshnessOf, shortAge, tooltipFor } from "../utils/rateFreshness.jsx";
import { useNow } from "../hooks/useNow.js";
import CurrencyIcon from "./ui/CurrencyIcon.jsx";

// Per-user избранные пары для дашборда — отдельный ключ от editor's
// favoriteRatePairs (RatesBar). Хранится в users.preferences.dashboardFavorites
// как массив пар [["A","B"], ...].
const DASHBOARD_FAV_KEY = "dashboardFavorites";

// Expand/collapse state per-browser (localStorage по ТЗ Шаг 4.12).
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

// Минимум показываемых пар в свёрнутом state (ТЗ — 5).
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
//   ≤1д — success (fresh)
//   1-3д — warning (mid)
//   >3д — danger (stale)
// Если данных нет — нейтральный muted-pill.
function AgePill({ updatedAt }) {
  const { ageMs } = freshnessOf(updatedAt);
  if (!Number.isFinite(ageMs)) {
    return (
      <span className="inline-flex items-center h-4 px-1.5 rounded font-mono text-[9px] font-bold bg-surface-soft text-muted">
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
  return (
    <span
      className={`inline-flex items-center h-4 px-1.5 rounded font-mono text-[9px] font-bold ${tone}`}
      title={tooltipFor(updatedAt)}
    >
      {shortAge(ageMs)}
    </span>
  );
}

// QuoteSide — одна из двух колонок quotes-блока.
function QuoteSide({ from, to, value, ringColorClass }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-0.5 shrink-0">
        <CurrencyIcon ccy={from} pair={to} size="xs" ringColorClass={ringColorClass} />
      </span>
      <span className="font-mono tabular text-[14px] font-bold text-ink shrink-0">
        {value}
      </span>
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

  // Expand/collapse — localStorage по ТЗ 4.12 (был sessionStorage в legacy).
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

  // --- Dashboard favorites (per-user, server-persisted) ---
  const dashboardFavorites = useMemo(() => {
    const raw = currentUser?.preferences?.[DASHBOARD_FAV_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string"
    );
  }, [currentUser]);
  const favKeys = useMemo(() => {
    const set = new Set();
    dashboardFavorites.forEach(([a, b]) => {
      set.add([a, b].sort().join("_"));
    });
    return set;
  }, [dashboardFavorites]);
  const isFavorite = React.useCallback(
    (a, b) => favKeys.has([a, b].sort().join("_")),
    [favKeys]
  );
  const toggleFavorite = React.useCallback(
    async (a, b, e) => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
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

  const pairsRef = useRef(null);

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

  // Список с favorites сверху + поиск.
  // В свёрнутом state — только 5 favorites (если их меньше — все имеющиеся).
  // В expanded — favorites + others, разделённые group-separator'ами.
  const { favoritesList, othersList, totalCount } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filter = (pair) => {
      if (!q) return true;
      const [a, b] = pair;
      const ab = `${a} ${b}`.toLowerCase();
      const ba = `${b} ${a}`.toLowerCase();
      return (
        a.toLowerCase().includes(q) ||
        b.toLowerCase().includes(q) ||
        ab.includes(q) ||
        ba.includes(q)
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

  // Свёрнутое: только 5 favorites (или меньше если их меньше).
  // Если favorites нет совсем — показываем первые 5 «обычных» (хорошее UX).
  const collapsedFavorites = useMemo(() => {
    if (favoritesList.length > 0) return favoritesList.slice(0, COMPACT_LIMIT);
    return othersList.slice(0, COMPACT_LIMIT);
  }, [favoritesList, othersList]);

  const hasHidden = !expanded && !query && (totalCount > collapsedFavorites.length);

  // Renderер одной rate-карточки.
  const renderRateCard = ([a, b], idx) => {
    const fav = isFavorite(a, b);
    const rateAB = getRateForTab(a, b);
    const rateBA = getRateForTab(b, a);
    const pairHasOverride = hasOverride(a, b) || hasOverride(b, a);
    const updated = pairUpdatedAt(a, b);

    const cardBg = fav
      ? "bg-[#FFFCEF] hover:bg-[#FFF8DE]"
      : "bg-surface hover:bg-surface-soft";
    const ringColorClass = fav
      ? "border-[#FFFCEF] group-hover:border-[#FFF8DE]"
      : "border-surface group-hover:border-surface-soft";
    const dividerBg = fav ? "bg-[#F5EBC8]" : "bg-border-soft";

    return (
      <div
        key={`${a}-${b}`}
        className={`group rounded-[10px] px-3 py-2.5 transition-colors duration-150 ease-apple ${cardBg}`}
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
              className="inline-flex items-center h-4 px-1.5 rounded font-mono text-[9px] font-bold bg-surface-soft text-muted tracking-wide"
              title="Office override активен"
            >
              OFC
            </span>
          )}
          <AgePill updatedAt={updated} />
        </div>

        {/* Quotes — две колонки */}
        <div className="pl-5 grid grid-cols-[1fr_1px_1fr] gap-3 items-center">
          <QuoteSide from={a} to={b} value={formatRate(rateAB)} ringColorClass={ringColorClass} />
          <div className={`self-stretch min-h-[22px] ${dividerBg}`} />
          <QuoteSide from={b} to={a} value={formatRate(rateBA)} ringColorClass={ringColorClass} />
        </div>
      </div>
    );
  };

  return (
    <aside className="bg-surface rounded-card-lg shadow-card-hover h-full flex flex-col overflow-hidden">
      {/* Header: «Курсы» + live-dot + relative time + кнопка Изм. */}
      <header className="px-3 pt-3 pb-1 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-h2 text-ink truncate">{t("rates") || "Курсы"}</h2>
            <span className="inline-flex items-center gap-1.5 text-caption text-muted font-mono tabular">
              <span className="w-1.5 h-1.5 rounded-full bg-success glow-dot animate-pulse" />
              {timeAgoShort(lastUpdated, nowMs)}
            </span>
          </div>
          {onOpenRates && (
            <button
              type="button"
              onClick={onOpenRates}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-button bg-surface border border-border text-ink text-caption font-medium hover:bg-surface-soft transition-colors shrink-0"
              title={t("edit_rates") || "Редактировать курсы"}
            >
              <Pencil className="w-3 h-3 text-muted" strokeWidth={2.2} />
              <span>Изм.</span>
            </button>
          )}
        </div>
      </header>

      {/* Office switcher — anchor SegmentedControl-стиль на токенах DS. */}
      <div className="mx-2 my-2 inline-flex gap-0.5 p-0.5 bg-surface-sunk rounded-pill overflow-x-auto shrink-0">
        <button
          type="button"
          onClick={() => setSelectedTab(GLOBAL_TAB)}
          className={`h-7 px-2.5 rounded-pill text-[11px] font-semibold font-mono tracking-wider transition-all duration-150 ease-apple whitespace-nowrap shrink-0 ${
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
              className={`h-7 px-2.5 rounded-pill text-[11px] font-semibold tracking-wide transition-all duration-150 ease-apple whitespace-nowrap shrink-0 ${
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

      {/* Search — только в expanded mode. */}
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
      <div
        ref={pairsRef}
        className={`p-1.5 space-y-1 ${
          expanded ? "max-h-[70vh] overflow-y-auto" : "flex-1 overflow-hidden"
        }`}
      >
        {expanded ? (
          <>
            {/* Группа: ★ Избранные */}
            {favoritesList.length > 0 && (
              <>
                <GroupSeparator label={`★ Избранные · ${favoritesList.length}`} />
                {favoritesList.map(renderRateCard)}
              </>
            )}
            {/* Группа: Все пары */}
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
          /* Compact: 5 favorites (или first 5 если favorites нет) — без separator'ов */
          collapsedFavorites.map(renderRateCard)
        )}
      </div>

      {/* Footer toggle */}
      {tradePairs.length > 0 && (
        <div className="border-t border-border-soft px-3 py-2 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full inline-flex items-center justify-center gap-1.5 h-7 px-2 rounded-button text-caption font-semibold text-ink-soft hover:text-ink hover:bg-surface-soft transition-colors"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-3 h-3" strokeWidth={2.2} />
                Свернуть
              </>
            ) : hasHidden ? (
              <>
                <ChevronDown className="w-3 h-3" strokeWidth={2.2} />
                Показать все ({totalCount})
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" strokeWidth={2.2} />
                Развернуть
              </>
            )}
          </button>
        </div>
      )}
    </aside>
  );
}

// GroupSeparator: «★ Избранные · N» / «Все пары · N» + hairline справа.
function GroupSeparator({ label }) {
  return (
    <div className="px-2 pt-3 pb-1 flex items-center gap-2">
      <span className="text-[10px] font-bold tracking-wider text-muted-soft uppercase whitespace-nowrap shrink-0">
        {label}
      </span>
      <span className="flex-1 border-t border-border-soft" />
    </div>
  );
}
