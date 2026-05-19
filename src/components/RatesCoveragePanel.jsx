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
import { useTranslation } from "../i18n/translations.jsx";
import {
  analyzeCoverage,
  loadDismissed,
  dismissPair,
  undismissPair,
  clearDismissed,
} from "../utils/ratesCoverage.js";
import { buildTemplateBlob, downloadBlob } from "../utils/xlsxRates.js";

export default function RatesCoveragePanel({ onBack, onQuickAdd, onOpenImport }) {
  const { t } = useTranslation();
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
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-button text-[12px] font-semibold text-ink-soft hover:text-ink hover:bg-surface-sunk"
        >
          <ChevronLeft className="w-3 h-3" />
          {t("cov_back")}
        </button>
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted">
          {t("cov_title")}
        </div>
      </div>

      {/* === Summary card === */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryStat
          label={t("cov_coverage")}
          value={`${pct}%`}
          sub={`${coverage.existingCount} / ${coverage.total} ${t("cov_dirs")}`}
          tone={pct >= 80 ? "emerald" : pct >= 50 ? "amber" : "rose"}
          big
        />
        <SummaryStat
          label={t("cov_missing")}
          value={coverage.missing.length}
          sub={t("cov_both_directions")}
          tone={coverage.missing.length === 0 ? "emerald" : "rose"}
        />
        <SummaryStat
          label={t("cov_one_way")}
          value={coverage.oneWay.length}
          sub={t("cov_asymmetric")}
          tone={coverage.oneWay.length === 0 ? "emerald" : "amber"}
        />
        <SummaryStat
          label={t("cov_isolated")}
          value={coverage.isolated.length}
          sub={coverage.isolated.length > 0 ? coverage.isolated.join(", ") : "—"}
          tone={coverage.isolated.length === 0 ? "emerald" : "rose"}
        />
      </div>

      {/* === Matrix === */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[12px] font-bold uppercase tracking-wider text-ink-soft">
            {t("cov_matrix")}
          </h4>
          <div className="flex items-center gap-2 text-[10px] font-semibold">
            <LegendPill tone="emerald" label={t("cov_legend_covered")} />
            <LegendPill tone="rose" label={t("cov_legend_missing")} />
            <LegendPill tone="slate" label={t("cov_legend_dismissed")} />
          </div>
        </div>
        <CoverageMatrix coverage={coverage} onQuickAdd={onQuickAdd} />
      </section>

      {/* === Actions row === */}
      {(coverage.missing.length > 0 || coverage.oneWay.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap bg-surface-soft border border-border-soft rounded-card px-4 py-3">
          <div className="text-[12px] text-ink-soft flex-1">
            <TrendingUp className="inline w-3.5 h-3.5 mr-1 text-muted" />
            {coverage.missing.length > 0 && (
              <>{t("cov_got_missing")} <strong>{coverage.missing.length}</strong> {t("cov_missing_pairs_word")}</>
            )}
            {coverage.missing.length > 0 && coverage.oneWay.length > 0 && " + "}
            {coverage.oneWay.length > 0 && (
              <><strong>{coverage.oneWay.length}</strong> {t("cov_oneway_word")}</>
            )}
            . {t("cov_export_hint")}
          </div>
          <button
            onClick={handleExportMissing}
            disabled={coverage.missing.length === 0 && coverage.oneWay.length === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-button text-[11px] font-semibold text-ink-soft hover:text-ink bg-white border border-border-soft hover:border-border disabled:opacity-50"
          >
            <Download className="w-3 h-3" />
            {t("cov_export_missing")}
          </button>
          <button
            onClick={onOpenImport}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-button text-[11px] font-semibold text-white bg-ink hover:bg-ink"
          >
            {t("cov_import_xlsx")}
          </button>
        </div>
      )}

      {/* === One-way warnings === */}
      {coverage.oneWay.length > 0 && (
        <section>
          <div className="flex items-center gap-1.5 mb-2">
            <ArrowLeftRight className="w-3.5 h-3.5 text-warning" />
            <h4 className="text-[12px] font-bold uppercase tracking-wider text-warning">
              {t("cov_oneway_heading")} · {coverage.oneWay.length}
            </h4>
            <span className="text-[11px] text-muted font-normal normal-case tracking-normal">
              — {t("cov_oneway_hint")}
            </span>
          </div>
          <div className="border border-warning/20 rounded-card bg-warning-soft/40 overflow-hidden">
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
                    <span className="text-muted-soft">→</span>
                    <span className="font-semibold">{to}</span>
                    <span className="text-[11px] text-muted tabular-nums">
                      {existingRate ? existingRate : ""}
                    </span>
                  </span>
                  <span className="text-warning text-[11px] font-semibold">
                    {t("cov_missing_word")} {missingDirection}
                  </span>
                  <button
                    onClick={() => onQuickAdd?.(mf, mt)}
                    className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-ink text-white hover:bg-ink"
                  >
                    <Plus className="w-3 h-3" />
                    {missingDirection}
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
            <AlertTriangle className="w-3.5 h-3.5 text-danger" />
            <h4 className="text-[12px] font-bold uppercase tracking-wider text-danger">
              {t("cov_missing_heading")} · {coverage.missing.length}
            </h4>
          </div>
          <div className="border border-danger/20 rounded-card bg-danger-soft/30 overflow-hidden">
            {coverage.missing.map(({ from, to }) => (
              <div
                key={`${from}-${to}`}
                className="flex items-center gap-2 px-3 py-2 border-b border-rose-100 last:border-0"
              >
                <span className="text-[12px]">
                  <span className="font-semibold">{from}</span>
                  <span className="text-muted-soft mx-1">↔</span>
                  <span className="font-semibold">{to}</span>
                </span>
                <span className="text-[10px] text-muted italic">{t("cov_missing_hint")}</span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => onQuickAdd?.(from, to)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-ink text-white hover:bg-ink"
                    title={`Add ${from} → ${to}`}
                  >
                    <Plus className="w-3 h-3" />
                    {from}→{to}
                  </button>
                  <button
                    onClick={() => onQuickAdd?.(to, from)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-white text-ink-soft border border-border-soft hover:border-border"
                    title={`Add ${to} → ${from}`}
                  >
                    <Plus className="w-3 h-3" />
                    {to}→{from}
                  </button>
                  <button
                    onClick={() => handleDismiss(from, to)}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-soft hover:text-ink hover:bg-surface-sunk"
                    title={t("cov_hide")}
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
        <section className="rounded-card border border-danger/40 bg-danger-soft px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3.5 h-3.5 text-danger" />
            <h4 className="text-[12px] font-bold uppercase tracking-wider text-danger">
              {t("cov_isolated_heading")} · {coverage.isolated.length}
            </h4>
          </div>
          <div className="text-[12px] text-danger">
            <strong>{coverage.isolated.join(", ")}</strong> {t("cov_isolated_msg")}
          </div>
        </section>
      )}

      {/* === Dismissed toggle === */}
      {coverage.dismissed.length > 0 && (
        <section>
          <button
            onClick={() => setShowDismissed((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-ink"
          >
            {showDismissed ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            {showDismissed ? t("cov_hide") : t("cov_show")} {t("cov_dismissed_word")} ({coverage.dismissed.length})
          </button>
          {showDismissed && (
            <div className="mt-2 border border-border-soft rounded-card bg-surface-soft/60 overflow-hidden">
              {coverage.dismissed.map(({ from, to }) => (
                <div
                  key={`${from}-${to}`}
                  className="flex items-center gap-2 px-3 py-2 border-b border-border-soft last:border-0"
                >
                  <span className="text-[11px] text-ink-soft">
                    {from} ↔ {to}
                  </span>
                  <button
                    onClick={() => {
                      handleUndismiss(from, to);
                      handleUndismiss(to, from);
                    }}
                    className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-ink-soft hover:text-ink hover:bg-white border border-transparent hover:border-border-soft"
                  >
                    <Eye className="w-3 h-3" />
                    {t("cov_restore")}
                  </button>
                </div>
              ))}
              <div className="px-3 py-2 text-right">
                <button
                  onClick={() => {
                    clearDismissed();
                    setDismissedTick((t) => t + 1);
                  }}
                  className="text-[10px] font-semibold text-danger hover:text-danger"
                >
                  {t("cov_clear_dismissed")}
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
          <div className="rounded-card border border-success/20 bg-success-soft p-5 text-center">
            <CheckCircle2 className="w-8 h-8 text-success mx-auto mb-2" />
            <div className="text-[14px] font-bold text-success">{t("cov_full_title")}</div>
            <div className="text-[12px] text-success mt-1">
              {t("cov_full_sub")}
            </div>
          </div>
        )}
    </div>
  );
}

// ----- sub-components -----

function SummaryStat({ label, value, sub, tone, big }) {
  const colors = {
    emerald: "text-success bg-success-soft border-success/20",
    amber: "text-warning bg-warning-soft border-warning/20",
    rose: "text-danger bg-danger-soft border-danger/20",
    slate: "text-ink-soft bg-surface-soft border-border-soft",
  };
  return (
    <div className={`rounded-card border px-4 py-3 ${colors[tone] || colors.slate}`}>
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
    slate: "bg-surface-sunk",
  }[tone];
  return (
    <span className="inline-flex items-center gap-1 text-muted uppercase tracking-wider">
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
        return `${base} bg-rose-300 text-danger hover:bg-rose-400 cursor-pointer`;
      case "dismissed":
        return `${base} bg-surface-sunk text-muted`;
      case "self":
        return `${base} bg-surface-sunk text-muted-soft`;
      default:
        return `${base} bg-surface-sunk text-muted-soft`;
    }
  };

  return (
    <div className="border border-border-soft rounded-card bg-white p-3 overflow-auto">
      <div className="inline-grid gap-0.5 min-w-full"
        style={{ gridTemplateColumns: `minmax(44px, auto) repeat(${currencies.length}, minmax(32px, 1fr))` }}>
        {/* header row */}
        <div />
        {currencies.map((c) => (
          <div key={`h-${c}`} className="text-[9px] font-bold text-ink-soft text-center py-1 truncate">
            {c}
          </div>
        ))}
        {/* body */}
        {currencies.map((from) => (
          <React.Fragment key={`row-${from}`}>
            <div className="text-[9px] font-bold text-ink-soft pr-2 py-1 flex items-center justify-end">
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
