// src/components/RatesCoveragePanel.jsx
// Sub-view в RatesEditModal. Анализирует покрытие валютных пар и показывает:
//   • Summary с Coverage %
//   • Matrix N×N (existing / missing / dismissed / self)
//   • Missing pairs list (с Quick-add и Dismiss)
//   • One-way warnings (асимметрия: есть A→B но нет B→A)
//   • Isolated currencies
//   • Export missing to xlsx → заполняешь → Import обратно

import React, { useMemo, useState } from "react";
import {
  ChevronLeft,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Download,
  EyeOff,
  Eye,
  TrendingUp,
  ArrowLeftRight,
} from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { useCurrencies } from "../store/currencies.jsx";
import {
  analyzeCoverage,
  loadDismissed,
  dismissPair,
  undismissPair,
  clearDismissed,
} from "../utils/ratesCoverage.js";
import { buildTemplateBlob, downloadBlob } from "../utils/xlsxRates.js";

export default function RatesCoveragePanel({ onBack, onQuickAdd, onOpenImport }) {
  const { pairs, channels, getRate } = useRates();
  const { currencies } = useCurrencies();
  const [dismissedTick, setDismissedTick] = useState(0); // force re-analyze
  const [showDismissed, setShowDismissed] = useState(false);

  const coverage = useMemo(() => {
    return analyzeCoverage(currencies, pairs, channels, loadDismissed());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencies, pairs, channels, dismissedTick]);

  const pct = coverage.total > 0 ? Math.round((coverage.existingCount / coverage.total) * 100) : 0;

  const handleDismiss = (from, to) => {
    dismissPair(from, to);
    setDismissedTick((t) => t + 1);
  };
  const handleUndismiss = (from, to) => {
    undismissPair(from, to);
    setDismissedTick((t) => t + 1);
  };

  // Export missing to xlsx — генерим шаблон с from/to но пустым rate
  const handleExportMissing = () => {
    if (coverage.missing.length === 0) return;
    // Экспорт в обе стороны, чтобы при Import сразу добавилось все
    const rows = [];
    coverage.missing.forEach(({ from, to }) => {
      rows.push({ from, to, rate: "" });
      rows.push({ from: to, to: from, rate: "" });
    });
    coverage.oneWay.forEach(({ from, to, missingDirection }) => {
      const [mf, mt] = missingDirection.split("→");
      rows.push({ from: mf, to: mt, rate: "" });
    });
    const blob = buildTemplateBlob(rows);
    downloadBlob(blob, "coinplata-missing-pairs.xlsx");
  };

  return (
    <div className="p-5 max-h-[70vh] overflow-auto space-y-5">
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          type="button"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-[12px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100"
        >
          <ChevronLeft className="w-3 h-3" />
          Back
        </button>
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Coverage analysis
        </div>
      </div>

      {/* === Summary card === */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryStat
          label="Coverage"
          value={`${pct}%`}
          sub={`${coverage.existingCount} of ${coverage.total} directions`}
          tone={pct >= 80 ? "emerald" : pct >= 50 ? "amber" : "rose"}
          big
        />
        <SummaryStat
          label="Missing"
          value={coverage.missing.length}
          sub="both directions"
          tone={coverage.missing.length === 0 ? "emerald" : "rose"}
        />
        <SummaryStat
          label="One-way"
          value={coverage.oneWay.length}
          sub="asymmetric"
          tone={coverage.oneWay.length === 0 ? "emerald" : "amber"}
        />
        <SummaryStat
          label="Isolated"
          value={coverage.isolated.length}
          sub={coverage.isolated.length > 0 ? coverage.isolated.join(", ") : "—"}
          tone={coverage.isolated.length === 0 ? "emerald" : "rose"}
        />
      </div>

      {/* === Matrix === */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[12px] font-bold uppercase tracking-wider text-slate-600">
            Matrix
          </h4>
          <div className="flex items-center gap-2 text-[10px] font-semibold">
            <LegendPill tone="emerald" label="covered" />
            <LegendPill tone="rose" label="missing" />
            <LegendPill tone="slate" label="dismissed" />
          </div>
        </div>
        <CoverageMatrix coverage={coverage} onQuickAdd={onQuickAdd} />
      </section>

      {/* === Actions row === */}
      {(coverage.missing.length > 0 || coverage.oneWay.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap bg-slate-50 border border-slate-200 rounded-[10px] px-4 py-3">
          <div className="text-[12px] text-slate-700 flex-1">
            <TrendingUp className="inline w-3.5 h-3.5 mr-1 text-slate-500" />
            {coverage.missing.length > 0 && (
              <>Got <strong>{coverage.missing.length}</strong> missing pair(s)</>
            )}
            {coverage.missing.length > 0 && coverage.oneWay.length > 0 && " + "}
            {coverage.oneWay.length > 0 && (
              <><strong>{coverage.oneWay.length}</strong> one-way</>
            )}
            . Export them, fill the rates, import back.
          </div>
          <button
            onClick={handleExportMissing}
            disabled={coverage.missing.length === 0 && coverage.oneWay.length === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-[11px] font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 disabled:opacity-50"
          >
            <Download className="w-3 h-3" />
            Export missing.xlsx
          </button>
          <button
            onClick={onOpenImport}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-[11px] font-semibold text-white bg-slate-900 hover:bg-slate-800"
          >
            Import xlsx
          </button>
        </div>
      )}

      {/* === One-way warnings === */}
      {coverage.oneWay.length > 0 && (
        <section>
          <div className="flex items-center gap-1.5 mb-2">
            <ArrowLeftRight className="w-3.5 h-3.5 text-amber-600" />
            <h4 className="text-[12px] font-bold uppercase tracking-wider text-amber-700">
              One-way pairs · {coverage.oneWay.length}
            </h4>
            <span className="text-[11px] text-slate-500 font-normal normal-case tracking-normal">
              — exists in one direction only. Add the reverse to allow full flow.
            </span>
          </div>
          <div className="border border-amber-200 rounded-[10px] bg-amber-50/40 overflow-hidden">
            {coverage.oneWay.map(({ from, to, missingDirection }) => {
              const [mf, mt] = missingDirection.split("→");
              const existingRate = getRate(from, to);
              return (
                <div
                  key={`${from}-${to}`}
                  className="flex items-center gap-3 px-3 py-2 border-b border-amber-100 last:border-0"
                >
                  <span className="inline-flex items-center gap-1 text-[12px]">
                    <span className="font-semibold">{from}</span>
                    <span className="text-slate-400">→</span>
                    <span className="font-semibold">{to}</span>
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      {existingRate ? existingRate : ""}
                    </span>
                  </span>
                  <span className="text-amber-700 text-[11px] font-semibold">
                    missing: {missingDirection}
                  </span>
                  <button
                    onClick={() => onQuickAdd?.(mf, mt)}
                    className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-900 text-white hover:bg-slate-800"
                  >
                    <Plus className="w-3 h-3" />
                    Add {missingDirection}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* === Missing list === */}
      {coverage.missing.length > 0 && (
        <section>
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
            <h4 className="text-[12px] font-bold uppercase tracking-wider text-rose-700">
              Missing pairs · {coverage.missing.length}
            </h4>
          </div>
          <div className="border border-rose-200 rounded-[10px] bg-rose-50/30 overflow-hidden">
            {coverage.missing.map(({ from, to }) => (
              <div
                key={`${from}-${to}`}
                className="flex items-center gap-2 px-3 py-2 border-b border-rose-100 last:border-0"
              >
                <span className="text-[12px]">
                  <span className="font-semibold">{from}</span>
                  <span className="text-slate-400 mx-1">↔</span>
                  <span className="font-semibold">{to}</span>
                </span>
                <span className="text-[10px] text-slate-500 italic">no rate in any direction</span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => onQuickAdd?.(from, to)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-900 text-white hover:bg-slate-800"
                    title={`Add ${from} → ${to}`}
                  >
                    <Plus className="w-3 h-3" />
                    {from}→{to}
                  </button>
                  <button
                    onClick={() => onQuickAdd?.(to, from)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-white text-slate-700 border border-slate-200 hover:border-slate-300"
                    title={`Add ${to} → ${from}`}
                  >
                    <Plus className="w-3 h-3" />
                    {to}→{from}
                  </button>
                  <button
                    onClick={() => handleDismiss(from, to)}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100"
                    title="Not needed — hide from list"
                  >
                    <EyeOff className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* === Isolated currencies === */}
      {coverage.isolated.length > 0 && (
        <section className="rounded-[10px] border border-rose-300 bg-rose-50 px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-700" />
            <h4 className="text-[12px] font-bold uppercase tracking-wider text-rose-800">
              Isolated currencies · {coverage.isolated.length}
            </h4>
          </div>
          <div className="text-[12px] text-rose-800">
            <strong>{coverage.isolated.join(", ")}</strong> — has zero rate pairs. Cannot be used in any exchange until at least one pair is added.
          </div>
        </section>
      )}

      {/* === Dismissed toggle === */}
      {coverage.dismissed.length > 0 && (
        <section>
          <button
            onClick={() => setShowDismissed((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-900"
          >
            {showDismissed ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            {showDismissed ? "Hide" : "Show"} dismissed ({coverage.dismissed.length})
          </button>
          {showDismissed && (
            <div className="mt-2 border border-slate-200 rounded-[10px] bg-slate-50/60 overflow-hidden">
              {coverage.dismissed.map(({ from, to }) => (
                <div
                  key={`${from}-${to}`}
                  className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 last:border-0"
                >
                  <span className="text-[11px] text-slate-600">
                    {from} ↔ {to}
                  </span>
                  <button
                    onClick={() => {
                      handleUndismiss(from, to);
                      handleUndismiss(to, from);
                    }}
                    className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200"
                  >
                    <Eye className="w-3 h-3" />
                    Restore
                  </button>
                </div>
              ))}
              <div className="px-3 py-2 text-right">
                <button
                  onClick={() => {
                    clearDismissed();
                    setDismissedTick((t) => t + 1);
                  }}
                  className="text-[10px] font-semibold text-rose-600 hover:text-rose-800"
                >
                  Clear all dismissed
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* === All good === */}
      {coverage.missing.length === 0 &&
        coverage.oneWay.length === 0 &&
        coverage.isolated.length === 0 && (
          <div className="rounded-[12px] border border-emerald-200 bg-emerald-50 p-5 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
            <div className="text-[14px] font-bold text-emerald-900">Full coverage</div>
            <div className="text-[12px] text-emerald-700 mt-1">
              All currencies have bidirectional rates. Nothing missing, nothing asymmetric.
            </div>
          </div>
        )}
    </div>
  );
}

// ----- sub-components -----

function SummaryStat({ label, value, sub, tone, big }) {
  const colors = {
    emerald: "text-emerald-700 bg-emerald-50 border-emerald-200",
    amber: "text-amber-700 bg-amber-50 border-amber-200",
    rose: "text-rose-700 bg-rose-50 border-rose-200",
    slate: "text-slate-700 bg-slate-50 border-slate-200",
  };
  return (
    <div className={`rounded-[12px] border px-4 py-3 ${colors[tone] || colors.slate}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</div>
      <div className={`${big ? "text-[24px]" : "text-[18px]"} font-bold tabular-nums tracking-tight mt-1`}>
        {value}
      </div>
      <div className="text-[10px] opacity-70 mt-0.5 truncate" title={sub}>{sub}</div>
    </div>
  );
}

function LegendPill({ tone, label }) {
  const bg = {
    emerald: "bg-emerald-400",
    rose: "bg-rose-400",
    slate: "bg-slate-300",
  }[tone];
  return (
    <span className="inline-flex items-center gap-1 text-slate-500 uppercase tracking-wider">
      <span className={`w-2 h-2 rounded-sm ${bg}`} />
      {label}
    </span>
  );
}

function CoverageMatrix({ coverage, onQuickAdd }) {
  const { currencies, matrix } = coverage;
  const cellClass = (status) => {
    const base = "w-full aspect-square flex items-center justify-center text-[9px] font-bold rounded-sm transition-colors";
    switch (status) {
      case "existing":
        return `${base} bg-emerald-400 text-white`;
      case "missing":
        return `${base} bg-rose-300 text-rose-900 hover:bg-rose-400 cursor-pointer`;
      case "dismissed":
        return `${base} bg-slate-200 text-slate-500`;
      case "self":
        return `${base} bg-slate-100 text-slate-300`;
      default:
        return `${base} bg-slate-100 text-slate-400`;
    }
  };

  return (
    <div className="border border-slate-200 rounded-[10px] bg-white p-3 overflow-auto">
      <div className="inline-grid gap-0.5 min-w-full"
        style={{ gridTemplateColumns: `minmax(44px, auto) repeat(${currencies.length}, minmax(32px, 1fr))` }}>
        {/* header row */}
        <div />
        {currencies.map((c) => (
          <div key={`h-${c}`} className="text-[9px] font-bold text-slate-600 text-center py-1 truncate">
            {c}
          </div>
        ))}
        {/* body */}
        {currencies.map((from) => (
          <React.Fragment key={`row-${from}`}>
            <div className="text-[9px] font-bold text-slate-600 pr-2 py-1 flex items-center justify-end">
              {from}
            </div>
            {currencies.map((to) => {
              const key = `${from}_${to}`;
              const status = matrix.get(key) || "missing";
              const title =
                status === "self"
                  ? `${from} = ${to}`
                  : status === "existing"
                  ? `${from} → ${to} ✓`
                  : status === "dismissed"
                  ? `${from} → ${to} · dismissed`
                  : `${from} → ${to} · missing — click to add`;
              return (
                <div
                  key={key}
                  onClick={status === "missing" ? () => onQuickAdd?.(from, to) : undefined}
                  className={cellClass(status)}
                  title={title}
                >
                  {status === "existing" ? "✓" : status === "missing" ? "·" : ""}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
