// src/components/CashierKPI.jsx
// Компактный блок KPI над формой Cashier (dashboard-mode). 4 карточки:
//   • Today deals count     → cashier (текущая страница)
//   • Today profit (base)   → capital P&L
//   • We owe total (base)   → obligations filter=we_owe
//   • Pending to settle     → cashier (scroll к таблице)
//
// Все карточки кликабельны — onNavigate(page) переключает раздел.

import React, { useMemo } from "react";
import { TrendingUp, Clock, Scale, Activity } from "lucide-react";
import { useTransactions } from "../store/transactions.jsx";
import { useObligations } from "../store/obligations.jsx";
import { useBaseCurrency } from "../store/baseCurrency.js";
import { toISODate } from "../utils/date.js";
import { fmt, curSymbol } from "../utils/money.js";

export default function CashierKPI({ currentOffice, onNavigate }) {
  const { transactions } = useTransactions();
  const { obligations } = useObligations();
  const { base, toBase } = useBaseCurrency();
  const sym = curSymbol(base);

  const stats = useMemo(() => {
    const today = toISODate(new Date());
    let dealsToday = 0;
    let profitToday = 0;
    let pendingCount = 0;

    transactions.forEach((tx) => {
      if (tx.status === "deleted") return;
      if (currentOffice && tx.officeId !== currentOffice) return;
      const txDate = toISODate(tx.date);
      if (txDate === today) {
        dealsToday += 1;
        profitToday += toBase(tx.profit || 0, "USD");
      }
      if (tx.status === "pending" || tx.status === "checking") {
        pendingCount += 1;
      }
    });

    let weOwe = 0;
    (obligations || []).forEach((o) => {
      if (o.status !== "open" || o.direction !== "we_owe") return;
      if (currentOffice && o.officeId !== currentOffice) return;
      const remaining = (Number(o.amount) || 0) - (Number(o.paidAmount) || 0);
      weOwe += toBase(remaining, o.currency);
    });

    return { dealsToday, profitToday, weOwe, pendingCount };
  }, [transactions, obligations, toBase, currentOffice]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KpiCard
        label="Today deals"
        value={stats.dealsToday}
        sub={stats.dealsToday === 1 ? "1 transaction" : `${stats.dealsToday} transactions`}
        icon={<Activity className="w-3.5 h-3.5" />}
        tone="sky"
      />
      <KpiCard
        label="Today profit"
        value={`${stats.profitToday >= 0 ? "+" : ""}${sym}${fmt(stats.profitToday, base)}`}
        sub="base currency"
        icon={<TrendingUp className="w-3.5 h-3.5" />}
        tone={stats.profitToday >= 0 ? "emerald" : "rose"}
        onClick={() => onNavigate?.("capital")}
        clickable
      />
      <KpiCard
        label="We owe"
        value={`${sym}${fmt(stats.weOwe, base)}`}
        sub="open obligations"
        icon={<Scale className="w-3.5 h-3.5" />}
        tone={stats.weOwe > 0 ? "rose" : "slate"}
        onClick={() => onNavigate?.("obligations")}
        clickable
      />
      <KpiCard
        label="Pending to settle"
        value={stats.pendingCount}
        sub={stats.pendingCount === 1 ? "1 deal" : `${stats.pendingCount} deals`}
        icon={<Clock className="w-3.5 h-3.5" />}
        tone={stats.pendingCount > 0 ? "amber" : "slate"}
      />
    </div>
  );
}

function KpiCard({ label, value, sub, icon, tone, onClick, clickable }) {
  const toneStyles = {
    emerald: "text-emerald-700",
    rose: "text-rose-700",
    amber: "text-amber-700",
    sky: "text-sky-700",
    slate: "text-slate-700",
  }[tone] || "text-slate-700";
  const iconBg = {
    emerald: "bg-emerald-100 text-emerald-600",
    rose: "bg-rose-100 text-rose-600",
    amber: "bg-amber-100 text-amber-600",
    sky: "bg-sky-100 text-sky-600",
    slate: "bg-slate-100 text-slate-500",
  }[tone] || "bg-slate-100 text-slate-500";

  const base =
    "bg-white rounded-[14px] border border-slate-200/70 px-4 py-3 transition-all";
  const interactive = clickable
    ? "cursor-pointer hover:border-slate-300 hover:shadow-[0_4px_12px_-4px_rgba(15,23,42,0.08)] active:scale-[0.99]"
    : "";

  return (
    <div
      onClick={clickable ? onClick : undefined}
      className={`${base} ${interactive}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${iconBg}`}>
          {icon}
        </span>
      </div>
      <div className={`text-[20px] font-bold tabular-nums tracking-tight ${toneStyles}`}>
        {value}
      </div>
      <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>
    </div>
  );
}
