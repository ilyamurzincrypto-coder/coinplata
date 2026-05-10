// src/pages/treasury_v2/tabs/AssetsTab.jsx
import React from "react";
import { groupByClass } from "../../../lib/treasury/v2selectors.js";
import ClassSection from "../parts/ClassSection.jsx";
import AccountRow from "../parts/AccountRow.jsx";

export default function AssetsTab({ ctx, formatBase, baseCurrency, onOpenTx }) {
  const sections = groupByClass(ctx, "asset");
  if (sections.length === 0) {
    return <div className="p-5 text-slate-400 text-[13px]">Нет счетов активов.</div>;
  }
  return (
    <div className="space-y-3">
      {sections.map((s) => (
        <ClassSection key={s.subtype} labelKey={s.labelKey} totalInBase={s.totalInBase} formatBase={formatBase} baseCurrency={baseCurrency}>
          {s.accounts.map((a, i) => (
            <AccountRow key={`${a.accountId}-${a.currency}-${a.clientId || ""}-${a.partnerId || ""}-${i}`} account={a} ctx={ctx} formatBase={formatBase} baseCurrency={baseCurrency} onOpenTx={onOpenTx} />
          ))}
        </ClassSection>
      ))}
    </div>
  );
}
