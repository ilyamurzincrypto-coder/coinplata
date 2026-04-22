// src/pages/ReferralsPage.jsx
// Все суммы в base currency.
// Bonus считаем от volume в базовой валюте через percentOf.

import React, { useMemo } from "react";
import { Users, TrendingUp } from "lucide-react";
import { useTransactions } from "../store/transactions.jsx";
import { useAuth } from "../store/auth.jsx";
import { useBaseCurrency } from "../store/baseCurrency.js";
import { useTranslation } from "../i18n/translations.jsx";
import { fmt, percentOf, curSymbol } from "../utils/money.js";

export default function ReferralsPage() {
  const { t } = useTranslation();
  const { transactions } = useTransactions();
  const { users, settings } = useAuth();
  const { base, toBase } = useBaseCurrency();
  const sym = curSymbol(base);

  const stats = useMemo(() => {
    return users
      .filter((u) => u.role === "manager")
      .map((u) => {
        const myTx = transactions.filter((x) => x.managerId === u.id);
        const referralTx = myTx.filter((x) => x.referral);

        const volume = myTx.reduce((sum, x) => sum + toBase(x.amtIn, x.curIn), 0);
        // tx.profit хранится в USD — нормализуем в base
        const income = myTx.reduce((sum, x) => sum + toBase(x.profit || 0, "USD"), 0);
        // Bonus: settings.referralPct от volume (volume уже в base)
        const bonus = referralTx.reduce(
          (sum, x) => sum + percentOf(toBase(x.amtIn, x.curIn), settings.referralPct, 2),
          0
        );

        return {
          user: u,
          deals: myTx.length,
          referralDeals: referralTx.length,
          volume,
          income,
          bonus,
        };
      })
      .sort((a, b) => b.income - a.income);
  }, [transactions, users, settings.referralPct, toBase]);

  const totalReferralDeals = stats.reduce((s, x) => s + x.referralDeals, 0);

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight">{t("referrals_title")}</h1>
          <p className="text-[13px] text-slate-500 mt-1">
            Referral bonus:{" "}
            <span className="font-semibold text-slate-900">{settings.referralPct}%</span> of volume
          </p>
        </div>
        <div className="inline-flex items-center gap-2 text-[12px] bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-[10px] px-3 py-1.5 font-semibold">
          <TrendingUp className="w-3.5 h-3.5" />
          {totalReferralDeals} referral deals
        </div>
      </div>

      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-500" />
          <h2 className="text-[15px] font-semibold tracking-tight">Managers performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100">
                <th className="px-5 py-2.5 font-bold">{t("ref_manager")}</th>
                <th className="px-3 py-2.5 font-bold text-right">{t("ref_deals")}</th>
                <th className="px-3 py-2.5 font-bold text-right">Referral deals</th>
                <th className="px-3 py-2.5 font-bold text-right">{t("ref_volume")}</th>
                <th className="px-3 py-2.5 font-bold text-right">{t("ref_income")}</th>
                <th className="px-3 py-2.5 font-bold text-right">{t("ref_bonus")}</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr
                  key={s.user.id}
                  className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-[10px] font-bold text-slate-700">
                        {s.user.initials}
                      </div>
                      <span className="font-semibold text-slate-900">{s.user.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">{s.deals}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[11px] font-semibold">
                      {s.referralDeals}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                    {sym}{fmt(s.volume, base)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-bold text-emerald-700">
                    {sym}{fmt(s.income, base)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-bold text-indigo-700">
                    {sym}{fmt(s.bonus, base)}
                  </td>
                </tr>
              ))}
              {stats.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-[13px] text-slate-400">
                    No managers yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
