// src/pages/treasury/components/CurrencyBreakdownTable.jsx
import React from "react";
import { useTranslation } from "../../../i18n/translations.jsx";

export default function CurrencyBreakdownTable({ rows, formatBase, baseCurrency }) {
  const { t } = useTranslation();
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-[13px] font-bold text-slate-900">{t("tr_currency_section_title")}</h3>
      </header>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            <th className="text-left px-4 py-2">{t("tr_currency_col_code")}</th>
            <th className="text-right px-3 py-2">{t("tr_currency_col_total")}</th>
            <th className="text-right px-3 py-2">{t("tr_currency_col_in_base")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-400">—</td></tr>
          )}
          {rows.map((row) => (
            <tr key={row.currency} className="border-t border-slate-100">
              <td className="px-4 py-2.5 font-semibold text-slate-900">{row.currency}</td>
              <td className="text-right px-3 py-2.5 tabular-nums">
                {row.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </td>
              <td className="text-right px-3 py-2.5 tabular-nums font-semibold">
                {formatBase(row.totalInBase, baseCurrency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
