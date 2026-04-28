// src/components/RatesSidebar.jsx
// Компактный вертикальный список торговых пар для CREATE-режима CashierPage.
// Каждый блок = одна пара с двумя направлениями (a→b и b→a), как в RatesBar.
// Кассир видит и покупку и продажу не переключая внимание.
//
// Office tabs сверху — переключение между Global / каждым активным офисом.
// Дефолт = currentOffice из header. rates office-aware: если у офиса есть
// override для пары — показываем его курс, иначе global fallback.
// Бейдж OFC на паре = override активен (курс отличается от global).

import React, { useState, useEffect, useMemo, useRef } from "react";
import { TrendingUp, ArrowRight, Star, Settings2, Search, X, ChevronDown, ChevronUp } from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { useOffices } from "../store/offices.jsx";
import { useAuth } from "../store/auth.jsx";
import { useTranslation } from "../i18n/translations.jsx";

// Per-user избранные пары для дашборда — отдельный ключ от editor's
// favoriteRatePairs (RatesBar). Хранится в users.preferences.dashboardFavorites
// как массив пар [["A","B"], ...]. Если есть избранные — они всегда сверху
// списка, остальные пары следуют за ними.
const DASHBOARD_FAV_KEY = "dashboardFavorites";

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

// Минимум показываемых пар в compact (на случай если высоту не успели
// измерить). Реальное число вычисляется через ResizeObserver на
// pairs-container — столько пар сколько помещается в available
// height без скролла.
const COMPACT_MIN = 3;
// Approx высота одной pair-карточки в px (header + 2 строки sell/buy).
const PAIR_ROW_HEIGHT = 56;

export default function RatesSidebar({ currentOffice, onOpenRates, onExpandedChange }) {
  const { getRate: getRateRaw, lastUpdated, getOfficeOverride, allTradePairs } = useRates();
  const tradePairs = allTradePairs && allTradePairs.length > 0 ? allTradePairs : FALLBACK_PAIRS;
  const { activeOffices } = useOffices();
  const { currentUser, updatePreferences } = useAuth();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
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
      // Сохраняем ключ как ОТСОРТИРОВАННАЯ пара чтобы matched независимо
      // от direction (auto-flip для удобных чисел не должен ломать ⭐).
      const key = [a, b].sort().join("_");
      set.add(key);
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
  // Динамически вычисляем сколько пар умещается в available height
  // pairs-container в compact mode. ResizeObserver следит за изменениями.
  const [fitCount, setFitCount] = useState(COMPACT_MIN);
  const pairsRef = useRef(null);

  useEffect(() => {
    if (expanded || !pairsRef.current || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const el = pairsRef.current;
    const compute = () => {
      const h = el.clientHeight;
      // Учитываем padding контейнера (p-1 = 4px each side) + gap между
      // парами (space-y-0.5 = 2px).
      const usable = h - 8;
      if (usable <= 0) return;
      const count = Math.max(
        COMPACT_MIN,
        Math.floor(usable / (PAIR_ROW_HEIGHT + 2))
      );
      setFitCount((prev) => (prev === count ? prev : count));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded, tradePairs.length]);

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

  // Visible pairs — фильтр по поиску + sort: favorites первыми + лимит compact.
  // Внутри favorites порядок такой как сохранён в preferences (юзерский).
  // Внутри non-favorites — порядок исходного tradePairs (priority-based).
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
    // Сортируем: favorites первыми (в порядке preferences), затем остальные.
    if (favKeys.size > 0) {
      const favs = [];
      const rest = [];
      list.forEach(([a, b]) => {
        if (isFavorite(a, b)) favs.push([a, b]);
        else rest.push([a, b]);
      });
      list = [...favs, ...rest];
    }
    if (!expanded && !q) {
      list = list.slice(0, fitCount);
    }
    return list;
  }, [tradePairs, query, expanded, fitCount, favKeys, isFavorite]);

  const totalCount = tradePairs.length;
  const showingCount = visiblePairs.length;
  const hasHidden = !expanded && !query && totalCount > showingCount;

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
            <button
              type="button"
              onClick={onOpenRates}
              className="inline-flex items-center justify-center w-6 h-6 rounded-[6px] bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 transition-colors shrink-0"
              title="Полная страница курсов"
            >
              <Settings2 className="w-3 h-3" />
            </button>
          )}
        </div>
        <span className="inline-flex items-center gap-1 text-[9px] text-slate-400 mt-0.5">
          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
          {timeAgo(lastUpdated)} ago
        </span>
      </header>

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
        ref={pairsRef}
        className={`p-1 space-y-0.5 ${
          expanded ? "max-h-[70vh] overflow-y-auto" : "flex-1 overflow-hidden"
        }`}
      >
        {visiblePairs.map(([a, b], idx) => {
          const fav = isFavorite(a, b);
          // Divider после последнего favorite — визуально отделить группу.
          const isLastFav =
            fav &&
            !query &&
            idx + 1 < visiblePairs.length &&
            !isFavorite(visiblePairs[idx + 1][0], visiblePairs[idx + 1][1]);
          // Два направления — каждое со своим курсом из БД.
          // a→b и b→a показываются независимо. Никакой sell/buy метки —
          // юзер сразу видит "USD → USDT 1.0000" и "USDT → USD 1.0200".
          const rateAB = getRateForTab(a, b);
          const rateBA = getRateForTab(b, a);
          const pairHasOverride = hasOverride(a, b) || hasOverride(b, a);
          return (
            <React.Fragment key={`${a}-${b}`}>
            <div
              className={`px-2 py-1 rounded-[8px] transition-colors ${
                fav
                  ? "bg-amber-50/70 ring-1 ring-amber-200"
                  : pairHasOverride
                  ? "bg-indigo-50/60 ring-1 ring-indigo-100"
                  : "bg-slate-50"
              }`}
            >
              {/* Header: ⭐ + override-бейдж. Без sell/buy и без spread. */}
              <div className="flex items-center gap-1 mb-0.5">
                <button
                  type="button"
                  onClick={(e) => toggleFavorite(a, b, e)}
                  className={`shrink-0 transition-colors ${
                    fav
                      ? "text-amber-500 hover:text-amber-600"
                      : "text-slate-300 hover:text-amber-500"
                  }`}
                  title={fav ? "Убрать из избранного" : "В избранное"}
                >
                  <Star className={`w-2.5 h-2.5 ${fav ? "fill-amber-400" : ""}`} />
                </button>
                <span className="text-[9px] font-bold text-slate-400 tracking-wider uppercase">
                  {a} / {b}
                </span>
                {pairHasOverride && (
                  <span
                    className="ml-auto px-1 py-px rounded text-[8px] font-bold bg-indigo-100 text-indigo-700 tracking-wider"
                    title="Office override активен"
                  >
                    OFC
                  </span>
                )}
              </div>
              {/* Direction 1: a → b */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10.5px] font-semibold text-slate-700 inline-flex items-center gap-0.5 tracking-tight">
                  {a}
                  <ArrowRight className="w-2 h-2 mx-0.5 text-slate-400" />
                  {b}
                </span>
                <span className="text-[11.5px] font-bold tabular-nums text-slate-900">
                  {formatRate(rateAB)}
                </span>
              </div>
              {/* Direction 2: b → a */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10.5px] font-semibold text-slate-700 inline-flex items-center gap-0.5 tracking-tight">
                  {b}
                  <ArrowRight className="w-2 h-2 mx-0.5 text-slate-400" />
                  {a}
                </span>
                <span className="text-[11.5px] font-bold tabular-nums text-slate-900">
                  {formatRate(rateBA)}
                </span>
              </div>
            </div>
            {isLastFav && (
              <div className="my-1 border-t border-dashed border-slate-200" />
            )}
            </React.Fragment>
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
