// src/components/clients/ClientProfileModal.jsx
// Извлечён из ClientsPage.jsx для переиспользования в новой Контрагенты-странице.
// API-сигнатура props сохранена 1:1 — оба места (старый ClientsPage и новый
// CounterpartiesPage / ListTab) передают одни и те же значения.

import React, { useMemo, useState } from "react";
import { BarChart3, Wallet, Network as NetworkIcon, UserPlus, Users } from "lucide-react";
import Modal from "../ui/Modal.jsx";
import { CLIENT_TAGS } from "../../store/data.js";
import { fmt } from "../../utils/money.js";
import { toISODate, monthKey, monthLabel } from "../../utils/date.js";
import { exportCSV } from "../../utils/csv.js";
import { checkWalletRisk, riskLevelStyle, riskLevelLabel } from "../../utils/aml.js";

export function ClientProfileModal({ clientId, onClose, counterparties, transactions, walletsByClient, updateCounterparty, obligations, base, sym, toBase }) {
  const client = clientId ? counterparties.find((c) => c.id === clientId) : null;
  const [statusFilter, setStatusFilter] = useState("all");
  const [curFilter, setCurFilter] = useState("all");

  const clientTxs = useMemo(() => {
    if (!client) return [];
    return transactions.filter(
      (tx) => (tx.counterparty || "").toLowerCase() === client.nickname.toLowerCase()
    );
  }, [client, transactions]);

  // Obligations — фильтруем по client_id (если матчим по UUID), плюс open-only.
  const clientObligations = useMemo(() => {
    if (!client || !Array.isArray(obligations)) return [];
    return obligations.filter(
      (o) => o.clientId === client.id && o.status === "open"
    );
  }, [client, obligations]);

  const obligationTotals = useMemo(() => {
    let weOwe = 0;
    let theyOwe = 0;
    clientObligations.forEach((o) => {
      const remaining = (Number(o.amount) || 0) - (Number(o.paidAmount) || 0);
      const inBase = toBase(remaining, o.currency);
      if (o.direction === "we_owe") weOwe += inBase;
      else if (o.direction === "they_owe") theyOwe += inBase;
    });
    return { weOwe, theyOwe, net: theyOwe - weOwe };
  }, [clientObligations, toBase]);

  const stats = useMemo(() => {
    let volume = 0, profit = 0;
    clientTxs.forEach((tx) => {
      volume += toBase(tx.amtIn, tx.curIn);
      profit += toBase(tx.profit || 0, "USD");
    });
    const deals = clientTxs.length;
    const avgDeal = deals > 0 ? volume / deals : 0;
    const sortedDates = clientTxs
      .map((tx) => toISODate(tx.date) + " " + (tx.time || ""))
      .sort();
    const last = sortedDates[sortedDates.length - 1] || "—";
    const first = sortedDates[0] || "—";
    const ltv = profit;
    return { volume, profit, deals, avgDeal, last, first, ltv };
  }, [clientTxs, toBase]);

  const monthly = useMemo(() => {
    const map = new Map();
    clientTxs.forEach((tx) => {
      const k = monthKey(toISODate(tx.date));
      if (!map.has(k)) map.set(k, { key: k, count: 0, volume: 0 });
      const b = map.get(k);
      b.count += 1;
      b.volume += toBase(tx.amtIn, tx.curIn);
    });
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [clientTxs, toBase]);
  const maxMonthlyVol = Math.max(1, ...monthly.map((m) => m.volume));

  const walletGroups = useMemo(() => {
    if (!client) return [];
    const wallets = walletsByClient(client.id);
    const byNetwork = new Map();
    wallets.forEach((w) => {
      const risk = checkWalletRisk(w.address);
      const enriched = { ...w, risk };
      if (!byNetwork.has(w.network)) byNetwork.set(w.network, []);
      byNetwork.get(w.network).push(enriched);
    });
    return Array.from(byNetwork.entries()).map(([network, list]) => ({ network, wallets: list }));
  }, [client, walletsByClient]);

  const clientRisk = useMemo(() => {
    let maxScore = 0;
    let worstLevel = "low";
    const weight = { low: 1, medium: 2, high: 3 };
    walletGroups.forEach((g) => {
      g.wallets.forEach((w) => {
        if (w.risk.riskScore > maxScore) maxScore = w.risk.riskScore;
        if ((weight[w.risk.riskLevel] || 0) > (weight[worstLevel] || 0)) worstLevel = w.risk.riskLevel;
      });
    });
    return { score: maxScore, level: worstLevel };
  }, [walletGroups]);

  const filteredTxs = useMemo(() => {
    return clientTxs.filter((tx) => {
      if (statusFilter !== "all" && (tx.status || "completed") !== statusFilter) return false;
      if (curFilter !== "all") {
        const hasCur = tx.curIn === curFilter || (tx.outputs || []).some((o) => o.currency === curFilter);
        if (!hasCur) return false;
      }
      return true;
    });
  }, [clientTxs, statusFilter, curFilter]);

  const uniqueCurrencies = useMemo(() => {
    const s = new Set();
    clientTxs.forEach((tx) => {
      s.add(tx.curIn);
      (tx.outputs || []).forEach((o) => s.add(o.currency));
    });
    return Array.from(s);
  }, [clientTxs]);

  // Реферер этого клиента (кто его привёл).
  const referrer = useMemo(() => {
    if (!client?.referrerId) return null;
    return counterparties.find((c) => c.id === client.referrerId) || null;
  }, [client, counterparties]);

  // Кого привёл этот клиент (referrals — те, у кого referrerId = client.id).
  const referredBy = useMemo(() => {
    if (!client?.id) return [];
    return counterparties
      .filter((c) => c.referrerId === client.id)
      .sort((a, b) => (a.nickname || "").localeCompare(b.nickname || ""));
  }, [client, counterparties]);

  // Кандидаты для select (исключаем самого клиента — нельзя реферить себя).
  const referrerOptions = useMemo(() => {
    if (!client) return [];
    return counterparties
      .filter((c) => !c.archivedAt && c.id && c.id !== client.id)
      .sort((a, b) => (a.nickname || "").localeCompare(b.nickname || ""));
  }, [counterparties, client]);

  if (!client) return null;

  return (
    <Modal open={!!client} onClose={onClose} title={client.name || client.nickname} subtitle={client.telegram || "no telegram"} width="2xl">
      <div className="p-5 space-y-4 max-h-[70vh] overflow-auto">
        {/* Tag selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tag:</span>
          <TagBtn active={!client.tag} onClick={() => updateCounterparty(client.id, { tag: "" })}>None</TagBtn>
          {CLIENT_TAGS.map((tg) => (
            <TagBtn key={tg} active={client.tag === tg} onClick={() => updateCounterparty(client.id, { tag: tg })}>{tg}</TagBtn>
          ))}
        </div>

        {/* Referrer selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            <UserPlus className="w-3 h-3" />
            Привёл
          </span>
          <select
            value={client.referrerId || ""}
            onChange={(e) => updateCounterparty(client.id, { referrerId: e.target.value || null })}
            className="bg-slate-50 border border-slate-200 rounded-[8px] px-2 py-1 text-[12px] font-medium outline-none focus:bg-white focus:border-slate-400 max-w-[260px]"
          >
            <option value="">— нет —</option>
            {referrerOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nickname}
                {c.telegram ? ` · ${c.telegram}` : ""}
              </option>
            ))}
          </select>
          {referrer && (
            <span className="text-[11px] text-slate-500">
              реферер: <span className="font-semibold text-slate-700">{referrer.name || referrer.nickname}</span>
            </span>
          )}
        </div>

        {/* Привёл клиентов (если этот — реферер) */}
        {referredBy.length > 0 && (
          <div className="border border-indigo-100 bg-indigo-50/40 rounded-[10px] p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Users className="w-3 h-3 text-indigo-600" />
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-700">
                Привёл клиентов · {referredBy.length}
              </h3>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {referredBy.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-white border border-indigo-200 text-slate-700"
                  title={c.telegram || ""}
                >
                  {c.nickname}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Stats grid + risk — 6 карточек: Deals / Volume / LTV / Avg / First / Last */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <StatCard label="Deals" value={stats.deals} />
          <StatCard label="Volume" value={`${sym}${fmt(stats.volume, base)}`} />
          <StatCard
            label="LTV"
            value={`${stats.ltv >= 0 ? "+" : ""}${sym}${fmt(stats.ltv, base)}`}
            tone={stats.ltv >= 0 ? "emerald" : "rose"}
          />
          <StatCard label="Avg deal" value={`${sym}${fmt(stats.avgDeal, base)}`} />
          <StatCard label="First" value={stats.first} small />
          <StatCard label="Last" value={stats.last} small />
        </div>

        {/* Obligations — показываем только если есть открытые */}
        {clientObligations.length > 0 && (
          <div className="border border-amber-200 bg-amber-50/50 rounded-[10px] p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-700">
                Open obligations · {clientObligations.length}
              </h3>
              <div className="flex items-center gap-3 text-[11px] tabular-nums">
                {obligationTotals.theyOwe > 0 && (
                  <span className="font-semibold text-emerald-700">
                    They owe: {sym}{fmt(obligationTotals.theyOwe, base)}
                  </span>
                )}
                {obligationTotals.weOwe > 0 && (
                  <span className="font-semibold text-rose-700">
                    We owe: {sym}{fmt(obligationTotals.weOwe, base)}
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-1">
              {clientObligations.map((o) => {
                const remaining = (Number(o.amount) || 0) - (Number(o.paidAmount) || 0);
                const cur = o.currency;
                const isWeOwe = o.direction === "we_owe";
                return (
                  <div
                    key={o.id}
                    className="flex items-center gap-2 px-2 py-1.5 bg-white rounded-md text-[11px]"
                  >
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                        isWeOwe ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {isWeOwe ? "we owe" : "they owe"}
                    </span>
                    <span className="font-semibold tabular-nums text-slate-900">
                      {fmt(remaining, cur)} {cur}
                    </span>
                    {(o.paidAmount || 0) > 0 && (
                      <span className="text-[10px] text-slate-500">
                        paid {fmt(o.paidAmount, cur)} / {fmt(o.amount, cur)}
                      </span>
                    )}
                    <span className="text-slate-400 text-[10px] flex-1 min-w-0 truncate">
                      {o.note || ""}
                    </span>
                    {o.dealId && (
                      <span className="text-slate-400 text-[10px] tabular-nums">#{o.dealId}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Monthly activity — sparklines */}
        {monthly.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <BarChart3 className="w-3.5 h-3.5 text-slate-500" />
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-600">
                Monthly activity
              </h3>
            </div>
            <div className="flex items-end gap-1 h-16 bg-slate-50 border border-slate-200 rounded-[10px] px-2 py-2">
              {monthly.map((m) => {
                const h = Math.max(4, (m.volume / maxMonthlyVol) * 52);
                return (
                  <div key={m.key} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <div
                      className="w-full bg-indigo-400 rounded-sm hover:bg-indigo-500 transition-colors cursor-default"
                      style={{ height: `${h}px` }}
                      title={`${monthLabel(m.key)}: ${m.count} deals · ${sym}${fmt(m.volume, base)}`}
                    />
                    <span className="text-[9px] text-slate-500 font-medium truncate">
                      {monthLabel(m.key).slice(0, 3)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {walletGroups.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Overall risk:</span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ring-1 ${riskLevelStyle(clientRisk.level)}`}>
              {riskLevelLabel(clientRisk.level)} · {clientRisk.score}
            </span>
          </div>
        )}

        {client.note && (
          <div className="text-[12px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
            <span className="font-semibold text-slate-500 uppercase text-[10px] tracking-wider mr-1.5">Note:</span>
            {client.note}
          </div>
        )}

        {/* Wallets */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Wallet className="w-3.5 h-3.5 text-slate-500" />
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-600">Crypto wallets</h3>
          </div>
          {walletGroups.length === 0 ? (
            <div className="text-[12px] text-slate-400 italic py-2">No wallets detected yet</div>
          ) : (
            <div className="space-y-2">
              {walletGroups.map((g) => (
                <div key={g.network} className="bg-slate-50/60 border border-slate-200 rounded-[10px] p-2.5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <NetworkIcon className="w-3 h-3 text-indigo-500" />
                    <span className="text-[11px] font-bold tracking-wider text-slate-700">{g.network}</span>
                    <span className="text-[10px] text-slate-400">· {g.wallets.length}</span>
                  </div>
                  <div className="space-y-1">
                    {g.wallets.map((w) => (
                      <div key={w.id} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-mono text-slate-600 truncate flex-1 min-w-0">{w.address}</span>
                        <span
                          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold ring-1 ${riskLevelStyle(w.risk.riskLevel)}`}
                          title={(w.risk.flags || []).join(", ") || "no flags"}
                        >
                          {riskLevelLabel(w.risk.riskLevel)} · {w.risk.riskScore}
                        </span>
                        <span className="text-[10px] text-slate-400 tabular-nums whitespace-nowrap">
                          {w.usageCount} tx
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Transactions */}
        <div>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-600">Transactions · {clientTxs.length}</h3>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (filteredTxs.length === 0) return;
                  exportCSV({
                    filename: `client-${(client.nickname || "unknown").replace(/[^a-z0-9_-]+/gi, "_")}-history.csv`,
                    columns: [
                      { key: "id", label: "ID" },
                      { key: "date", label: "Date" },
                      { key: "time", label: "Time" },
                      { key: "status", label: "Status" },
                      { key: "curIn", label: "IN currency" },
                      { key: "amtIn", label: "IN amount" },
                      { key: "outs", label: "OUT" },
                      { key: "rate", label: "Rate" },
                      { key: "fee", label: "Fee (USD)" },
                      { key: "profit", label: "Profit (USD)" },
                    ],
                    rows: filteredTxs.map((tx) => ({
                      id: tx.id,
                      date: tx.date,
                      time: tx.time,
                      status: tx.status || "completed",
                      curIn: tx.curIn,
                      amtIn: tx.amtIn,
                      outs: (tx.outputs || [])
                        .map((o) => `${o.amount} ${o.currency}`)
                        .join(" + "),
                      rate: (tx.outputs || [])[0]?.rate ?? tx.rate ?? "",
                      fee: tx.fee,
                      profit: tx.profit,
                    })),
                  });
                }}
                disabled={filteredTxs.length === 0}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-[8px] text-[11px] font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Export client history to CSV"
              >
                Export
              </button>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-[8px] px-2 py-1 text-[11px] font-medium outline-none"
              >
                <option value="all">All statuses</option>
                <option value="completed">Completed</option>
                <option value="checking">Checking</option>
                <option value="pending">Pending</option>
                <option value="deleted">Deleted</option>
              </select>
              <select
                value={curFilter}
                onChange={(e) => setCurFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-[8px] px-2 py-1 text-[11px] font-medium outline-none"
              >
                <option value="all">All currencies</option>
                {uniqueCurrencies.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          {filteredTxs.length === 0 ? (
            <div className="text-[12px] text-slate-400 italic py-4 text-center">No transactions match filter</div>
          ) : (
            <div className="border border-slate-200 rounded-[10px] overflow-hidden divide-y divide-slate-100">
              {filteredTxs.map((tx) => (
                <div key={tx.id} className="flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-slate-50">
                  <span className="text-slate-400 tabular-nums">{tx.date} {tx.time}</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {fmt(tx.amtIn, tx.curIn)} {tx.curIn}
                  </span>
                  <span className="text-slate-400">→</span>
                  <span className="font-semibold text-slate-900 tabular-nums flex-1">
                    {(tx.outputs || []).map((o) => `${fmt(o.amount, o.currency)} ${o.currency}`).join(" + ")}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">{tx.status || "completed"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end">
        <button onClick={onClose} className="px-4 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors">Close</button>
      </div>
    </Modal>
  );
}

function StatCard({ label, value, tone, small }) {
  const toneCls =
    tone === "emerald" ? "text-emerald-700 bg-emerald-50 border-emerald-100"
    : tone === "rose" ? "text-rose-700 bg-rose-50 border-rose-100"
    : "text-slate-900 bg-slate-50/60 border-slate-200";
  return (
    <div className={`rounded-[8px] border p-2 ${toneCls}`}>
      <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`${small ? "text-[11px]" : "text-[15px]"} font-bold tabular-nums leading-tight mt-0.5`}>
        {value}
      </div>
    </div>
  );
}

function TagBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-[8px] text-[11px] font-semibold border transition-colors ${
        active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
      }`}
    >
      {children}
    </button>
  );
}
