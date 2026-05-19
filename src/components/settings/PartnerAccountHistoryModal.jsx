// src/components/settings/PartnerAccountHistoryModal.jsx
//
// История движений по партнёрскому счёту (миграция 0077:
// partner_account_movements). Аналог AccountHistoryModal для наших счетов.
//
// Источник: loadPartnerAccountMovements(partner_account_id).

import React, { useEffect, useState } from "react";
import { History, ArrowDownLeft, ArrowUpRight, Coins, Link2 } from "lucide-react";
import Modal from "../ui/Modal.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import { loadPartnerAccountMovements, loadDealsForPartnerAccount } from "../../lib/supabaseReaders.js";
import DeleteDealButton from "../DeleteDealButton.jsx";

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
  const [showRelated, setShowRelated] = useState(false);
  const [relatedDeals, setRelatedDeals] = useState([]);
  const [loadingRelated, setLoadingRelated] = useState(false);

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

  // On-demand: load related deals when toggle открыт
  useEffect(() => {
    if (!showRelated || !account?.id) return;
    if (relatedDeals.length > 0) return;
    let cancelled = false;
    setLoadingRelated(true);
    loadDealsForPartnerAccount(account.id, 100)
      .then((d) => { if (!cancelled) setRelatedDeals(d); })
      .catch((e) => { if (!cancelled) console.warn("[PartnerHistory]", e); })
      .finally(() => { if (!cancelled) setLoadingRelated(false); });
    return () => { cancelled = true; };
  }, [showRelated, account?.id, relatedDeals.length]);

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
        <div className="rounded-card border border-border-soft bg-surface-soft/60 p-3 grid grid-cols-3 gap-2 text-center">
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

        {/* Related deals toggle */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowRelated((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-soft hover:text-ink transition-colors"
            title="Сделки в которых участвовал этот партнёрский счёт"
          >
            <Link2 className="w-3 h-3" />
            {showRelated ? "Скрыть связанные сделки" : "Показать связанные сделки"}
            {relatedDeals.length > 0 && (
              <span className="text-[10px] text-muted-soft tabular-nums">({relatedDeals.length})</span>
            )}
          </button>
        </div>

        {showRelated && (
          <div className="rounded-card border border-border-soft bg-surface-soft/50 p-3">
            {loadingRelated ? (
              <div className="text-[12px] text-muted-soft text-center py-4">Загрузка…</div>
            ) : relatedDeals.length === 0 ? (
              <div className="text-[12px] text-muted-soft text-center py-4">Нет сделок с этим счётом</div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-auto">
                {relatedDeals.map((d) => {
                  const isOtc = d.kind === "otc" || d.kind === "broker";
                  const dt = new Date(d.createdAt);
                  return (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-2 rounded-button bg-white border border-border-soft px-2.5 py-1.5 text-[11.5px]"
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className="text-muted-soft tabular-nums whitespace-nowrap text-[10px]">
                          {dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
                        </span>
                        {isOtc && (
                          <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-bold ring-1 bg-accent-bg text-accent ring-indigo-200">
                            {d.kind === "broker" ? "BROKER" : "OTC"}
                          </span>
                        )}
                        <span className="text-ink-soft truncate">
                          {d.counterparty || "—"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="text-right tabular-nums">
                          <div className="font-semibold text-ink">
                            {fmt(d.amountIn, d.currencyIn)} {d.currencyIn}
                          </div>
                          {d.profit !== 0 && (
                            <div className={`text-[9.5px] font-bold ${d.profit > 0 ? "text-success" : "text-danger"}`}>
                              {d.profit > 0 ? "+" : ""}${fmt(d.profit, "USD")}
                            </div>
                          )}
                        </div>
                        <DeleteDealButton
                          dealId={d.id}
                          onDeleted={(id) => setRelatedDeals((arr) => arr.filter((x) => x.id !== id))}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Table */}
        <div className="rounded-card border border-border-soft bg-white overflow-hidden">
          {loading && (
            <div className="px-5 py-12 text-center text-[13px] text-muted-soft">Загрузка…</div>
          )}
          {error && !loading && (
            <div className="px-5 py-8 text-center text-[12.5px] text-danger bg-danger-soft">
              Ошибка: {error}
            </div>
          )}
          {!loading && !error && movements.length === 0 && (
            <div className="px-5 py-12 text-center text-[13px] text-muted-soft">
              <History className="w-8 h-8 mx-auto text-muted-soft mb-2" />
              Движений пока не было
            </div>
          )}
          {!loading && !error && movements.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead className="bg-surface-soft border-b border-border-soft text-[10px] font-bold text-muted tracking-wider uppercase">
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
                      emerald: "bg-success-soft text-success ring-emerald-200",
                      rose: "bg-danger-soft text-danger ring-rose-200",
                      indigo: "bg-accent-bg text-accent ring-indigo-200",
                      amber: "bg-warning-soft text-warning ring-amber-200",
                      slate: "bg-surface-sunk text-ink-soft ring-border-soft",
                    }[tone];
                    const d = new Date(m.createdAt);
                    return (
                      <tr key={m.id} className="border-b border-border-soft last:border-0 hover:bg-surface-soft">
                        <td className="px-3 py-2.5 whitespace-nowrap text-ink-soft tabular-nums">
                          <div className="font-semibold">{d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}</div>
                          <div className="text-[10px] text-muted-soft">{d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          {isIn ? (
                            <span className="inline-flex items-center gap-0.5 text-success text-[11px] font-bold">
                              <ArrowDownLeft className="w-3 h-3" />
                              IN
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-danger text-[11px] font-bold">
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
                            <div className="text-[9.5px] text-muted-soft mt-0.5 tabular-nums">
                              ref: #{m.sourceRefId}
                              {m.sourceLegIndex != null && ` · leg ${m.sourceLegIndex + 1}`}
                            </div>
                          )}
                          {m.note && (
                            <div className="text-[10px] text-muted italic mt-0.5 truncate max-w-[200px]" title={m.note}>
                              «{m.note}»
                            </div>
                          )}
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${isIn ? "text-success" : "text-danger"}`}>
                          {isIn ? "+" : "−"}{fmt(m.amount, m.currency)}
                          <span className="text-[9.5px] text-muted-soft font-normal ml-1">{m.currency}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">
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

      <div className="px-5 py-3.5 border-t border-border-soft flex items-center justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-card bg-surface-sunk text-ink-soft text-[13px] font-semibold hover:bg-surface-sunk"
        >
          Закрыть
        </button>
      </div>
    </Modal>
  );
}

function Stat({ label, value, tone }) {
  const cls = {
    slate: "text-ink-soft",
    emerald: "text-success",
  }[tone] || "text-ink-soft";
  return (
    <div>
      <div className="text-[9.5px] font-bold text-muted tracking-wider uppercase mb-0.5">{label}</div>
      <div className={`text-[14px] font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
