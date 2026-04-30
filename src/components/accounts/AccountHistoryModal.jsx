// src/components/accounts/AccountHistoryModal.jsx
// История движений по одному счёту + связанные OTC сделки.
//
// loadDealsForAccount: для menager'а — полный список сделок которые
// «касались» этого счёта (in_account_id ИЛИ leg.account_id). Это даёт
// видимость даже на partner-only OTC где наш movement отсутствует, но
// связь через ссылку deal'а.

import React, { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Clock, Link2 } from "lucide-react";
import Modal from "../ui/Modal.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useTranslation } from "../../i18n/translations.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import { loadDealsForAccount } from "../../lib/supabaseReaders.js";
import DeleteDealButton from "../DeleteDealButton.jsx";

const SOURCE_STYLES = {
  opening: "bg-slate-100 text-slate-700",
  topup: "bg-emerald-50 text-emerald-700",
  transfer_in: "bg-sky-50 text-sky-700",
  transfer_out: "bg-amber-50 text-amber-800",
  income: "bg-emerald-50 text-emerald-700",
  expense: "bg-rose-50 text-rose-700",
  exchange_in: "bg-indigo-50 text-indigo-700",
  exchange_out: "bg-indigo-50 text-indigo-700",
};

function relativeTime(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AccountHistoryModal({ account, onClose }) {
  const { t } = useTranslation();
  const { movementsByAccount, balanceOf } = useAccounts();
  const [relatedDeals, setRelatedDeals] = useState([]);
  const [loadingRelated, setLoadingRelated] = useState(false);

  const movements = useMemo(
    () => (account ? movementsByAccount(account.id) : []),
    [account, movementsByAccount]
  );

  // Загружаем связанные сделки сразу при открытии модалки (default-visible)
  useEffect(() => {
    if (!account?.id) return;
    let cancelled = false;
    setLoadingRelated(true);
    setRelatedDeals([]);
    loadDealsForAccount(account.id, 100)
      .then((d) => { if (!cancelled) setRelatedDeals(d); })
      .catch((e) => { if (!cancelled) console.warn("[AccountHistoryModal]", e); })
      .finally(() => { if (!cancelled) setLoadingRelated(false); });
    return () => { cancelled = true; };
  }, [account?.id]);

  if (!account) return null;

  return (
    <Modal
      open={!!account}
      onClose={onClose}
      title={account.name}
      subtitle={`${account.currency} · ${t("acc_history")}`}
      width="lg"
    >
      <div className="p-5 border-b border-slate-100 bg-slate-50/40">
        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
          {t("current_balance")}
        </div>
        <div className="text-[24px] font-bold tabular-nums tracking-tight text-slate-900">
          {curSymbol(account.currency)}
          {fmt(balanceOf(account.id), account.currency)}{" "}
          <span className="text-[13px] text-slate-500 font-medium">{account.currency}</span>
        </div>
        <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
          {movements.length} movements
        </div>
      </div>

      {/* Связанные сделки — default visible (не toggle) */}
      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50">
        <div className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-slate-500 uppercase tracking-wider mb-2">
          <Link2 className="w-3 h-3" />
          Сделки на этом счёте
          {!loadingRelated && (
            <span className="text-[10px] text-slate-400 normal-case font-semibold tracking-normal">
              · {relatedDeals.length}
            </span>
          )}
        </div>
        {loadingRelated ? (
          <div className="text-[12px] text-slate-400 text-center py-3">Загрузка…</div>
        ) : relatedDeals.length === 0 ? (
          <div className="text-[12px] text-slate-400 text-center py-2">Нет сделок с этим счётом</div>
        ) : (
          <div className="space-y-1 max-h-40 overflow-auto">
            {relatedDeals.map((d) => {
              const isOtc = d.kind === "otc" || d.kind === "broker";
              const dt = new Date(d.createdAt);
              return (
                <div
                  key={d.id}
                  className="flex items-center justify-between gap-2 rounded-[8px] bg-white border border-slate-200 px-2.5 py-1.5 text-[11.5px]"
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-slate-400 tabular-nums whitespace-nowrap text-[10px]">
                      {dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
                    </span>
                    {isOtc && (
                      <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-bold ring-1 bg-indigo-50 text-indigo-700 ring-indigo-200">
                        {d.kind === "broker" ? "BROKER" : "OTC"}
                      </span>
                    )}
                    <span className="text-slate-600 truncate">
                      {d.counterparty || "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="text-right tabular-nums">
                      <div className="font-semibold text-slate-900">
                        {fmt(d.amountIn, d.currencyIn)} {d.currencyIn}
                      </div>
                      {d.profit !== 0 && (
                        <div className={`text-[9.5px] font-bold ${d.profit > 0 ? "text-emerald-700" : "text-rose-700"}`}>
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

      <div className="max-h-[60vh] overflow-auto">
        {movements.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-slate-400">{t("mv_empty")}</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100 sticky top-0 bg-white">
                <th className="px-5 py-2.5 font-bold">
                  <Clock className="w-3 h-3 inline" />
                </th>
                <th className="px-3 py-2.5 font-bold">Source</th>
                <th className="px-3 py-2.5 font-bold">Note</th>
                <th className="px-5 py-2.5 font-bold text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const isIn = m.direction === "in";
                const kindKey = `mv_source_${m.source.kind}`;
                const label = t(kindKey) !== kindKey ? t(kindKey) : m.source.kind;
                return (
                  <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-5 py-3 whitespace-nowrap text-[11px] text-slate-500 tabular-nums">
                      {relativeTime(m.timestamp)}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${
                          SOURCE_STYLES[m.source.kind] || "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {isIn ? <ArrowDownLeft className="w-2.5 h-2.5" /> : <ArrowUpRight className="w-2.5 h-2.5" />}
                        {label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-600 text-[12px] max-w-xs truncate">
                      {m.source.note || "—"}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums whitespace-nowrap">
                      <span className={`font-bold ${isIn ? "text-emerald-700" : "text-rose-700"}`}>
                        {isIn ? "+" : "−"}
                        {curSymbol(m.currency)}
                        {fmt(m.amount, m.currency)}
                      </span>
                      <span className="text-[10px] text-slate-400 font-medium ml-1">{m.currency}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
