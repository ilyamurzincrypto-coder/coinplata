// src/pages/treasury_v2/tabs/LiabilitiesTab.jsx
// «Пассивы» — счета-обязательства по подтипам (customer_liab / partner_liab / unearned / …).
// В шапке — кнопка «+ Счёт в план» (can("accounting","edit")) → ChartAccountModal с
// предвыбранным типом «liability», чтобы можно было добавить счёт в пассивы.
import React, { useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { groupByClass } from "../../../lib/treasury/v2selectors.js";
import ClassSection from "../parts/ClassSection.jsx";
import AccountRow from "../parts/AccountRow.jsx";
import ChartAccountModal from "../parts/ChartAccountModal.jsx";

export default function LiabilitiesTab({ ctx, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const can = useCan();
  const [addOpen, setAddOpen] = useState(false);
  const sections = groupByClass(ctx, "liability");
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-[12px] text-slate-500">{t("trv2_tab_liabilities")}</span>
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
      {addOpen && <ChartAccountModal open defaultType="liability" onClose={() => setAddOpen(false)} />}
    </div>
  );
}
