// src/components/cashier/LivePreview.jsx
// Footer-bar inline summary deal info: direction, totals, margin breakdown,
// warnings (overdraft / no_commission / kassa shortage).

import React, { useMemo } from "react";
import { ArrowRight, AlertTriangle } from "lucide-react";
import { fmt, curSymbol } from "../../utils/money.js";
import { useRates } from "../../store/rates.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { useTranslation } from "../../i18n/translations.jsx";

export default function LivePreview({
  legs = [],
  totalIn = {},
  totalOut = {},
  conditions = {},
  hasOverdraft = false,
  hasShortage = false,
}) {
  const { t } = useTranslation();
  const { getRate } = useRates();
  const { base, toBase } = useBaseCurrency();

  // ── Direction summary "+1000 USDT → −33000 TRY" ──
  const inSummary = formatSummary(totalIn, "+");
  const outSummary = formatSummary(totalOut, "−");

  // ── Margin (USD по convertions) ──
  // Margin USD ≈ (sum OUT в base − sum IN в base) с учётом ratesActual.
  // Грубо: для каждой OUT-leg: (выдали - mid_value_of_in_amount) в base.
  // Это approximation — точный расчёт сделает RPC, мы показываем live preview.
  const marginInfo = useMemo(() => {
    const outLegs = legs.filter((l) => l.side === "out");
    const inLegs = legs.filter((l) => l.side === "in");
    if (outLegs.length === 0 || inLegs.length === 0) return null;

    let usdValueIn = 0;
    for (const l of inLegs) {
      const amt = Number(l.amount);
      if (Number.isFinite(amt) && amt > 0 && l.currency) {
        usdValueIn += toBase(amt, l.currency);
      }
    }
    let usdValueOut = 0;
    for (const l of outLegs) {
      const amt = Number(l.amount);
      if (Number.isFinite(amt) && amt > 0 && l.currency) {
        usdValueOut += toBase(amt, l.currency);
      }
    }
    if (usdValueIn === 0) return null;
    const marginUsd = usdValueIn - usdValueOut;
    const marginPct = (marginUsd / usdValueIn) * 100;
    return {
      marginUsd,
      marginPct,
      sign: marginUsd >= 0 ? "+" : "",
    };
  }, [legs, toBase]);

  const noCommission = (conditions.fees || []).includes("no_commission");

  return (
    <div className="flex items-center gap-3 flex-wrap text-caption">
      {/* Direction */}
      <div className="inline-flex items-center gap-1.5 text-ink-soft font-semibold tabular-nums">
        <span className="text-success">{inSummary || "—"}</span>
        <ArrowRight className="w-3.5 h-3.5 text-muted-soft" />
        <span className="text-danger">{outSummary || "—"}</span>
      </div>

      {/* Margin */}
      {marginInfo && !noCommission && (
        <div className="inline-flex items-center gap-1 text-ink-soft">
          <span className="text-tiny uppercase tracking-wider text-muted-soft">margin:</span>
          <span
            className={
              "tabular-nums font-semibold " +
              (marginInfo.marginUsd > 0
                ? "text-success"
                : marginInfo.marginUsd < 0
                  ? "text-danger"
                  : "text-muted")
            }
          >
            {marginInfo.sign}
            {curSymbol(base)}
            {fmt(Math.abs(marginInfo.marginUsd), base)}
            <span className="text-muted-soft font-normal ml-1">
              ({marginInfo.sign}{Math.abs(marginInfo.marginPct).toFixed(2)}%)
            </span>
          </span>
        </div>
      )}

      {/* Warnings */}
      {noCommission && (
        <span className="inline-flex items-center gap-1 text-warning font-semibold">
          <AlertTriangle className="w-3 h-3" />
          {t("conditions_chip_no_commission")}
        </span>
      )}
      {hasOverdraft && (
        <span className="inline-flex items-center gap-1 text-danger font-semibold">
          <AlertTriangle className="w-3 h-3" />
          overdraft
        </span>
      )}
      {hasShortage && (
        <span className="inline-flex items-center gap-1 text-danger font-semibold">
          <AlertTriangle className="w-3 h-3" />
          kassa empty
        </span>
      )}
    </div>
  );
}

function formatSummary(totals, sign) {
  const entries = Object.entries(totals).filter(([, amt]) => Number(amt) > 0);
  if (entries.length === 0) return "";
  return entries
    .map(([cur, amt]) => `${sign}${fmt(amt, cur)} ${cur}`)
    .join(", ");
}
