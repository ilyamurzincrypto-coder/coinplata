// src/components/RatesSidebar.jsx
// Виджет «Курсы» — левая колонка главной (Касса). Табличный вид через
// общий компонент RatesTable (см. components/rates/RatesTable.jsx).
//
// Карточка-обёртка (header + office switcher + search + foot expand/collapse)
// и логика favorites/fitCount/expand остаются здесь — RatesTable отвечает
// только за отрисовку строк.

import React, { useState, useEffect, useMemo, useRef } from "react";
import { TrendingUp, Pencil, Search, X, ChevronDown, ChevronUp } from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { useOffices } from "../store/offices.jsx";
import { useAuth } from "../store/auth.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { useNow } from "../hooks/useNow.js";
import RatesTable from "./rates/RatesTable.jsx";

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
const COMPACT_MIN = 5;
// Высота одной строки таблицы (px + padding + space-y). Используется
// ResizeObserver'ом для расчёта fitCount.
const ROW_HEIGHT = 34;

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

export default function RatesSidebar({ currentOffice, onOpenRates, onExpandedChange }) {
  const { getRate: getRateRaw, lastUpdated, getOfficeOverride, allTradePairs, pairs, channels } = useRates();

  const pairUpdatedAt = React.useCallback(
    (a, b) => {
      if (!Array.isArray(pairs) || !Array.isArray(channels)) return null;
      const matches = pairs.filter((p) => {
        const fromCh = channels.find((c) => c.id === p.fromChannelId);
        const toCh = channels.find((c) => c.id === p.toChannelId);
        const fromCur = fromCh?.currencyCode;
        const toCur = toCh?.currencyCode;
        return (
          p.isDefault &&
          ((fromCur === a && toCur === b) || (fromCur === b && toCur === a))
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
    },
    [pairs, channels]
  );

  const tradePairs =
    allTradePairs && allTradePairs.length > 0 ? allTradePairs : FALLBACK_PAIRS;
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
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        typeof p[0] === "string" &&
        typeof p[1] === "string"
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
    async (a, b) => {
      if (!updatePreferences) return;
      const key = [a, b].sort().join("_");
      const exists = favKeys.has(key);
      const next = exists
        ? dashboardFavorites.filter(
            (p) => [p[0], p[1]].sort().join("_") !== key
          )
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
    return {
      favoritesList: favs,
      othersList: rest,
      totalCount: tradePairs.length,
    };
  }, [tradePairs, query, isFavorite]);

  const pairsRef = useRef(null);
  const [fitCount, setFitCount] = useState(COMPACT_MIN);

  useEffect(() => {
    if (expanded || !pairsRef.current || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const el = pairsRef.current;
    const compute = () => {
      const h = el.clientHeight;
      if (h <= 0) return;
      const count = Math.max(COMPACT_MIN, Math.floor(h / ROW_HEIGHT));
      setFitCount((prev) => (prev === count ? prev : count));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded, tradePairs.length]);

  const collapsedList = useMemo(() => {
    if (favoritesList.length >= fitCount) return favoritesList.slice(0, fitCount);
    const fill = othersList.slice(0, fitCount - favoritesList.length);
    return [...favoritesList, ...fill];
  }, [favoritesList, othersList, fitCount]);

  const hiddenCount = Math.max(0, totalCount - collapsedList.length);
  const showFootButton = expanded || hiddenCount > 0;

  // Expanded mode: соединяем favorites + others в один список с разделителем
  // между группами через groupSeparators.
  const { expandedPairs, expandedSeparators } = useMemo(() => {
    const out = [];
    const seps = [];
    if (favoritesList.length > 0) {
      seps.push({
        beforeIndex: 0,
        label: "★ Избранные",
        count: favoritesList.length,
      });
      out.push(...favoritesList);
    }
    if (othersList.length > 0) {
      seps.push({
        beforeIndex: out.length,
        label: "Все пары",
        count: othersList.length,
      });
      out.push(...othersList);
    }
    return { expandedPairs: out, expandedSeparators: seps };
  }, [favoritesList, othersList]);

  return (
    <aside className="bg-surface rounded-card p-1.5 flex flex-col h-full">
      <header className="px-2 pt-2 pb-1.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <TrendingUp className="w-3 h-3 text-accent shrink-0" strokeWidth={2.5} />
            <h2 className="text-caption text-ink font-semibold uppercase tracking-wide truncate">
              {t("rates") || "Курсы"}
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1 text-tiny text-muted font-mono tabular">
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
                className="inline-flex items-center gap-1 h-6 px-2 rounded-[7px] bg-surface border border-border text-ink text-tiny font-medium hover:bg-surface-soft transition-colors"
                title={t("edit_rates") || "Редактировать курсы"}
              >
                <Pencil className="w-2.5 h-2.5 text-muted" strokeWidth={2.2} />
                <span>Изм.</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Office switcher */}
      <div className="mx-2 my-1.5 inline-flex gap-0.5 p-0.5 bg-surface-sunk rounded-pill overflow-x-auto shrink-0">
        <button
          type="button"
          onClick={() => setSelectedTab(GLOBAL_TAB)}
          className={`h-6 px-2 rounded-pill text-tiny font-medium font-mono tracking-wider transition-all duration-150 ease-apple whitespace-nowrap shrink-0 ${
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
              className={`h-6 px-2 rounded-pill text-tiny font-medium tracking-wide transition-all duration-150 ease-apple whitespace-nowrap shrink-0 ${
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

      {/* Search — только в expanded */}
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

      {/* Таблица курсов */}
      <div
        ref={pairsRef}
        className={`px-1 py-1 ${
          expanded ? "max-h-[70vh] overflow-y-auto" : "flex-1 overflow-hidden"
        }`}
      >
        {expanded ? (
          expandedPairs.length === 0 ? (
            <div className="text-center py-6 text-caption text-muted">
              ничего не найдено
            </div>
          ) : (
            <RatesTable
              mode="view"
              pairs={expandedPairs}
              favorites={favKeys}
              onToggleFavorite={toggleFavorite}
              getRate={getRateForTab}
              hasOverride={hasOverride}
              pairUpdatedAt={pairUpdatedAt}
              groupSeparators={expandedSeparators}
              showHeader={false}
            />
          )
        ) : (
          <RatesTable
            mode="view"
            pairs={collapsedList}
            favorites={favKeys}
            onToggleFavorite={toggleFavorite}
            getRate={getRateForTab}
            hasOverride={hasOverride}
            pairUpdatedAt={pairUpdatedAt}
            showHeader={false}
          />
        )}
      </div>

      {expanded && <div className="flex-1" />}

      {showFootButton && (
        <div className="px-2 py-2 mt-1 border-t border-border-soft flex items-center justify-center shrink-0">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-muted hover:text-ink hover:bg-surface-soft text-tiny font-semibold transition-colors"
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
