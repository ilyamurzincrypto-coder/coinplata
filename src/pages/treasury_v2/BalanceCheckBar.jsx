// src/pages/treasury_v2/BalanceCheckBar.jsx
import React from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { useTranslation } from "../../i18n/translations.jsx";

export default function BalanceCheckBar({ totals, formatBase, baseCurrency }) {
  const { t } = useTranslation();
  const ok = totals.identityCheck.ok;
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  const cls = ok ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-rose-50 border-rose-200 text-rose-900";
  return (
    <div className={`sticky bottom-0 px-5 py-2.5 border-t text-[12.5px] font-medium flex items-center gap-3 ${cls}`}>
      <Icon className={`w-4 h-4 shrink-0 ${ok ? "text-emerald-600" : "text-rose-600"}`} />
      <span className="tabular-nums">
        {t("trv2_balance_check")}: {formatBase(totals.assets, baseCurrency)} = {formatBase(totals.liabilities, baseCurrency)} + {formatBase(totals.equity, baseCurrency)}
        {" "}
        {ok ? "✓" : t("trv2_balance_fail").replace("{delta}", formatBase(totals.identityCheck.delta, baseCurrency))}
      </span>
    </div>
  );
}
