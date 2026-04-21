// src/pages/capital/ByOfficeTab.jsx
// Детальная разбивка метрик по офисам: volume, deals profit, income, expense, net.

import React, { useMemo } from "react";
import { Building2 } from "lucide-react";
import { useTransactions } from "../../store/transactions.jsx";
import { useIncomeExpense } from "../../store/incomeExpense.jsx";
import { useRates } from "../../store/rates.jsx";
import { OFFICES, officeName } from "../../store/data.js";
import { fmt, multiplyAmount } from "../../utils/money.js";
import { toISODate } from "../../utils/date.js";
import { inRange } from "../../components/ui/DateRangePicker.jsx";

function toUsd(amount, currency, getRate) {
  if (!amount) return 0;
  if (currency === "USD") return amount;
  return multiplyAmount(amount, getRate(currency, "USD") ?? 0, 2);
}

export default function ByOfficeTab({ range }) {
  const { transactions } = useTransactions();
  const { entries } = useIncomeExpense();
  const { getRate } = useRates();

  const stats = useMemo(() => {
    return OFFICES.map((o) => {
      const tx = transactions.filter(
        (t) => t.officeId === o.id && inRange(toISODate(t.date), range)
      );
      const ie = entries.filter((e) => e.officeId === o.id && inRange(e.date, range));

      const volume = tx.reduce((s, t) => s + toUsd(t.amtIn, t.curIn, getRate), 0);
      const dealsProfit = tx.reduce((s, t) => s + (t.profit || 0), 0);
      const income = ie
        .filter((e) => e.type === "income")
        .reduce((s, e) => s + toUsd(e.amount, e.currency, getRate), 0);
      const expense = ie
        .filter((e) => e.type === "expense")
        .reduce((s, e) => s + toUsd(e.amount, e.currency, getRate), 0);
      const net = dealsProfit + income - expense;

      return { office: o, deals: tx.length, volume, dealsProfit, income, expense, net };
    }).sort((a, b) => b.volume - a.volume);
  }, [transactions, entries, getRate, range]);

  const totalVolume = stats.reduce((s, x) => s + x.volume, 0);

  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <Building2 className="w-4 h-4 text-slate-500" />
        <h2 className="text-[15px] font-semibold tracking-tight">By office</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100 bg-slate-50/40">
              <th className="px-5 py-2.5 font-bold">Office</th>
              <th className="px-3 py-2.5 font-bold text-right">Deals</th>
              <th className="px-3 py-2.5 font-bold text-right">Volume</th>
              <th className="px-3 py-2.5 font-bold text-right">Deals profit</th>
              <th className="px-3 py-2.5 font-bold text-right">Income</th>
              <th className="px-3 py-2.5 font-bold text-right">Expense</th>
              <th className="px-5 py-2.5 font-bold text-right">Net</th>
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
                    ${fmt(x.volume)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <span
                      className={
                        x.dealsProfit >= 0 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"
                      }
                    >
                      {x.dealsProfit >= 0 ? "+" : ""}${fmt(x.dealsProfit)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-emerald-600 font-semibold">
                    {x.income > 0 ? `+$${fmt(x.income)}` : "—"}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-rose-600 font-semibold">
                    {x.expense > 0 ? `−$${fmt(x.expense)}` : "—"}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-md text-[13px] font-bold ${
                        x.net >= 0
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                          : "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
                      }`}
                    >
                      {x.net >= 0 ? "+" : ""}${fmt(x.net)}
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
