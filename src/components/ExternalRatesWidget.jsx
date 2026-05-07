// src/components/ExternalRatesWidget.jsx
//
// Внешние котировки — Binance, Harem, TCMB, BestChange. Источник: view
// v_external_rates_latest, заполняется Edge Function fetch-external-rates
// по cron каждые 5 минут (миграция external_rates_cron).
//
// Виджет — компактная карточка с группировкой по source. Показывает
// bid/ask, время последнего обновления. Полезен кассиру чтобы быстро
// сравнить наш курс с рыночным.

import React, { useEffect, useState } from "react";
import { Globe, RefreshCcw } from "lucide-react";
import { loadExternalRatesLatest } from "../lib/supabaseReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";
import { useNow } from "../hooks/useNow.js";

const SOURCE_LABEL = {
  binance: "Binance",
  harem: "Harem",
  tcmb: "TCMB",
  bestchange: "BestChange",
};

const SOURCE_TONE = {
  binance: "bg-amber-50 text-amber-700 ring-amber-200",
  harem: "bg-rose-50 text-rose-700 ring-rose-200",
  tcmb: "bg-sky-50 text-sky-700 ring-sky-200",
  bestchange: "bg-violet-50 text-violet-700 ring-violet-200",
};

const SOURCE_ORDER = ["binance", "harem", "tcmb", "bestchange"];

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
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function formatPair(pair) {
  if (!pair) return "";
  const [a, b] = pair.split("_");
  return `${a}/${b}`;
}

export default function ExternalRatesWidget() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const nowMs = useNow(60_000);

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
    // Полу-минутный re-poll на случай если bumpDataVersion не сработал
    // (внешний cron пишет независимо от наших мутаций).
    const id = setInterval(reload, 60_000);
    return () => {
      unsub?.();
      clearInterval(id);
    };
  }, [reload]);

  // Группировка по source.
  const bySource = new Map();
  rows.forEach((r) => {
    if (!bySource.has(r.source)) bySource.set(r.source, []);
    bySource.get(r.source).push(r);
  });

  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Globe className="w-4 h-4 text-slate-500" />
        <h2 className="text-[13px] font-bold text-slate-900 tracking-tight">
          Внешние котировки
        </h2>
        <span className="text-[11px] text-slate-400">— Binance / Harem / TCMB</span>
        <button
          onClick={reload}
          className="ml-auto p-1 rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          title="Обновить"
        >
          <RefreshCcw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-[12px] text-slate-400">
          {loading ? "Загрузка…" : "Нет данных. Cron подтянет в течение 5 минут."}
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {SOURCE_ORDER.filter((s) => bySource.has(s)).map((source) => (
            <div key={source} className="px-4 py-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ring-1 ${SOURCE_TONE[source]}`}
                >
                  {SOURCE_LABEL[source] || source}
                </span>
                <span className="text-[10px] text-slate-400 tabular-nums">
                  {timeAgo(bySource.get(source)[0]?.fetchedAt, nowMs)} ago
                </span>
              </div>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[9.5px] font-bold text-slate-400 tracking-wider uppercase">
                    <th className="text-left font-bold">Пара</th>
                    <th className="text-right font-bold">Покупка</th>
                    <th className="text-right font-bold">Продажа</th>
                  </tr>
                </thead>
                <tbody>
                  {bySource.get(source).map((r) => (
                    <tr key={`${r.source}_${r.pair}`} className="border-t border-slate-50">
                      <td className="py-1 text-slate-700 font-semibold">{formatPair(r.pair)}</td>
                      <td className="py-1 text-right tabular-nums text-slate-900 font-semibold">
                        {fmtRate(r.bid)}
                      </td>
                      <td className="py-1 text-right tabular-nums text-slate-900 font-semibold">
                        {fmtRate(r.ask)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
