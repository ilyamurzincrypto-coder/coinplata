// src/components/RatesSidebar.jsx
// Компактный вертикальный список торговых пар для CREATE-режима CashierPage.
// Каждый блок = одна пара с двумя направлениями (a→b и b→a), как в RatesBar.
// Кассир видит и покупку и продажу не переключая внимание.
//
// Office tabs сверху — переключение между Global / каждым активным офисом.
// Дефолт = currentOffice из header. rates office-aware: если у офиса есть
// override для пары — показываем его курс, иначе global fallback.
// Бейдж OFC на паре = override активен (курс отличается от global).

import React, { useState, useEffect, useMemo } from "react";
import { TrendingUp, ArrowRight, Zap, Settings2, Search, X, ChevronDown, ChevronUp } from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { useOffices } from "../store/offices.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { getTradingRates } from "../utils/tradingRates.js";
import DailyRatesModal from "./DailyRatesModal.jsx";

// Фолбэк на случай если allTradePairs ещё не гидрировался (mid-load из DB).
// После гидрации берём реальный динамический список из useRates.allTradePairs.
// Порядок: USDT первая (мост), затем USD, TRY, EUR — основные рабочие пары.
const FALLBACK_PAIRS = [
  ["USDT", "USD"],
  ["USDT", "TRY"],
  ["USDT", "EUR"],
  ["USD", "TRY"],
  ["USD", "EUR"],
  ["TRY", "EUR"],
];

const GLOBAL_TAB = "__global__";

function formatRate(value) {
  if (!value && value !== 0) return "—";
  if (value >= 10) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function timeAgo(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

// Короткое имя офиса для узкого таба. "Mraml Main office" → "Mraml"
function shortOfficeName(name) {
  if (!name) return "Office";
  const firstWord = String(name).trim().split(/\s+/)[0];
  return firstWord.length > 10 ? firstWord.slice(0, 10) : firstWord;
}

// Сколько пар показывать в compact mode — по умолчанию топ-4 (USDT/USD,
// USDT/TRY, USDT/EUR, USD/TRY при текущем приоритете). Sidebar короткий,
// в обычной высоте main column (CTA + Balances) — между Balances и
// Transactions нет вертикального gap'а.
const COMPACT_LIMIT = 4;

export default function RatesSidebar({ currentOffice, onOpenRates, onExpandedChange }) {
  const { getRate: getRateRaw, lastUpdated, getOfficeOverride, allTradePairs } = useRates();
  const tradePairs = allTradePairs && allTradePairs.length > 0 ? allTradePairs : FALLBACK_PAIRS;
  const { activeOffices } = useOffices();
  const { t } = useTranslation();
  const [quickOpen, setQuickOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");

  // Сообщаем родителю что expanded — он подстраивает grid columns
  // (sidebar шире → main колонка уже).
  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  // Выбранная вкладка: "__global__" или officeId. Следуем за currentOffice
  // (когда кассир меняет офис в header — sidebar тоже переключается).
  const [selectedTab, setSelectedTab] = useState(currentOffice || GLOBAL_TAB);
  useEffect(() => {
    if (currentOffice) setSelectedTab(currentOffice);
  }, [currentOffice]);

  // Если выбранный офис стал неактивен — фолбэк на global
  const selectedIsOffice = selectedTab !== GLOBAL_TAB;
  const selectedOfficeId = selectedIsOffice ? selectedTab : null;

  // Office-aware getRate: если выбран офис, применяем его override. Global tab
  // передаёт null → чистый global rate.
  const getRateForTab = React.useCallback(
    (from, to) => getRateRaw(from, to, selectedOfficeId),
    [getRateRaw, selectedOfficeId]
  );

  // Проверка — есть ли override у текущего выбранного офиса для этой пары
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

  // Visible pairs — фильтр по поисковому запросу + лимит compact mode.
  // Поиск по обеим валютам пары (USDT/EUR matches "us", "eur", "usdt eur").
  const visiblePairs = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = tradePairs;
    if (q) {
      list = list.filter(([a, b]) => {
        const ab = `${a} ${b}`.toLowerCase();
        const ba = `${b} ${a}`.toLowerCase();
        return (
          a.toLowerCase().includes(q) ||
          b.toLowerCase().includes(q) ||
          ab.includes(q) ||
          ba.includes(q)
        );
      });
    }
    if (!expanded && !q) {
      // Compact mode без поиска — только базовые пары (top N по приоритету)
      list = list.slice(0, COMPACT_LIMIT);
    }
    return list;
  }, [tradePairs, query, expanded]);

  const totalCount = tradePairs.length;
  const showingCount = visiblePairs.length;
  const hasHidden = !expanded && !query && totalCount > COMPACT_LIMIT;

  return (
    <aside className="bg-white rounded-[16px] border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_12px_rgba(15,23,42,0.06)] h-full flex flex-col">
      <header className="px-2.5 py-2 border-b border-slate-100 shrink-0">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <TrendingUp className="w-3 h-3 text-emerald-600 shrink-0" />
            <h2 className="text-[11px] font-bold text-slate-900 tracking-tight uppercase truncate">
              {t("rates") || "Rates"}
            </h2>
          </div>
          {onOpenRates && (
            <div className="flex gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setQuickOpen(true)}
                className="inline-flex items-center justify-center w-6 h-6 rounded-[6px] bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
                title="Быстрое обновление курсов"
              >
                <Zap className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={onOpenRates}
                className="inline-flex items-center justify-center w-6 h-6 rounded-[6px] bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 transition-colors"
                title="Полная страница курсов"
              >
                <Settings2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
        <span className="inline-flex items-center gap-1 text-[9px] text-slate-400 mt-0.5">
          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
          {timeAgo(lastUpdated)} ago
        </span>
      </header>
      <DailyRatesModal open={quickOpen} onClose={() => setQuickOpen(false)} />

      {/* Office tabs: Global + каждый активный офис. Выбор влияет на курсы
          ниже. По дефолту подсвечен текущий офис (из header).
          flex-wrap — чтобы длинные имена / много офисов не ломали layout. */}
      <div className="px-2 pt-2 flex flex-wrap gap-1 border-b border-slate-100 pb-2 shrink-0">
        <button
          type="button"
          onClick={() => setSelectedTab(GLOBAL_TAB)}
          className={`px-2 py-1 text-[10px] font-bold rounded-[6px] tracking-wider uppercase transition-colors ${
            selectedTab === GLOBAL_TAB
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
          title="Global rates — без учёта per-office override"
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
              className={`px-2 py-1 text-[10px] font-bold rounded-[6px] tracking-wider transition-colors ${
                isSel
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
              title={off.name || "Office"}
            >
              {shortOfficeName(off.name)}
            </button>
          );
        })}
      </div>

      {/* Search — только в expanded mode. В compact показываем top 4 пар,
          поиск не нужен — экономим высоту sidebar чтобы не растягивать
          row1 (transactions прижмутся к Balances без gap). */}
      {expanded && (
        <div className="px-2 pt-2 pb-1 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-[8px] px-2 py-1">
            <Search className="w-3 h-3 text-slate-400 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="USD, TRY, EUR…"
              className="flex-1 min-w-0 bg-transparent outline-none text-[11px] text-slate-900 placeholder:text-slate-400"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="p-0.5 rounded hover:bg-slate-200 text-slate-500 transition-colors shrink-0"
                title="Очистить"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      <div
        className={`p-1 space-y-0.5 ${
          expanded ? "max-h-[70vh] overflow-y-auto" : "flex-1"
        }`}
      >
        {visiblePairs.map(([a, b]) => {
          const { forward: sell, backward: buy } = getTradingRates({
            getRate: getRateForTab,
            base: a,
            quote: b,
          });
          const pairHasOverride = hasOverride(a, b) || hasOverride(b, a);
          return (
            <div
              key={`${a}-${b}`}
              className={`px-2 py-1 rounded-[8px] transition-colors ${
                pairHasOverride ? "bg-indigo-50/60 ring-1 ring-indigo-100" : "bg-slate-50"
              }`}
            >
              {pairHasOverride && (
                <span
                  className="float-right px-1 py-px rounded text-[8px] font-bold bg-indigo-100 text-indigo-700 tracking-wider"
                  title="Office override активен"
                >
                  OFC
                </span>
              )}
              <div className="flex items-baseline justify-between gap-1 leading-tight">
                <span className="text-[10px] font-semibold text-slate-500 inline-flex items-center">
                  {a}<ArrowRight className="w-2 h-2 mx-0.5" />{b}
                </span>
                <span className="text-[12px] font-bold tabular-nums text-slate-900">
                  {formatRate(sell)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-1 leading-tight">
                <span className="text-[10px] font-semibold text-slate-500 inline-flex items-center">
                  {b}<ArrowRight className="w-2 h-2 mx-0.5" />{a}
                </span>
                <span className="text-[11px] font-bold tabular-nums text-slate-600">
                  {formatRate(buy)}
                </span>
              </div>
            </div>
          );
        })}
        {/* Empty state при поиске */}
        {query && visiblePairs.length === 0 && (
          <div className="text-center py-6 text-[11px] text-slate-400">
            ничего не найдено
          </div>
        )}
      </div>

      {/* Toggle "Show all / Compact" — внизу списка. В compact mode также
          сообщает сколько ещё пар скрыто. Когда expanded — sidebar
          расширяется (через onExpandedChange), главная колонка сужается. */}
      {(hasHidden || expanded) && !query && (
        <div className="border-t border-slate-100 px-2 py-2 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-[8px] text-[11px] font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-3 h-3" />
                Свернуть
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" />
                Показать все ({totalCount - showingCount})
              </>
            )}
          </button>
        </div>
      )}
    </aside>
  );
}
