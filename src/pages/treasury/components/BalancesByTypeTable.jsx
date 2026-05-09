// src/pages/treasury/components/BalancesByTypeTable.jsx
import React from "react";
import { Banknote, Landmark, Coins, Layers } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";

const TYPE_ICON = { cash: Banknote, bank: Landmark, crypto: Coins, other: Layers };
const TYPE_LABEL_KEY = {
  cash: "tr_account_type_cash",
  bank: "tr_account_type_bank",
  crypto: "tr_account_type_crypto",
  other: "tr_account_type_other",
};

export default function BalancesByTypeTable({ rows, formatBase, baseCurrency }) {
  const { t } = useTranslation();
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-[13px] font-bold text-slate-900">{t("tr_balances_section_title")}</h3>
      </header>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            <th className="text-left px-4 py-2">{t("tr_balances_col_type")}</th>
            <th className="text-right px-3 py-2">{t("tr_balances_col_count")}</th>
            <th className="text-right px-3 py-2">{t("tr_balances_col_available")}</th>
            <th className="text-right px-3 py-2">{t("tr_balances_col_reserved")}</th>
            <th className="text-right px-3 py-2">{t("tr_balances_col_total_in_base")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-slate-400">—</td>
            </tr>
          )}
          {rows.map((row) => {
            const Icon = TYPE_ICON[row.type] || Layers;
            return (
              <tr key={row.type} className="border-t border-slate-100">
                <td className="px-4 py-2.5 inline-flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-slate-400" />
                  <span className="font-semibold text-slate-900">{t(TYPE_LABEL_KEY[row.type] || "tr_account_type_other")}</span>
                </td>
                <td className="text-right px-3 py-2.5 tabular-nums text-slate-500">{row.count}</td>
                <td className="text-right px-3 py-2.5 tabular-nums">{formatBase(row.available, baseCurrency)}</td>
                <td className="text-right px-3 py-2.5 tabular-nums text-slate-500">{formatBase(row.reserved, baseCurrency)}</td>
                <td className="text-right px-3 py-2.5 tabular-nums font-semibold">{formatBase(row.totalInBase, baseCurrency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
