// src/pages/capital/ByManagerTab.jsx
// Разбивка по менеджерам: deals, volume, avg ticket, profit. Всё в base currency.

import React, { useMemo } from "react";
import { Users } from "lucide-react";
import { useTransactions } from "../../store/transactions.jsx";
import { useAuth, ROLES } from "../../store/auth.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { useTranslation } from "../../i18n/translations.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import { toISODate } from "../../utils/date.js";
import { inRange } from "../../components/ui/DateRangePicker.jsx";

export default function ByManagerTab({ range }) {
  const { t } = useTranslation();
  const { transactions } = useTransactions();
  const { users } = useAuth();
  const { base, toBase } = useBaseCurrency();
  const sym = curSymbol(base);

  const stats = useMemo(() => {
    return users
      .filter((u) => u.role === "manager" && u.active !== false)
      .map((u) => {
        const tx = transactions.filter(
          (t) => t.managerId === u.id && inRange(toISODate(t.date), range)
        );
        const volume = tx.reduce((s, t) => s + toBase(t.amtIn, t.curIn), 0);
        // tx.profit в USD — нормализуем в base
        const profit = tx.reduce((s, t) => s + toBase(t.profit || 0, "USD"), 0);
        const avgTicket = tx.length > 0 ? volume / tx.length : 0;
        return { user: u, deals: tx.length, volume, profit, avgTicket };
      })
      .sort((a, b) => b.volume - a.volume);
  }, [transactions, users, toBase, range]);

  const totalVolume = stats.reduce((s, x) => s + x.volume, 0);

  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <Users className="w-4 h-4 text-slate-500" />
        <h2 className="text-[15px] font-semibold tracking-tight">{t("tab_by_manager")}</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100 bg-slate-50/40">
              <th className="px-5 py-2.5 font-bold">{t("col_manager")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("col_deals")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("col_volume")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("clients_avg_ticket")}</th>
              <th className="px-5 py-2.5 font-bold text-right">{t("col_profit")}</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((m) => {
              const pct = totalVolume > 0 ? (m.volume / totalVolume) * 100 : 0;
              return (
                <tr
                  key={m.user.id}
                  className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-[10px] font-bold text-slate-700">
                        {m.user.initials}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{m.user.name}</div>
                        <div className="text-[11px] text-slate-500">{ROLES[m.user.role]?.label}</div>
                      </div>
                    </div>
                    <div className="mt-1 h-1 bg-slate-100 rounded-full overflow-hidden w-40">
                      <div className="h-full bg-slate-900 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
                      {pct.toFixed(1)}%
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">{m.deals}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                    {sym}{fmt(m.volume, base)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-500">
                    {m.deals > 0 ? `${sym}${fmt(m.avgTicket, base)}` : "—"}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-md text-[13px] font-bold ${
                        m.profit >= 0
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                          : "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
                      }`}
                    >
                      {m.profit >= 0 ? "+" : ""}{sym}{fmt(m.profit, base)}
                    </span>
                  </td>
                </tr>
              );
            })}
            {stats.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-[13px] text-slate-400">
                  {t("no_active_managers")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
