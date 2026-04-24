// src/components/RatesSidebar.jsx
// Компактный вертикальный список торговых пар для CREATE-режима CashierPage.
// Каждый блок = одна пара с двумя направлениями (a→b и b→a), как в RatesBar.
// Кассир видит и покупку и продажу не переключая внимание.
//
// Office tabs сверху — переключение между Global / каждым активным офисом.
// Дефолт = currentOffice из header. rates office-aware: если у офиса есть
// override для пары — показываем его курс, иначе global fallback.
// Бейдж OFC на паре = override активен (курс отличается от global).

import React, { useState, useEffect } from "react";
import { TrendingUp, ArrowRight } from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { useCurrencies } from "../store/currencies.jsx";
import { useOffices } from "../store/offices.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { getTradingRates } from "../utils/tradingRates.js";

const TRADE_PAIRS = [
  ["USDT", "TRY"],
  ["USDT", "USD"],
  ["USDT", "EUR"],
  ["USDT", "GBP"],
  ["USD", "TRY"],
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

export default function RatesSidebar({ currentOffice }) {
  const { getRate: getRateRaw, lastUpdated, getOfficeOverride } = useRates();
  const { dict: currencyDict } = useCurrencies();
  const { activeOffices } = useOffices();
  const { t } = useTranslation();
  const isCrypto = (code) => currencyDict[code]?.type === "crypto";

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

  return (
    <aside className="bg-white rounded-[16px] border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_12px_rgba(15,23,42,0.06)]">
      <header className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700">
            <TrendingUp className="w-3 h-3" />
          </div>
          <h2 className="text-[12px] font-bold text-slate-900 tracking-tight uppercase">
            {t("rates") || "Rates"}
          </h2>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
          {timeAgo(lastUpdated)} ago
        </span>
      </header>

      {/* Office tabs: Global + каждый активный офис. Выбор влияет на курсы
          ниже. По дефолту подсвечен текущий офис (из header).
          flex-wrap — чтобы длинные имена / много офисов не ломали layout. */}
      <div className="px-2 pt-2 flex flex-wrap gap-1 border-b border-slate-100 pb-2">
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

      <div className="p-2 space-y-1">
        {TRADE_PAIRS.map(([a, b]) => {
          const { ask: sell, bid: buy } = getTradingRates({
            getRate: getRateForTab,
            isCrypto,
            base: a,
            quote: b,
          });
          const pairHasOverride = hasOverride(a, b) || hasOverride(b, a);
          return (
            <div
              key={`${a}-${b}`}
              className={`px-3 py-2 rounded-[10px] transition-colors ${
                pairHasOverride ? "bg-indigo-50/60 ring-1 ring-indigo-100" : "bg-slate-50"
              }`}
            >
              <div className="text-[9px] font-bold text-slate-500 tracking-[0.12em] mb-1.5 inline-flex items-center gap-1">
                <span>{a}</span>
                <span className="text-slate-400">⇄</span>
                <span>{b}</span>
                {pairHasOverride && (
                  <span
                    className="ml-0.5 px-1 py-px rounded text-[8px] font-bold bg-indigo-100 text-indigo-700 tracking-wider"
                    title="Office override активен"
                  >
                    OFC
                  </span>
                )}
              </div>
              <div className="flex items-baseline justify-between mb-0.5">
                <span className="text-[10px] font-semibold text-slate-500 inline-flex items-center">
                  {a} <ArrowRight className="w-2.5 h-2.5 mx-0.5" /> {b}
                </span>
                <span className="text-[13px] font-bold tabular-nums text-slate-900 leading-none">
                  {formatRate(sell)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] font-semibold text-slate-500 inline-flex items-center">
                  {b} <ArrowRight className="w-2.5 h-2.5 mx-0.5" /> {a}
                </span>
                <span className="text-[12px] font-bold tabular-nums text-slate-600 leading-none">
                  {formatRate(buy)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
