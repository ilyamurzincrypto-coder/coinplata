// src/pages/capital/ByOfficeTab.jsx
// Детальная разбивка метрик по офисам: volume, deals profit, income, expense, net.
// Все суммы в base currency.

import React, { useMemo } from "react";
import { Building2 } from "lucide-react";
import { useTransactions } from "../../store/transactions.jsx";
import { useIncomeExpense } from "../../store/incomeExpense.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { useTranslation } from "../../i18n/translations.jsx";
import { OFFICES, officeName } from "../../store/data.js";
import { fmt, curSymbol } from "../../utils/money.js";
import { toISODate } from "../../utils/date.js";
import { inRange } from "../../components/ui/DateRangePicker.jsx";

export default function ByOfficeTab({ range }) {
  const { t } = useTranslation();
  const { transactions } = useTransactions();
  const { entries } = useIncomeExpense();
  const { base, toBase } = useBaseCurrency();
  const sym = curSymbol(base);

  const stats = useMemo(() => {
    return OFFICES.map((o) => {
      const tx = transactions.filter(
        (t) => t.officeId === o.id && inRange(toISODate(t.date), range)
      );
      const ie = entries.filter((e) => e.officeId === o.id && inRange(e.date, range));

      const volume = tx.reduce((s, t) => s + toBase(t.amtIn, t.curIn), 0);
      // tx.profit в USD — нормализуем в base
      const dealsProfit = tx.reduce((s, t) => s + toBase(t.profit || 0, "USD"), 0);
      const income = ie
        .filter((e) => e.type === "income")
        .reduce((s, e) => s + toBase(e.amount, e.currency), 0);
      const expense = ie
        .filter((e) => e.type === "expense")
        .reduce((s, e) => s + toBase(e.amount, e.currency), 0);
      const net = dealsProfit + income - expense;

      return { office: o, deals: tx.length, volume, dealsProfit, income, expense, net };
    }).sort((a, b) => b.volume - a.volume);
  }, [transactions, entries, toBase, range]);

  const totalVolume = stats.reduce((s, x) => s + x.volume, 0);

  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <Building2 className="w-4 h-4 text-slate-500" />
        <h2 className="text-[15px] font-semibold tracking-tight">{t("tab_by_office")}</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100 bg-slate-50/40">
              <th className="px-5 py-2.5 font-bold">{t("col_office")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("col_deals")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("col_volume")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("kpi_deals_profit")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("ie_income")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("ie_expense")}</th>
              <th className="px-5 py-2.5 font-bold text-right">{t("col_net")}</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((x) => {
              const pct = totalVolume > 0 ? (x.volume / totalVolume) * 100 : 0;
              return (
                <tr
                  key={x.office.id}
                  className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                >
                  <td className="px-5 py-3">
                    <div className="font-semibold text-slate-900">{officeName(x.office.id)}</div>
                    <div className="mt-1 h-1 bg-slate-100 rounded-full overflow-hidden w-40">
                      <div
                        className="h-full bg-slate-900 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
                      {pct.toFixed(1)}%
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">{x.deals}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                    {sym}{fmt(x.volume, base)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <span
                      className={
                        x.dealsProfit >= 0 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"
                      }
                    >
                      {x.dealsProfit >= 0 ? "+" : ""}{sym}{fmt(x.dealsProfit, base)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-emerald-600 font-semibold">
                    {x.income > 0 ? `+${sym}${fmt(x.income, base)}` : "—"}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-rose-600 font-semibold">
                    {x.expense > 0 ? `−${sym}${fmt(x.expense, base)}` : "—"}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-md text-[13px] font-bold ${
                        x.net >= 0
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                          : "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
                      }`}
                    >
                      {x.net >= 0 ? "+" : ""}{sym}{fmt(x.net, base)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
