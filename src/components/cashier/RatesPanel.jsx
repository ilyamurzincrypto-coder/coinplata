// src/components/cashier/RatesPanel.jsx
// Replacement для legacy RatesSidebar в этап 4.
//
// Layout: header (filter + refresh + last-updated) + grid currencies × currencies.
// Click на rate cell → onPickRate(from, to, rate) callback (обычно fills
// rate в active OUT leg).
//
// Rates loaded via useRates() hook (already polling в RatesProvider).

import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, ChevronDown } from "lucide-react";
import { useRates } from "../../store/rates.jsx";
import { useTranslation } from "../../i18n/translations.jsx";

const FIAT_PRIORITY = ["USD", "EUR", "TRY", "RUB", "GBP", "CHF"];
const CRYPTO_PRIORITY = ["USDT", "USDC", "BTC", "ETH"];

export default function RatesPanel({
  officeId,
  onPickRate,            // (from, to, rate) → void; если null → click no-op
  activeLegSummary,      // string | null — что отображается в hint "fill rate в X→Y"
}) {
  const { t } = useTranslation();
  const { getRate, rates } = useRates();
  const [filter, setFilter] = useState("local"); // local | global
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(() => Date.now());

  // Triggered refresh — RatesProvider сам подгружает по mount + onDataBump.
  // Здесь просто bump local timestamp для UI feedback.
  const handleRefresh = () => {
    setRefreshTick((v) => v + 1);
    setLastUpdated(Date.now());
  };

  useEffect(() => {
    setLastUpdated(Date.now());
  }, [rates]);

  // ── Детектируем используемые валюты ──
  const currencies = useMemo(() => {
    const seen = new Set();
    Object.keys(rates || {}).forEach((k) => {
      const [from, to] = k.split("_");
      if (from) seen.add(from);
      if (to) seen.add(to);
    });
    // Sort: priority first, потом alphabetic
    const list = Array.from(seen);
    return list.sort((a, b) => priorityIndex(a) - priorityIndex(b));
  }, [rates]);

  const minutesAgo = Math.max(0, Math.floor((Date.now() - lastUpdated) / 60000));

  return (
    <aside
      className="bg-white border border-border-soft rounded-[var(--radius-section)] flex flex-col"
      style={{ width: "var(--rates-panel-width)", maxHeight: 480 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-soft bg-surface-soft/50">
        <span className="text-label flex-1">{t("rates_title")}</span>

        {/* Filter dropdown */}
        <div className="relative">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="appearance-none bg-white border border-border-soft rounded-[var(--radius-cell)] pl-2 pr-6 py-0.5 text-tiny font-semibold cursor-pointer outline-none focus:ring-1 focus:ring-accent/20"
          >
            <option value="local">{t("rates_filter_local")}</option>
            <option value="global">{t("rates_filter_global")}</option>
          </select>
          <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-soft pointer-events-none" />
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          title={t("rates_refresh")}
          className="p-1 text-muted hover:bg-surface-sunk rounded"
        >
          <RefreshCw className="w-3 h-3" />
        </button>

        <span className="text-tiny text-muted-soft tabular-nums">
          {minutesAgo === 0 ? "now" : t("rates_updated_ago").replace("{{n}}", String(minutesAgo))}
        </span>
      </div>

      {/* Active leg hint */}
      {onPickRate && (
        <div
          className="px-3 py-1.5 text-tiny text-muted border-b border-border-soft bg-surface-soft/30"
        >
          {activeLegSummary || t("rates_no_active_leg")}
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        {currencies.length === 0 ? (
          <div className="px-3 py-6 text-center text-hint">{t("rates_empty")}</div>
        ) : (
          <RatesGrid
            currencies={currencies}
            getRate={getRate}
            officeId={filter === "local" ? officeId : null}
            onPickRate={onPickRate}
            refreshTick={refreshTick}
          />
        )}
      </div>
    </aside>
  );
}

function priorityIndex(currency) {
  let idx = FIAT_PRIORITY.indexOf(currency);
  if (idx >= 0) return idx;
  idx = CRYPTO_PRIORITY.indexOf(currency);
  if (idx >= 0) return 100 + idx;
  return 1000;
}

function RatesGrid({ currencies, getRate, officeId, onPickRate }) {
  // Простая визуализация: text-table из base→quote rates.
  // Каждая row = base currency. Каждая column = quote currency.
  return (
    <table className="w-full text-tiny tabular-nums">
      <thead>
        <tr className="bg-surface-soft/40 text-muted-soft">
          <th className="text-left px-2 py-1 font-semibold uppercase tracking-wider"></th>
          {currencies.map((c) => (
            <th key={c} className="text-right px-1.5 py-1 font-bold">{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {currencies.map((from) => (
          <tr key={from} className="border-t border-border-soft">
            <td className="px-2 py-1 font-bold text-ink-soft">{from}</td>
            {currencies.map((to) => {
              if (from === to) {
                return (
                  <td key={to} className="text-right px-1.5 py-1 text-muted-soft">—</td>
                );
              }
              const rate = getRate(from, to, officeId);
              return (
                <td key={to} className="text-right p-0">
                  <RateCell
                    from={from}
                    to={to}
                    rate={rate}
                    onPick={onPickRate}
                  />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RateCell({ from, to, rate, onPick }) {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) {
    return (
      <span className="block px-1.5 py-1 text-muted-soft">—</span>
    );
  }
  const formatted = formatRate(rate);
  if (!onPick) {
    return (
      <span className="block px-1.5 py-1 text-ink-soft tabular-nums">{formatted}</span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onPick(from, to, rate)}
      className="block w-full px-1.5 py-1 text-right text-ink-soft hover:bg-accent-bg hover:text-accent cursor-pointer tabular-nums focus:outline-none focus:bg-accent-bg"
      title={`${from} → ${to} · ${formatted}`}
    >
      {formatted}
    </button>
  );
}

function formatRate(r) {
  if (r >= 100) return r.toFixed(2);
  if (r >= 1) return r.toFixed(4);
  if (r >= 0.01) return r.toFixed(5);
  return r.toFixed(8);
}
