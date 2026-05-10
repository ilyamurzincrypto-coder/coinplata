// src/pages/treasury_v2/tabs/EquityTab.jsx
import React from "react";
import { groupByClass, balanceCheckTotals } from "../../../lib/treasury/v2selectors.js";
import ClassSection from "../parts/ClassSection.jsx";
import AccountRow from "../parts/AccountRow.jsx";

export default function EquityTab({ ctx, formatBase, baseCurrency, onOpenTx }) {
  const sections = groupByClass(ctx, "equity");
  const totals = balanceCheckTotals(ctx, ctx.officeFilter);
  return (
    <div className="space-y-3">
      {sections.length === 0 ? (
        <div className="p-5 text-slate-400 text-[13px]">Нет счетов капитала.</div>
      ) : (
        sections.map((s) => (
          <ClassSection key={s.subtype} labelKey={s.labelKey} totalInBase={s.totalInBase} formatBase={formatBase} baseCurrency={baseCurrency}>
            {s.accounts.map((a, i) => (
              <AccountRow key={`${a.accountId}-${a.currency}-${a.clientId || ""}-${a.partnerId || ""}-${i}`} account={a} ctx={ctx} formatBase={formatBase} baseCurrency={baseCurrency} onOpenTx={onOpenTx} />
            ))}
          </ClassSection>
        ))
      )}
      <div className={`rounded-[10px] px-4 py-3 text-[12.5px] font-medium ${totals.identityCheck.ok ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>
        Активы {formatBase(totals.assets, baseCurrency)} = Пассивы {formatBase(totals.liabilities, baseCurrency)} + Капитал {formatBase(totals.equity, baseCurrency)} {totals.identityCheck.ok ? "✓" : `(delta ${formatBase(totals.identityCheck.delta, baseCurrency)})`}
      </div>
    </div>
  );
}
