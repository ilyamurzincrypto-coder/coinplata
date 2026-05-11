// src/pages/treasury_v2/tabs/EquityTab.jsx
import React from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { groupByClass, balanceCheckTotals } from "../../../lib/treasury/v2selectors.js";
import ClassSection from "../parts/ClassSection.jsx";
import AccountRow from "../parts/AccountRow.jsx";

export default function EquityTab({ ctx, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const sections = groupByClass(ctx, "equity");
  const totals = balanceCheckTotals(ctx, ctx.officeFilter);
  return (
    <div className="space-y-3">
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
    </div>
  );
}
