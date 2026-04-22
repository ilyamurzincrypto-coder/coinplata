// src/pages/capital/CashflowTab.jsx
// ДДС: доходы / расходы / чистая прибыль в разрезе периода.
// Показывает breakdown по категориям + простой bar chart.

import React, { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useTransactions } from "../../store/transactions.jsx";
import { useIncomeExpense } from "../../store/incomeExpense.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { fmt, curSymbol } from "../../utils/money.js";
import { toISODate } from "../../utils/date.js";
import { inRange } from "../../components/ui/DateRangePicker.jsx";

export default function CashflowTab({ range }) {
  const { transactions } = useTransactions();
  const { entries } = useIncomeExpense();
  const { base, toBase } = useBaseCurrency();
  const sym = curSymbol(base);

  const data = useMemo(() => {
    const scopedTx = transactions.filter((tx) => inRange(toISODate(tx.date), range));
    const scopedIE = entries.filter((e) => inRange(e.date, range));

    // tx.profit хранится в USD (выбор менеджера при создании сделки).
    // Конвертируем в base для отображения.
    const dealsProfit = scopedTx.reduce((s, tx) => s + toBase(tx.profit || 0, "USD"), 0);

    const incomeByCat = {};
    const expenseByCat = {};
    let incomeTotal = 0;
    let expenseTotal = 0;

    scopedIE.forEach((e) => {
      const v = toBase(e.amount, e.currency);
      if (e.type === "income") {
        incomeByCat[e.category] = (incomeByCat[e.category] || 0) + v;
        incomeTotal += v;
      } else {
        expenseByCat[e.category] = (expenseByCat[e.category] || 0) + v;
        expenseTotal += v;
      }
    });

    const net = dealsProfit + incomeTotal - expenseTotal;

    return {
      dealsProfit,
      incomeByCat: Object.entries(incomeByCat).sort((a, b) => b[1] - a[1]),
      expenseByCat: Object.entries(expenseByCat).sort((a, b) => b[1] - a[1]),
      incomeTotal,
      expenseTotal,
      net,
    };
  }, [transactions, entries, toBase, range]);

  const { dealsProfit, incomeByCat, expenseByCat, incomeTotal, expenseTotal, net } = data;
  const maxBar = Math.max(dealsProfit + incomeTotal, expenseTotal, 1);


  return (
    <div className="space-y-4">
      {/* Summary bars */}
      <section className="bg-white rounded-[14px] border border-slate-200/70 p-5">
        <h2 className="text-[15px] font-semibold tracking-tight mb-4">Period summary</h2>

        <div className="space-y-3">
          <FlowBar
            label="Deals profit"
            value={dealsProfit}
            max={maxBar}
            color="emerald"
            icon={<TrendingUp className="w-3.5 h-3.5" />}
            sym={sym}
            base={base}
          />
          <FlowBar
            label="Other income"
            value={incomeTotal}
            max={maxBar}
            color="sky"
            icon={<TrendingUp className="w-3.5 h-3.5" />}
            sym={sym}
            base={base}
          />
          <FlowBar
            label="Expenses"
            value={expenseTotal}
            max={maxBar}
            color="rose"
            icon={<TrendingDown className="w-3.5 h-3.5" />}
            sym={sym}
            base={base}
          />
          <div className="h-px bg-slate-200 my-2" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
              <Minus className="w-3.5 h-3.5 text-slate-500" />
              Net profit
            </div>
            <div
              className={`text-[22px] font-bold tabular-nums tracking-tight ${
                net >= 0 ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {net >= 0 ? "+" : ""}{sym}{fmt(net, base)}
            </div>
          </div>
        </div>
      </section>

      {/* Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BreakdownCard
          title="Income by category"
          rows={incomeByCat}
          total={incomeTotal}
          color="emerald"
          extraTop={dealsProfit > 0 ? ["Deals profit", dealsProfit] : null}
          sym={sym}
          base={base}
        />
        <BreakdownCard
          title="Expense by category"
          rows={expenseByCat}
          total={expenseTotal}
          color="rose"
          sym={sym}
          base={base}
        />
      </div>
    </div>
  );
}

function FlowBar({ label, value, max, color, icon, sym, base }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const colorClass = {
    emerald: "bg-emerald-500",
    sky: "bg-sky-500",
    rose: "bg-rose-500",
  }[color];
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-slate-700">
          {icon}
          {label}
        </div>
        <span className="text-[13px] font-bold tabular-nums text-slate-900">{sym}{fmt(value, base)}</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${colorClass} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BreakdownCard({ title, rows, total, color, extraTop, sym, base }) {
  const dotColor = color === "emerald" ? "bg-emerald-500" : "bg-rose-500";
  return (
    <div className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
        <span className="text-[12px] font-bold tabular-nums text-slate-700">{sym}{fmt(total, base)}</span>
      </div>
      <div className="p-5">
        {extraTop && (
          <div className="flex items-center justify-between py-1.5 border-b border-dashed border-slate-200 mb-2">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${dotColor}`} />
              <span className="text-[12px] text-slate-700 font-medium italic">{extraTop[0]}</span>
            </div>
            <span className="text-[13px] font-semibold tabular-nums text-slate-700">
              {sym}{fmt(extraTop[1], base)}
            </span>
          </div>
        )}
        {rows.length === 0 && !extraTop && (
          <div className="text-[12px] text-slate-400 italic text-center py-6">No entries</div>
        )}
        {rows.map(([cat, amount]) => (
          <div key={cat} className="flex items-center justify-between py-1.5">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${dotColor}`} />
              <span className="text-[12px] text-slate-700">{cat}</span>
            </div>
            <span className="text-[13px] font-semibold tabular-nums text-slate-900">{sym}{fmt(amount, base)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
