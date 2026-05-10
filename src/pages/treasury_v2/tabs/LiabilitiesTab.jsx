// src/pages/treasury_v2/tabs/LiabilitiesTab.jsx
import React from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { groupByClass } from "../../../lib/treasury/v2selectors.js";
import ClassSection from "../parts/ClassSection.jsx";
import AccountRow from "../parts/AccountRow.jsx";

export default function LiabilitiesTab({ ctx, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const sections = groupByClass(ctx, "liability");
  if (sections.length === 0) {
    return <div className="p-5 text-slate-400 text-[13px]">{t("trv2_no_accounts")}</div>;
  }
  return (
    <div className="space-y-3">
      {sections.map((s) => (
        <ClassSection key={s.subtype} labelKey={s.labelKey} totalInBase={s.totalInBase} formatBase={formatBase} baseCurrency={baseCurrency}>
          {s.accounts.map((a) => (
            <AccountRow key={`${a.accountId}-${a.currency}`} account={a} ctx={ctx} formatBase={formatBase} baseCurrency={baseCurrency} onOpenTx={onOpenTx} />
          ))}
        </ClassSection>
      ))}
    </div>
  );
}
