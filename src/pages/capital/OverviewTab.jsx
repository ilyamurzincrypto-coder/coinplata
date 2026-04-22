// src/pages/capital/OverviewTab.jsx
// Общая сводка: KPIs + быстрая разбивка по офисам. Все суммы в base currency.

import React, { useMemo } from "react";
import { Briefcase, TrendingUp, Receipt } from "lucide-react";
import { useTransactions } from "../../store/transactions.jsx";
import { useIncomeExpense } from "../../store/incomeExpense.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { useTranslation } from "../../i18n/translations.jsx";
import { OFFICES, officeName } from "../../store/data.js";
import { fmt, curSymbol } from "../../utils/money.js";
import { toISODate } from "../../utils/date.js";
import { inRange } from "../../components/ui/DateRangePicker.jsx";

export default function OverviewTab({ range }) {
  const { t } = useTranslation();
  const { transactions } = useTransactions();
  const { entries } = useIncomeExpense();
  const { base, toBase } = useBaseCurrency();

  const { txVolume, txProfit, txCount, income, expense, netProfit } = useMemo(() => {
    const scopedTx = transactions.filter((tx) => inRange(toISODate(tx.date), range));
    const scopedIE = entries.filter((e) => inRange(e.date, range));

    const txVolume = scopedTx.reduce((s, tx) => s + toBase(tx.amtIn, tx.curIn), 0);
    // tx.profit хранится как число в USD (исторически). Конвертируем в base.
    const txProfit = scopedTx.reduce((s, tx) => s + toBase(tx.profit || 0, "USD"), 0);

    const income = scopedIE
      .filter((e) => e.type === "income")
      .reduce((s, e) => s + toBase(e.amount, e.currency), 0);

    const expense = scopedIE
      .filter((e) => e.type === "expense")
      .reduce((s, e) => s + toBase(e.amount, e.currency), 0);

    const netProfit = txProfit + income - expense;

    return { txVolume, txProfit, txCount: scopedTx.length, income, expense, netProfit };
  }, [transactions, entries, toBase, range]);

  const sym = curSymbol(base);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI
          label={t("kpi_exchange_volume")}
          value={`${sym}${fmt(txVolume, base)}`}
          sub={`${txCount} ${t("kpi_deals_sub")}`}
          icon={<Briefcase className="w-3.5 h-3.5" />}
        />
        <KPI
          label={t("kpi_deals_profit")}
          value={`${txProfit >= 0 ? "+" : ""}${sym}${fmt(txProfit, base)}`}
          accent={txProfit >= 0 ? "emerald" : "rose"}
          icon={<TrendingUp className="w-3.5 h-3.5" />}
        />
        <KPI
          label={t("kpi_income_expense")}
          value={`+${sym}${fmt(income, base)} / −${sym}${fmt(expense, base)}`}
          icon={<Receipt className="w-3.5 h-3.5" />}
        />
        <KPI
          label={t("kpi_net_profit")}
          value={`${netProfit >= 0 ? "+" : ""}${sym}${fmt(netProfit, base)}`}
          accent={netProfit >= 0 ? "emerald" : "rose"}
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          big
        />
      </div>

      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-slate-500" />
          <h2 className="text-[15px] font-semibold tracking-tight">{t("office_breakdown")}</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-5">
          {OFFICES.map((o) => {
            const officeTx = transactions.filter(
              (tx) => tx.officeId === o.id && inRange(toISODate(tx.date), range)
            );
            const volume = officeTx.reduce((s, tx) => s + toBase(tx.amtIn, tx.curIn), 0);
            const profit = officeTx.reduce((s, tx) => s + toBase(tx.profit || 0, "USD"), 0);
            const pct = txVolume > 0 ? (volume / txVolume) * 100 : 0;
            return (
              <div key={o.id} className="bg-slate-50/60 border border-slate-200 rounded-[12px] p-4">
                <div className="text-[12px] font-semibold text-slate-500 mb-0.5">{officeName(o.id)}</div>
                <div className="text-[22px] font-bold tabular-nums tracking-tight text-slate-900">
                  {sym}{fmt(volume, base)}
                </div>
                <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                  {officeTx.length} {t("kpi_deals_sub")} · {t("kpi_profit_word")}{" "}
                  <span className={profit >= 0 ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>
                    {sym}{fmt(profit, base)}
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
    <div className={`bg-white border border-slate-200 rounded-[12px] p-4 ${big ? "ring-2 ring-emerald-100" : ""}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-[22px] font-bold tabular-nums tracking-tight ${accentCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">{sub}</div>}
    </div>
  );
}
