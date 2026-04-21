// src/pages/capital/OverviewTab.jsx
// Общая сводка: KPIs + быстрая разбивка по офисам

import React, { useMemo } from "react";
import { Briefcase, TrendingUp, Receipt } from "lucide-react";
import { useTransactions } from "../../store/transactions.jsx";
import { useIncomeExpense } from "../../store/incomeExpense.jsx";
import { useRates } from "../../store/rates.jsx";
import { OFFICES, officeName } from "../../store/data.js";
import { fmt, multiplyAmount } from "../../utils/money.js";
import { toISODate } from "../../utils/date.js";
import { inRange } from "../../components/ui/DateRangePicker.jsx";

// Пересчёт суммы в USD
function toUsd(amount, currency, getRate) {
  if (!amount) return 0;
  if (currency === "USD") return amount;
  const r = getRate(currency, "USD") ?? 0;
  return multiplyAmount(amount, r, 2);
}

export default function OverviewTab({ range }) {
  const { transactions } = useTransactions();
  const { entries } = useIncomeExpense();
  const { getRate } = useRates();

  const { txVolume, txProfit, txCount, income, expense, netProfit } = useMemo(() => {
    const scopedTx = transactions.filter((tx) => inRange(toISODate(tx.date), range));
    const scopedIE = entries.filter((e) => inRange(e.date, range));

    const txVolume = scopedTx.reduce((s, tx) => s + toUsd(tx.amtIn, tx.curIn, getRate), 0);
    const txProfit = scopedTx.reduce((s, tx) => s + (tx.profit || 0), 0);

    const income = scopedIE
      .filter((e) => e.type === "income")
      .reduce((s, e) => s + toUsd(e.amount, e.currency, getRate), 0);

    const expense = scopedIE
      .filter((e) => e.type === "expense")
      .reduce((s, e) => s + toUsd(e.amount, e.currency, getRate), 0);

    const netProfit = txProfit + income - expense;

    return {
      txVolume,
      txProfit,
      txCount: scopedTx.length,
      income,
      expense,
      netProfit,
    };
  }, [transactions, entries, getRate, range]);

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Exchange volume" value={`$${fmt(txVolume)}`} sub={`${txCount} deals`} icon={<Briefcase className="w-3.5 h-3.5" />} />
        <KPI
          label="Deals profit"
          value={`${txProfit >= 0 ? "+" : ""}$${fmt(txProfit)}`}
          accent={txProfit >= 0 ? "emerald" : "rose"}
          icon={<TrendingUp className="w-3.5 h-3.5" />}
        />
        <KPI
          label="Income / Expense"
          value={`+$${fmt(income)} / −$${fmt(expense)}`}
          icon={<Receipt className="w-3.5 h-3.5" />}
        />
        <KPI
          label="Net profit"
          value={`${netProfit >= 0 ? "+" : ""}$${fmt(netProfit)}`}
          accent={netProfit >= 0 ? "emerald" : "rose"}
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          big
        />
      </div>

      {/* Quick office breakdown */}
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-slate-500" />
          <h2 className="text-[15px] font-semibold tracking-tight">Office breakdown</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-5">
          {OFFICES.map((o) => {
            const officeTx = transactions.filter(
              (tx) => tx.officeId === o.id && inRange(toISODate(tx.date), range)
            );
            const volume = officeTx.reduce((s, tx) => s + toUsd(tx.amtIn, tx.curIn, getRate), 0);
            const profit = officeTx.reduce((s, tx) => s + (tx.profit || 0), 0);
            const pct = txVolume > 0 ? (volume / txVolume) * 100 : 0;
            return (
              <div key={o.id} className="bg-slate-50/60 border border-slate-200 rounded-[12px] p-4">
                <div className="text-[12px] font-semibold text-slate-500 mb-0.5">{officeName(o.id)}</div>
                <div className="text-[22px] font-bold tabular-nums tracking-tight text-slate-900">
                  ${fmt(volume)}
                </div>
                <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                  {officeTx.length} deals · profit{" "}
                  <span className={profit >= 0 ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>
                    ${fmt(profit)}
                  </span>
                </div>
                <div className="mt-3 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-slate-900 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-[10px] text-slate-400 mt-1 font-medium">{pct.toFixed(1)}%</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function KPI({ label, value, sub, accent, icon, big }) {
  const accentCls =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "rose"
      ? "text-rose-700"
      : "text-slate-900";
  return (
    <div className={`bg-white border border-slate-200 rounded-[12px] p-4 ${big ? "md:col-span-1 ring-2 ring-emerald-100" : ""}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-[22px] font-bold tabular-nums tracking-tight ${accentCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">{sub}</div>}
    </div>
  );
}
