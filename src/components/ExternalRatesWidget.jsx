// src/components/ExternalRatesWidget.jsx
//
// Внешние котировки — Binance, Harem, TCMB. Источник: view
// v_external_rates_latest, Edge Function fetch-external-rates пишет
// каждые 5 минут (cron external-rates-fetch).
//
// Виджет:
//   • Группировка по source с цветной пиллой.
//   • Подпись origin URL + частоты обновления — кассир видит откуда
//     цифра и насколько свежая.
//   • Калькулятор спреда per-source: «Спред %» — bid/ask раздвигаются
//     вокруг mid (наш курс продажи/покупки с маржей).

import React, { useEffect, useState } from "react";
import { Globe, RefreshCcw, Calculator, ChevronDown, ChevronUp } from "lucide-react";
import { loadExternalRatesLatest } from "../lib/supabaseReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";
import { useNow } from "../hooks/useNow.js";

const SOURCES = {
  binance: {
    label: "Binance",
    tone: "bg-amber-50 text-amber-700 ring-amber-200",
    accent: "text-amber-700",
    origin: "api.binance.com · Spot bookTicker",
  },
  tcmb: {
    label: "TCMB",
    tone: "bg-sky-50 text-sky-700 ring-sky-200",
    accent: "text-sky-700",
    origin: "tcmb.gov.tr · resmi kurlar XML",
  },
  cbr: {
    label: "ЦБ РФ",
    tone: "bg-rose-50 text-rose-700 ring-rose-200",
    accent: "text-rose-700",
    origin: "cbr-xml-daily.ru · daily JSON",
  },
  ecb: {
    label: "ЕЦБ",
    tone: "bg-violet-50 text-violet-700 ring-violet-200",
    accent: "text-violet-700",
    origin: "frankfurter.dev · ECB derived",
  },
};

const SOURCE_ORDER = ["binance", "tcmb", "cbr", "ecb"];
const REFRESH_INTERVAL = "каждые 5 мин";
const SPREAD_KEY = "coinplata.externalSpread";
const COLLAPSED_KEY = "coinplata.externalRatesCollapsed";

function fmtRate(v) {
  if (!Number.isFinite(v)) return "—";
  if (v >= 100) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

function timeAgo(iso, nowMs) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Math.floor((nowMs - t) / 1000);
  if (diff < 60) return `${diff} сек`;
  if (diff < 3600) return `${Math.floor(diff / 60)} мин`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч`;
  return `${Math.floor(diff / 86400)} д`;
}

function formatPair(pair) {
  if (!pair) return "";
  const [a, b] = pair.split("_");
  return `${a}/${b}`;
}

// Калькулятор спреда. Раздвигает bid/ask от середины на `pct` процентов.
//   spread=0.5 → bid·=(1-0.005), ask·=(1+0.005). Это «наш» курс с маржей.
function applySpread(bid, ask, pct) {
  const s = Number(pct) / 100;
  if (!Number.isFinite(s) || s === 0) return { bid, ask };
  const mid = bid && ask ? (bid + ask) / 2 : bid || ask;
  if (!mid) return { bid, ask };
  return {
    bid: bid ? bid - mid * s : null,
    ask: ask ? ask + mid * s : null,
  };
}

export default function ExternalRatesWidget({ compact = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const nowMs = useNow(60_000);
  // Сворачиваемый блок — persist в localStorage чтобы юзер не открывал заново.
  // По умолчанию свёрнут (compact=true) — занимает 1 строку.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      return raw == null ? true : raw === "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {}
  }, [collapsed]);
  // Спред per-source persist в localStorage — опциональная настройка.
  // По умолчанию калькулятор СВЁРНУТ (showCalc[source] = false). Юзер
  // открывает иконкой калькулятора в шапке source — тогда появляется
  // input. Раздвижение bid/ask применяется только если показан + введён.
  const [spreadBySource, setSpreadBySource] = useState(() => {
    try {
      const raw = localStorage.getItem(SPREAD_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [showCalc, setShowCalc] = useState({});
  const toggleCalc = (source) => {
    setShowCalc((prev) => ({ ...prev, [source]: !prev[source] }));
  };
  const updateSpread = (source, value) => {
    setSpreadBySource((prev) => {
      const next = { ...prev, [source]: value };
      try {
        localStorage.setItem(SPREAD_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const reload = React.useCallback(() => {
    setLoading(true);
    loadExternalRatesLatest()
      .then((data) => setRows(data))
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[external rates] load failed", err);
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
    const unsub = onDataBump(reload);
    const id = setInterval(reload, 60_000);
    return () => {
      unsub?.();
      clearInterval(id);
    };
  }, [reload]);

  const bySource = new Map();
  rows.forEach((r) => {
    if (!bySource.has(r.source)) bySource.set(r.source, []);
    bySource.get(r.source).push(r);
  });

  return (
    <section className="bg-white rounded-[14px] border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
      {/* Шапка кликабельная — сворачивает / разворачивает блок. Кнопки
          обновления и chevron справа; клик в любую часть шапки toggle'ит. */}
      <header
        onClick={() => setCollapsed((v) => !v)}
        className="px-4 py-3 border-b border-slate-100 bg-gradient-to-b from-slate-50/40 to-transparent cursor-pointer select-none hover:bg-slate-50/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-slate-500 shrink-0" />
          <h2 className="text-[14px] font-bold text-slate-900 tracking-tight truncate flex-1">
            Внешние котировки
          </h2>
          {!collapsed && (
            <button
              onClick={(e) => { e.stopPropagation(); reload(); }}
              className="p-1 rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
              title="Обновить вручную"
            >
              <RefreshCcw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          )}
          {collapsed
            ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            : <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />}
        </div>
        <div className="text-[11px] text-slate-500 mt-1">
          {collapsed
            ? `${bySource.size || 0} источников · ${rows.length} пар · клик чтобы раскрыть`
            : `Авто-обновление ${REFRESH_INTERVAL}`}
        </div>
      </header>
      {!collapsed && (rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12px] text-slate-400">
          {loading ? "Загрузка…" : "Нет данных. Cron подтянет в течение 5 минут."}
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {SOURCE_ORDER.filter((s) => bySource.has(s)).map((source) => {
            const meta = SOURCES[source] || { label: source, tone: "bg-slate-100 text-slate-700 ring-slate-200", origin: "" };
            const sourceRows = bySource.get(source);
            const fetchedAt = sourceRows[0]?.fetchedAt;
            const spread = spreadBySource[source] != null ? spreadBySource[source] : "";
            const spreadNum = Number(spread);
            const calcOpen = !!showCalc[source];
            const hasSpread = calcOpen && Number.isFinite(spreadNum) && spreadNum !== 0;
            return (
              <div key={source} className="px-4 py-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11.5px] font-bold uppercase tracking-wider ring-1 ${meta.tone}`}
                  >
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-slate-500 tabular-nums">
                    {timeAgo(fetchedAt, nowMs)} назад
                  </span>
                  <button
                    onClick={() => toggleCalc(source)}
                    title="Калькулятор спреда — опционно показать курс с маржой"
                    className={`ml-auto p-1.5 rounded transition-colors ${
                      calcOpen
                        ? "bg-slate-900 text-white"
                        : "text-slate-400 hover:text-slate-900 hover:bg-slate-100"
                    }`}
                  >
                    <Calculator className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div
                  className="text-[10.5px] text-slate-400 truncate"
                  title={meta.origin}
                >
                  {meta.origin}
                </div>

                {/* Калькулятор спреда — раскрывается по иконке. Раздвигает
                    bid/ask вокруг mid: bid−=mid·s, ask+=mid·s. */}
                {calcOpen && (
                  <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-[8px] px-2 py-1">
                    <Calculator className="w-3 h-3 text-slate-400" />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Спред
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={spread}
                      onChange={(e) =>
                        updateSpread(source, e.target.value.replace(/[^\d.,-]/g, "").replace(",", "."))
                      }
                      placeholder="0"
                      autoFocus
                      className="flex-1 bg-transparent outline-none text-[12px] tabular-nums font-semibold text-slate-900 min-w-0 text-right"
                    />
                    <span className="text-[10px] text-slate-400 font-bold">%</span>
                  </div>
                )}

                {/* Список пар: одна колонка «Курс» (mid). Без покупки/
                    продажи — это публичные котировки источника, не наш
                    bid/ask со спредом. Размер — крупнее предыдущей итерации
                    (text-[14px]) чтобы кассир видел цифры без напряга. */}
                <div className="divide-y divide-slate-100 -mx-1">
                  {sourceRows.map((r) => {
                    const mid = Number.isFinite(r.mid)
                      ? r.mid
                      : (r.bid != null && r.ask != null ? (r.bid + r.ask) / 2 : (r.bid ?? r.ask));
                    const adjusted = hasSpread && mid != null
                      ? mid * (1 + spreadNum / 100)
                      : null;
                    return (
                      <div
                        key={`${r.source}_${r.pair}`}
                        className="flex items-baseline justify-between gap-2 px-1 py-1.5"
                      >
                        <span className="text-[13.5px] font-bold text-slate-700 tracking-wide">
                          {formatPair(r.pair)}
                        </span>
                        <span className="text-right">
                          <span className={`text-[15px] font-bold tabular-nums ${hasSpread ? meta.accent : "text-slate-900"}`}>
                            {fmtRate(hasSpread ? adjusted : mid)}
                          </span>
                          {hasSpread && mid != null && (
                            <span className="ml-1.5 text-[10.5px] text-slate-400 tabular-nums">
                              (от {fmtRate(mid)})
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
