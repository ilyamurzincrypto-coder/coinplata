// src/pages/capital/ReferralsTab.jsx
//
// Реферальная система v1 (миграция 0103). Рефером может быть только
// зарегистрированный клиент. За каждую сделку приведённого клиента
// рефереру начисляется % от OUT-amount в OUT-валюте, мульти-валютно
// (без конвертации в base). Старая «Менеджеры — реф-сделки» таблица
// удалена по запросу юзера.
//
// MVP не включает: «mark as paid» / выплаты, история выплат, payout RPC.

import React, { useMemo } from "react";
import { TrendingUp, UserPlus, Coins } from "lucide-react";
import { useTransactions } from "../../store/transactions.jsx";
import { useAuth } from "../../store/auth.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { fmt, percentOf, curSymbol } from "../../utils/money.js";

export default function ReferralsTab() {
  const { transactions, counterparties } = useTransactions();
  const { settings } = useAuth();
  const { base, toBase } = useBaseCurrency();
  const sym = curSymbol(base);
  const pct = Number(settings?.referralPct) || 0;

  // === Секция 1: рефералы клиентов ===
  // Считаем: для каждой сделки находим её counterparty (по nickname),
  // если у того referrerId !== null — начисляем бонус рефереру в OUT-валюте.
  const clientReferrers = useMemo(() => {
    if (counterparties.length === 0) return [];
    const cpByNick = new Map();
    counterparties.forEach((c) => {
      if (c.nickname) cpByNick.set(c.nickname.trim().toLowerCase(), c);
    });
    const cpById = new Map();
    counterparties.forEach((c) => {
      if (c.id) cpById.set(c.id, c);
    });

    // Map<referrerId, { referrer, referredIds:Set, deals, bonusByCurrency:Map<cur,amount>, totalBonusBase }>
    const m = new Map();
    transactions.forEach((tx) => {
      if (tx.status === "deleted") return;
      // Бонус начисляется ТОЛЬКО за сделки, где кассир явно отметил
      // toggle «Referral client» в форме создания сделки. Имеет
      // referrer_id у клиента, но без галочки на сделке — мимо.
      if (!tx.referral) return;
      const nick = (tx.counterparty || "").trim().toLowerCase();
      if (!nick) return;
      const cp = cpByNick.get(nick);
      if (!cp || !cp.referrerId) return;
      const referrer = cpById.get(cp.referrerId);
      if (!referrer) return;
      if (!m.has(referrer.id)) {
        m.set(referrer.id, {
          referrer,
          referredIds: new Set(),
          deals: 0,
          bonusByCurrency: new Map(),
          totalBonusBase: 0,
        });
      }
      const e = m.get(referrer.id);
      e.referredIds.add(cp.id);
      e.deals += 1;
      const outputs = tx.outputs || [{ currency: tx.curOut, amount: tx.amtOut }];
      outputs.forEach((o) => {
        if (!o || !o.currency) return;
        const amt = Number(o.amount) || 0;
        if (amt <= 0) return;
        const bonus = percentOf(amt, pct, 8);
        e.bonusByCurrency.set(
          o.currency,
          (e.bonusByCurrency.get(o.currency) || 0) + bonus
        );
        e.totalBonusBase += toBase(bonus, o.currency);
      });
    });

    return [...m.values()]
      .map((e) => ({
        ...e,
        referredCount: e.referredIds.size,
      }))
      .sort((a, b) => b.totalBonusBase - a.totalBonusBase);
  }, [transactions, counterparties, pct, toBase]);

  // Top-line суммарный бонус (в base) — для шапки.
  const totalClientBonusBase = clientReferrers.reduce(
    (s, e) => s + e.totalBonusBase,
    0
  );
  const totalReferredClients = clientReferrers.reduce(
    (s, e) => s + e.referredCount,
    0
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-[13px] text-slate-500">
          Реферальный процент:{" "}
          <span className="font-semibold text-slate-900">{pct}%</span> от OUT-amount
          сделки приведённого клиента, мульти-валютно (без конвертации)
        </p>
        <div className="inline-flex items-center gap-2 text-[12px] bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-[10px] px-3 py-1.5 font-semibold">
          <UserPlus className="w-3.5 h-3.5" />
          {totalReferredClients} приведено
        </div>
      </div>

      {/* Рефералы клиентов */}
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-emerald-600" />
            <h2 className="text-[15px] font-semibold tracking-tight">Рефералы клиентов</h2>
          </div>
          {totalClientBonusBase > 0 && (
            <span className="text-[12px] text-slate-500">
              суммарно к выплате (≈ в {base}):{" "}
              <span className="font-bold text-emerald-700 tabular-nums">
                {sym}{fmt(totalClientBonusBase, base)}
              </span>
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100">
                <th className="px-5 py-2.5 font-bold">Реферер</th>
                <th className="px-3 py-2.5 font-bold text-right">Привёл</th>
                <th className="px-3 py-2.5 font-bold text-right">Сделок</th>
                <th className="px-3 py-2.5 font-bold">Бонус по валютам (к выплате)</th>
                <th className="px-3 py-2.5 font-bold text-right">Итого ≈ {base}</th>
              </tr>
            </thead>
            <tbody>
              {clientReferrers.map((e) => (
                <tr
                  key={e.referrer.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-200 flex items-center justify-center text-[10px] font-bold text-emerald-700">
                        {(e.referrer.name || e.referrer.nickname || "?")
                          .split(/\s+/)
                          .map((w) => w[0] || "")
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">
                          {e.referrer.name || e.referrer.nickname}
                        </div>
                        {e.referrer.telegram && (
                          <div className="text-[11px] text-sky-600">{e.referrer.telegram}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-semibold">
                      {e.referredCount}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">{e.deals}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {[...e.bonusByCurrency.entries()]
                        .filter(([, v]) => v > 0)
                        .sort((a, b) => b[1] - a[1])
                        .map(([cur, val]) => (
                          <span
                            key={cur}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] tabular-nums bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100"
                            title={`${cur}`}
                          >
                            <Coins className="w-2.5 h-2.5 opacity-60" />
                            <span className="font-bold">{fmt(val, cur)}</span>
                            <span className="opacity-60">{cur}</span>
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-bold text-emerald-700">
                    {sym}{fmt(e.totalBonusBase, base)}
                  </td>
                </tr>
              ))}
              {clientReferrers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-[13px] text-slate-400">
                    Пока никого не привели. Привязать реферера можно в карточке клиента
                    (Контрагенты → клиент → поле «Привёл»). После сделки приведённого
                    клиента бонус начнёт накапливаться здесь.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
