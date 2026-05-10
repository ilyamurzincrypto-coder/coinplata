// src/pages/treasury_v2/parts/AccountInlineEntries.jsx
import React from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { accountEntries } from "../../../lib/treasury/v2selectors.js";

export default function AccountInlineEntries({ ctx, accountId, period, onOpenTx }) {
  const { t } = useTranslation();
  const rows = accountEntries(ctx, accountId, 50, period);
  if (rows.length === 0) {
    return <div className="px-6 py-3 text-[12px] text-slate-400">{t("trv2_no_entries")}</div>;
  }
  return (
    <table className="w-full text-[12px] bg-slate-50/60">
      <tbody>
        {rows.map((e) => (
          <tr key={e.id} className="border-t border-slate-100">
            <td className="px-6 py-1.5 text-slate-500 w-24">{new Date(e.createdAt).toISOString().slice(0, 10)}</td>
            <td className="px-2 py-1.5 w-10 font-semibold">{e.direction === "dr" ? t("trv2_col_dr") : t("trv2_col_cr")}</td>
            <td className={`px-2 py-1.5 tabular-nums text-right w-28 ${e.direction === "dr" ? "text-emerald-700" : "text-rose-700"}`}>
              {e.direction === "dr" ? "+" : "−"}{Number(e.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {e.currency}
            </td>
            <td className="px-2 py-1.5 text-slate-400 uppercase tracking-wider w-24">{e.txKind}</td>
            <td className="px-2 py-1.5">
              <button onClick={() => onOpenTx?.(e.txId)} className="text-indigo-600 hover:underline">
                {e.sourceRefId || e.txId.slice(0, 8)} →
              </button>
            </td>
          </tr>
        ))}
        {rows.length === 50 && (
          <tr><td colSpan={5} className="px-6 py-2 text-[11px] text-slate-400">{t("trv2_entries_truncated")}</td></tr>
        )}
      </tbody>
    </table>
  );
}
