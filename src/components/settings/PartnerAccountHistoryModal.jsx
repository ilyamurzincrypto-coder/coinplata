// src/components/settings/PartnerAccountHistoryModal.jsx
//
// История движений по партнёрскому счёту (миграция 0077:
// partner_account_movements). Аналог AccountHistoryModal для наших счетов.
//
// Источник: loadPartnerAccountMovements(partner_account_id).

import React, { useEffect, useState } from "react";
import { History, ArrowDownLeft, ArrowUpRight, Coins } from "lucide-react";
import Modal from "../ui/Modal.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import { loadPartnerAccountMovements } from "../../lib/supabaseReaders.js";

const SOURCE_KIND_LABEL = {
  opening: "Стартовый остаток",
  adjustment: "Корректировка",
  otc_in: "OTC поступление",
  otc_out: "OTC выдача",
  settle: "Закрытие обязательства",
};

const SOURCE_KIND_TONE = {
  opening: "slate",
  adjustment: "amber",
  otc_in: "emerald",
  otc_out: "rose",
  settle: "indigo",
};

export default function PartnerAccountHistoryModal({ open, account, onClose }) {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !account?.id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadPartnerAccountMovements(account.id, 200)
      .then((data) => {
        if (!cancelled) setMovements(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, account?.id]);

  if (!account) return null;

  // Running balance — пересчитываем сверху вниз (newest → oldest, обратный знак)
  // Чтобы показать какой был баланс в момент движения, считаем running с конца.
  const movementsWithBalance = (() => {
    let runningBalance = (account.openingBalance || 0)
      + movements.reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
    return movements.map((m) => {
      const before = runningBalance - (m.direction === "in" ? m.amount : -m.amount);
      const after = runningBalance;
      const result = { ...m, balanceAfter: after };
      runningBalance = before;
      return result;
    });
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`История · ${account.name}`}
      subtitle={`${account.partnerName || "Партнёр"} · ${account.currency}`}
      width="3xl"
    >
      <div className="p-5 space-y-3">
        {/* Header summary */}
        <div className="rounded-[12px] border border-slate-200 bg-slate-50/60 p-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Открытие" value={`${curSymbol(account.currency)}${fmt(account.openingBalance || 0, account.currency)}`} tone="slate" />
          <Stat label="Движений" value={String(movements.length)} tone="slate" />
          <Stat
            label="Текущий баланс"
            value={`${curSymbol(account.currency)}${fmt(
              (account.openingBalance || 0) + movements.reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0),
              account.currency
            )}`}
            tone="emerald"
          />
        </div>

        {/* Table */}
        <div className="rounded-[12px] border border-slate-200 bg-white overflow-hidden">
          {loading && (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">Загрузка…</div>
          )}
          {error && !loading && (
            <div className="px-5 py-8 text-center text-[12.5px] text-rose-600 bg-rose-50">
              Ошибка: {error}
            </div>
          )}
          {!loading && !error && movements.length === 0 && (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">
              <History className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              Движений пока не было
            </div>
          )}
          {!loading && !error && movements.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 tracking-wider uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Дата</th>
                    <th className="px-3 py-2 text-left">Тип</th>
                    <th className="px-3 py-2 text-left">Источник</th>
                    <th className="px-3 py-2 text-right">Изменение</th>
                    <th className="px-3 py-2 text-right">Баланс</th>
                  </tr>
                </thead>
                <tbody>
                  {movementsWithBalance.map((m) => {
                    const isIn = m.direction === "in";
                    const tone = SOURCE_KIND_TONE[m.sourceKind] || "slate";
                    const toneCls = {
                      emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
                      rose: "bg-rose-50 text-rose-700 ring-rose-200",
                      indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
                      amber: "bg-amber-50 text-amber-700 ring-amber-200",
                      slate: "bg-slate-100 text-slate-700 ring-slate-200",
                    }[tone];
                    const d = new Date(m.createdAt);
                    return (
                      <tr key={m.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-3 py-2.5 whitespace-nowrap text-slate-700 tabular-nums">
                          <div className="font-semibold">{d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}</div>
                          <div className="text-[10px] text-slate-400">{d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          {isIn ? (
                            <span className="inline-flex items-center gap-0.5 text-emerald-700 text-[11px] font-bold">
                              <ArrowDownLeft className="w-3 h-3" />
                              IN
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-rose-700 text-[11px] font-bold">
                              <ArrowUpRight className="w-3 h-3" />
                              OUT
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold ring-1 ${toneCls}`}>
                            {SOURCE_KIND_LABEL[m.sourceKind] || m.sourceKind}
                          </span>
                          {m.sourceRefId && (
                            <div className="text-[9.5px] text-slate-400 mt-0.5 tabular-nums">
                              ref: #{m.sourceRefId}
                              {m.sourceLegIndex != null && ` · leg ${m.sourceLegIndex + 1}`}
                            </div>
                          )}
                          {m.note && (
                            <div className="text-[10px] text-slate-500 italic mt-0.5 truncate max-w-[200px]" title={m.note}>
                              «{m.note}»
                            </div>
                          )}
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${isIn ? "text-emerald-700" : "text-rose-700"}`}>
                          {isIn ? "+" : "−"}{fmt(m.amount, m.currency)}
                          <span className="text-[9.5px] text-slate-400 font-normal ml-1">{m.currency}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                          {fmt(m.balanceAfter, account.currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="px-5 py-3.5 border-t border-slate-100 flex items-center justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200"
        >
          Закрыть
        </button>
      </div>
    </Modal>
  );
}

function Stat({ label, value, tone }) {
  const cls = {
    slate: "text-slate-700",
    emerald: "text-emerald-700",
  }[tone] || "text-slate-700";
  return (
    <div>
      <div className="text-[9.5px] font-bold text-slate-500 tracking-wider uppercase mb-0.5">{label}</div>
      <div className={`text-[14px] font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
