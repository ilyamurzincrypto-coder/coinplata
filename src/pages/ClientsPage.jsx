// src/pages/ClientsPage.jsx
// Агрегация по counterparty: deals count, volume, avg ticket, LTV, last deal date.
// + простой monthly bar chart общей активности (по всем клиентам).

import React, { useMemo, useState } from "react";
import { Users, Send, Search, BarChart3 } from "lucide-react";
import { useTransactions } from "../store/transactions.jsx";
import { useRates } from "../store/rates.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { fmt, multiplyAmount } from "../utils/money.js";
import { toISODate, monthKey, monthLabel } from "../utils/date.js";

function toUsd(amount, currency, getRate) {
  if (!amount) return 0;
  if (currency === "USD") return amount;
  return multiplyAmount(amount, getRate(currency, "USD") ?? 0, 2);
}

export default function ClientsPage() {
  const { t } = useTranslation();
  const { transactions, counterparties } = useTransactions();
  const { getRate } = useRates();
  const [search, setSearch] = useState("");

  // Агрегация по counterparty nickname
  const clients = useMemo(() => {
    const bucket = new Map();
    transactions.forEach((tx) => {
      const cp = (tx.counterparty || "").trim();
      if (!cp) return;
      if (!bucket.has(cp)) {
        bucket.set(cp, { nickname: cp, txs: [], volume: 0, profit: 0 });
      }
      const b = bucket.get(cp);
      const usd = toUsd(tx.amtIn, tx.curIn, getRate);
      b.txs.push(tx);
      b.volume += usd;
      b.profit += tx.profit || 0;
    });

    const rows = [];
    bucket.forEach((b) => {
      const deals = b.txs.length;
      const avgTicket = deals > 0 ? b.volume / deals : 0;
      // LTV — общая прибыль, которую принёс клиент
      const ltv = b.profit;
      // Найдём мета-данные контрагента если есть в counterparties
      const meta = counterparties.find(
        (c) => c.nickname.toLowerCase() === b.nickname.toLowerCase()
      );
      // Last deal date
      const lastDealDate = b.txs
        .map((t) => toISODate(t.date) + " " + (t.time || ""))
        .sort()
        .pop();

      rows.push({
        nickname: b.nickname,
        name: meta?.name || b.nickname,
        telegram: meta?.telegram || "",
        deals,
        volume: b.volume,
        profit: b.profit,
        avgTicket,
        ltv,
        lastDealDate,
      });
    });

    return rows.sort((a, b) => b.volume - a.volume);
  }, [transactions, counterparties, getRate]);

  const filtered = useMemo(() => {
    if (!search.trim()) return clients;
    const q = search.trim().toLowerCase().replace(/^@/, "");
    return clients.filter(
      (c) =>
        c.nickname.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.telegram.toLowerCase().replace(/^@/, "").includes(q)
    );
  }, [clients, search]);

  // Monthly activity — по всем транзакциям с counterparty
  const monthly = useMemo(() => {
    const byMonth = {};
    transactions.forEach((tx) => {
      if (!(tx.counterparty || "").trim()) return;
      const iso = toISODate(tx.date);
      const key = monthKey(iso);
      if (!byMonth[key]) byMonth[key] = { count: 0, volume: 0 };
      byMonth[key].count += 1;
      byMonth[key].volume += toUsd(tx.amtIn, tx.curIn, getRate);
    });
    // Последние 6 месяцев
    const result = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7);
      result.push({ key, label: monthLabel(key), ...(byMonth[key] || { count: 0, volume: 0 }) });
    }
    return result;
  }, [transactions, getRate]);

  const maxVolume = Math.max(...monthly.map((m) => m.volume), 1);

  const totals = useMemo(
    () => ({
      clientsCount: clients.length,
      deals: clients.reduce((s, c) => s + c.deals, 0),
      volume: clients.reduce((s, c) => s + c.volume, 0),
      ltv: clients.reduce((s, c) => s + c.ltv, 0),
    }),
    [clients]
  );

  return (
    <main className="max-w-[1300px] mx-auto px-6 py-6 space-y-5">
      <div>
        <h1 className="text-[24px] font-bold tracking-tight">{t("clients_title")}</h1>
        <p className="text-[13px] text-slate-500 mt-1">
          {totals.clientsCount} clients · {totals.deals} deals · ${fmt(totals.volume)} total volume
        </p>
      </div>

      {/* Monthly activity */}
      <section className="bg-white rounded-[14px] border border-slate-200/70 p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-slate-500" />
          <h2 className="text-[14px] font-semibold tracking-tight">{t("clients_monthly")}</h2>
        </div>
        <div className="flex items-end gap-2 h-32">
          {monthly.map((m) => {
            const h = m.volume > 0 ? (m.volume / maxVolume) * 100 : 2;
            return (
              <div key={m.key} className="flex-1 flex flex-col items-center gap-2">
                <div
                  className="w-full bg-gradient-to-t from-slate-900 to-slate-700 rounded-t-[6px] transition-all relative group"
                  style={{ height: `${h}%`, minHeight: "2px" }}
                >
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] font-semibold rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap tabular-nums">
                    ${fmt(m.volume)} · {m.count}
                  </div>
                </div>
                <div className="text-[10px] font-medium text-slate-500 tabular-nums">{m.label}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Clients table */}
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-500" />
            <h2 className="text-[15px] font-semibold tracking-tight">All clients</h2>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or @telegram…"
              className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200/70 focus:bg-white focus:border-slate-300 rounded-[8px] text-[13px] outline-none w-64 transition-colors placeholder:text-slate-400"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100">
                <th className="px-5 py-2.5 font-bold">{t("clients_name")}</th>
                <th className="px-3 py-2.5 font-bold text-right">{t("clients_deals")}</th>
                <th className="px-3 py-2.5 font-bold text-right">{t("clients_volume")}</th>
                <th className="px-3 py-2.5 font-bold text-right">{t("clients_avg_ticket")}</th>
                <th className="px-3 py-2.5 font-bold text-right">{t("clients_ltv")}</th>
                <th className="px-5 py-2.5 font-bold">{t("clients_last_deal")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.nickname}
                  className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-[11px] font-bold text-slate-700">
                        {c.name
                          .split(/\s+/)
                          .map((w) => w[0] || "")
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900 text-[13px]">{c.name}</div>
                        {c.telegram && (
                          <div className="inline-flex items-center gap-0.5 text-[11px] text-sky-600">
                            <Send className="w-2.5 h-2.5" />
                            {c.telegram}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">{c.deals}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                    ${fmt(c.volume)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-500">
                    ${fmt(c.avgTicket)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-md text-[13px] font-bold ${
                        c.ltv >= 0
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                          : "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
                      }`}
                    >
                      {c.ltv >= 0 ? "+" : ""}${fmt(c.ltv)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-500 text-[12px] tabular-nums whitespace-nowrap">
                    {c.lastDealDate}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-[13px] text-slate-400">
                    {search ? "No clients match your search" : "No clients yet"}
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
