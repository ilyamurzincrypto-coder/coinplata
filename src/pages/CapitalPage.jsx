// src/pages/CapitalPage.jsx
import React, { useMemo, useState } from "react";
import { Briefcase, Calendar, TrendingUp } from "lucide-react";
import Select from "../components/ui/Select.jsx";
import { useTransactions } from "../store/transactions.jsx";
import { useAuth } from "../store/auth.jsx";
import { useRates } from "../store/rates.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { OFFICES, officeName } from "../store/data.js";
import { fmt, multiplyAmount } from "../utils/money.js";

export default function CapitalPage() {
  const { t } = useTranslation();
  const { transactions } = useTransactions();
  const { users } = useAuth();
  const { getRate } = useRates();

  const dateOptions = [t("today"), t("last_7"), t("this_month"), t("all_time")];
  const [dateRange, setDateRange] = useState(dateOptions[3]);

  // В моке все транзакции сегодня, поэтому date range в демо пока только визуальный.
  // В проде здесь фильтр по tx.date.
  const scopedTx = transactions;

  const byOffice = useMemo(() => {
    return OFFICES.map((o) => {
      const txs = scopedTx.filter((x) => x.officeId === o.id);
      const volume = txs.reduce((sum, x) => {
        const inUsd =
          x.curIn === "USD"
            ? x.amtIn
            : multiplyAmount(x.amtIn, getRate(x.curIn, "USD") ?? 0, 2);
        return sum + inUsd;
      }, 0);
      const profit = txs.reduce((s, x) => s + (x.profit || 0), 0);
      return { office: o, deals: txs.length, volume, profit };
    });
  }, [scopedTx, getRate]);

  const byManager = useMemo(() => {
    return users
      .filter((u) => u.role === "manager")
      .map((u) => {
        const txs = scopedTx.filter((x) => x.managerId === u.id);
        const volume = txs.reduce((sum, x) => {
          const inUsd =
            x.curIn === "USD"
              ? x.amtIn
              : multiplyAmount(x.amtIn, getRate(x.curIn, "USD") ?? 0, 2);
          return sum + inUsd;
        }, 0);
        const profit = txs.reduce((s, x) => s + (x.profit || 0), 0);
        return { user: u, deals: txs.length, volume, profit };
      })
      .sort((a, b) => b.volume - a.volume);
  }, [scopedTx, users, getRate]);

  const totals = useMemo(
    () => ({
      volume: byOffice.reduce((s, x) => s + x.volume, 0),
      profit: byOffice.reduce((s, x) => s + x.profit, 0),
      deals: byOffice.reduce((s, x) => s + x.deals, 0),
    }),
    [byOffice]
  );

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight">{t("capital_title")}</h1>
          <p className="text-[13px] text-slate-500 mt-1">
            Turnover and P&L across offices and managers
          </p>
        </div>
        <div className="w-44">
          <Select
            value={dateRange}
            onChange={setDateRange}
            options={dateOptions}
            compact
            icon={<Calendar className="w-3 h-3 text-slate-400" />}
          />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KPI label="Total volume" value={`$${fmt(totals.volume)}`} icon={<Briefcase className="w-3.5 h-3.5" />} />
        <KPI
          label="Net profit"
          value={`${totals.profit >= 0 ? "+" : ""}$${fmt(totals.profit)}`}
          accent={totals.profit >= 0 ? "emerald" : "rose"}
          icon={<TrendingUp className="w-3.5 h-3.5" />}
        />
        <KPI label="Total deals" value={totals.deals} />
      </div>

      {/* By office */}
      <Section title={t("turnover_by_office")} icon={<Briefcase className="w-4 h-4 text-slate-500" />}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {byOffice.map((x) => {
            const pct = totals.volume ? (x.volume / totals.volume) * 100 : 0;
            return (
              <div
                key={x.office.id}
                className="bg-slate-50/60 border border-slate-200 rounded-[12px] p-4"
              >
                <div className="text-[12px] font-semibold text-slate-500 mb-0.5">
                  {officeName(x.office.id)}
                </div>
                <div className="text-[22px] font-bold tabular-nums tracking-tight text-slate-900">
                  ${fmt(x.volume)}
                </div>
                <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                  {x.deals} deals · profit{" "}
                  <span
                    className={
                      x.profit >= 0 ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"
                    }
                  >
                    ${fmt(x.profit)}
                  </span>
                </div>
                <div className="mt-3 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-900 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-[10px] text-slate-400 mt-1 font-medium">{pct.toFixed(1)}%</div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* By manager */}
      <Section title={t("stats_by_manager")} icon={<Briefcase className="w-4 h-4 text-slate-500" />}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100">
                <th className="px-3 py-2.5 font-bold">{t("ref_manager")}</th>
                <th className="px-3 py-2.5 font-bold text-right">{t("ref_deals")}</th>
                <th className="px-3 py-2.5 font-bold text-right">Volume</th>
                <th className="px-3 py-2.5 font-bold text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              {byManager.map((m) => (
                <tr
                  key={m.user.id}
                  className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                >
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-[10px] font-bold text-slate-700">
                        {m.user.initials}
                      </div>
                      <span className="font-semibold text-slate-900">{m.user.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">{m.deals}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                    ${fmt(m.volume)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-bold text-emerald-700">
                    ${fmt(m.profit)}
                  </td>
                </tr>
              ))}
              {byManager.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-12 text-center text-[13px] text-slate-400">
                    No managers yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </main>
  );
}

function KPI({ label, value, accent, icon }) {
  const accentCls =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "rose"
      ? "text-rose-700"
      : "text-slate-900";
  return (
    <div className="bg-white border border-slate-200 rounded-[12px] p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-[24px] font-bold tabular-nums tracking-tight ${accentCls}`}>{value}</div>
    </div>
  );
}

function Section({ title, icon, children }) {
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        {icon}
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
