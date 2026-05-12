// src/pages/treasury_v2/tabs/EquityTab.jsx
// «Капитал» — счета капитала по подтипам (opening_balance / retained_earnings /
// fx_clearing / owner_contribution / …) + проверка балансового равенства.
// В шапке — кнопка «+ Счёт в план» (can("accounting","edit")) → ChartAccountModal
// с предвыбранным типом «equity».
import React, { useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { groupByClass, balanceCheckTotals } from "../../../lib/treasury/v2selectors.js";
import ClassSection from "../parts/ClassSection.jsx";
import AccountRow from "../parts/AccountRow.jsx";
import ChartAccountModal from "../parts/ChartAccountModal.jsx";

export default function EquityTab({ ctx, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const can = useCan();
  const [addOpen, setAddOpen] = useState(false);
  const sections = groupByClass(ctx, "equity");
  const totals = balanceCheckTotals(ctx, ctx.officeFilter);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-[12px] text-slate-500">{t("trv2_tab_equity")}</span>
        {can("accounting", "edit") && (
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-slate-900 text-white text-[12.5px] font-semibold hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            {t("trv2_chart_add_btn")}
          </button>
        )}
      </div>
      {sections.length === 0 ? (
        <div className="p-5 text-slate-400 text-[13px]">{t("trv2_no_accounts")}</div>
      ) : (
        sections.map((s) => (
          <ClassSection key={s.subtype} labelKey={s.labelKey} totalInBase={s.totalInBase} formatBase={formatBase} baseCurrency={baseCurrency}>
            {s.accounts.map((a) => (
              <AccountRow key={`${a.accountId}-${a.currency}`} account={a} ctx={ctx} formatBase={formatBase} baseCurrency={baseCurrency} onOpenTx={onOpenTx} />
            ))}
          </ClassSection>
        ))
      )}
      <div className={`rounded-[10px] px-4 py-3 text-[12.5px] font-medium ${totals.identityCheck.ok ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>
        {t("trv2_tab_equity")} {formatBase(totals.equity, baseCurrency)}
        {Math.abs(totals.pnl || 0) > 0.005 && (
          <span className="opacity-70"> ({t("trv2_balance_incl_pnl")} {formatBase(totals.pnl, baseCurrency)})</span>
        )}
        {" = "}{t("trv2_tab_assets")} {formatBase(totals.assets, baseCurrency)} − {t("trv2_tab_liabilities")} {formatBase(totals.liabilities, baseCurrency)} {totals.identityCheck.ok ? "✓" : `(Δ ${formatBase(totals.identityCheck.delta, baseCurrency)})`}
      </div>
      {addOpen && <ChartAccountModal open defaultType="equity" onClose={() => setAddOpen(false)} />}
    </div>
  );
}
