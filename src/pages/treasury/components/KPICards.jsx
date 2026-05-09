// src/pages/treasury/components/KPICards.jsx
import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";

function DeltaBadge({ delta, isPercent }) {
  const { t } = useTranslation();
  if (delta === null || delta === undefined) {
    return <span className="text-slate-400 text-[11px]">{t("tr_kpi_no_baseline")}</span>;
  }
  const positive = delta > 0;
  const negative = delta < 0;
  const Icon = positive ? TrendingUp : negative ? TrendingDown : null;
  const cls = positive ? "text-emerald-600" : negative ? "text-rose-600" : "text-slate-400";
  const sign = positive ? "+" : "";
  const text = isPercent
    ? `${sign}${(delta * 100).toFixed(1)}%`
    : `${sign}${delta}`;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${cls}`}>
      {Icon && <Icon className="w-3 h-3" />}
      {text} {t("tr_kpi_delta_vs_yesterday")}
    </span>
  );
}

function Card({ title, value, delta, isPercent, suffix }) {
  return (
    <div className="bg-white rounded-[14px] border border-slate-200/70 p-4 flex flex-col gap-1.5 min-h-[88px]">
      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{title}</span>
      <span className="text-[20px] font-bold text-slate-900 tabular-nums">
        {value}
        {suffix && <span className="text-[12px] font-semibold text-slate-400 ml-1">{suffix}</span>}
      </span>
      <DeltaBadge delta={delta} isPercent={isPercent} />
    </div>
  );
}

export default function KPICards({ kpis, formatBase }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      <Card
        title={t("tr_kpi_total_balance")}
        value={formatBase(kpis.totalBalance.valueInBase, kpis.baseCurrency)}
        delta={kpis.totalBalance.delta}
        isPercent
      />
      <Card
        title={t("tr_kpi_liabilities")}
        value={formatBase(kpis.liabilities.valueInBase, kpis.baseCurrency)}
        delta={kpis.liabilities.delta}
        isPercent
      />
      <Card
        title={t("tr_kpi_available_funds")}
        value={formatBase(kpis.availableFunds.valueInBase, kpis.baseCurrency)}
        delta={kpis.availableFunds.delta}
        isPercent
      />
      <Card
        title={t("tr_kpi_activity24h")}
        value={kpis.activity24h.count}
        suffix={t("tr_kpi_count_deals")}
        delta={kpis.activity24h.delta}
        isPercent={false}
      />
    </div>
  );
}
