// src/pages/treasury_v2/parts/TransactionEntries.jsx
import React from "react";
import { useTranslation } from "../../../i18n/translations.jsx";

export default function TransactionEntries({ entries }) {
  const { t } = useTranslation();
  // The Dr=Cr informational check only makes sense within a single currency — an FX
  // deal crosses currencies and balances in base terms, not in either native amount.
  const singleCcy = new Set(entries.map((e) => e.currency)).size === 1;
  const drSum = entries.filter((e) => e.direction === "dr").reduce((s, e) => s + e.amount, 0);
  const crSum = entries.filter((e) => e.direction === "cr").reduce((s, e) => s + e.amount, 0);
  const balanced = singleCcy && Math.abs(drSum - crSum) < 0.01;
  return (
    <div className="px-6 py-2">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-slate-400 text-[10px] uppercase tracking-wider">
            <th className="text-left px-2 py-1">{t("trv2_col_dr")}/{t("trv2_col_cr")}</th>
            <th className="text-left px-2 py-1">{t("trv2_col_account")}</th>
            <th className="text-right px-2 py-1">{t("trv2_col_amount")}</th>
            <th className="text-left px-2 py-1">{t("trv2_col_currency")}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-slate-100">
              <td className={`px-2 py-1 font-semibold ${e.direction === "dr" ? "text-emerald-700" : "text-rose-700"}`}>{e.direction === "dr" ? t("trv2_col_dr") : t("trv2_col_cr")}</td>
              <td className="px-2 py-1"><span className="font-mono text-slate-400 mr-1.5">{e.accountCode}</span>{e.accountName}</td>
              <td className="px-2 py-1 text-right tabular-nums">{Number(e.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
              <td className="px-2 py-1 text-slate-500">{e.currency}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={`text-[11px] mt-1 ${balanced ? "text-emerald-600" : "text-slate-400"}`}>
        {singleCcy ? `Σ Dr ${balanced ? "=" : "≠"} Σ Cr ${balanced ? "✓" : ""}` : "multi-currency"}
      </div>
    </div>
  );
}
