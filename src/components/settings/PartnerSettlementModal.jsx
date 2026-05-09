// src/components/settings/PartnerSettlementModal.jsx
//
// Запись пополнения / выдачи по partner_account БЕЗ создания сделки.
//   • mode="inflow"  — контрагент внёс. Только partner_account_movement (in).
//                      Наш кеш НЕ трогаем (приходит отдельно если надо).
//   • mode="outflow" — контрагент забрал у нас кеш. partner_account_movement
//                      (out) + наш account_movement (out) с выбранного счёта.
//
// RPC: record_partner_inflow / record_partner_outflow.

import React, { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import Modal from "../ui/Modal.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useOffices } from "../../store/offices.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import { withToast } from "../../lib/supabaseWrite.js";
import {
  recordPartnerInflow as rpcRecordPartnerInflow,
  recordPartnerOutflow as rpcRecordPartnerOutflow,
} from "../../lib/dealOperations.js";
import { USE_NEW_LEDGER } from "../../lib/newLedger.js";

export default function PartnerSettlementModal({
  open,
  mode,            // "inflow" | "outflow"
  partnerAccount,  // { id, name, currency, ... }
  partnerName,
  onClose,
  onDone,
}) {
  const { accounts, balanceOf } = useAccounts();
  const { activeOffices } = useOffices();
  const [amount, setAmount] = useState("");
  const [fromAccountId, setFromAccountId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const ccy = partnerAccount?.currency;

  // Только наши счета той же валюты для outflow.
  const eligibleAccounts = useMemo(() => {
    if (!ccy) return [];
    return accounts
      .filter((a) => a.active && a.currency === ccy)
      .map((a) => ({
        ...a,
        bal: balanceOf(a.id),
        officeName: activeOffices.find((o) => o.id === a.officeId)?.name || a.officeId,
      }));
  }, [accounts, balanceOf, ccy, activeOffices]);

  const reset = () => {
    setAmount("");
    setFromAccountId("");
    setNote("");
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose?.();
  };

  const submit = async () => {
    if (busy) return;
    const amt = Number(String(amount).replace(",", "."));
    if (!Number.isFinite(amt) || amt <= 0) {
      alert("Введи положительную сумму");
      return;
    }
    if (mode === "outflow" && !fromAccountId) {
      alert("Укажи с какой кассы выдаём");
      return;
    }

    setBusy(true);
    try {
      const res = await withToast(
        () =>
          mode === "inflow"
            ? rpcRecordPartnerInflow({
                partnerAccountId: partnerAccount.id,
                amount: amt,
                currency: ccy,
                note,
              })
            : rpcRecordPartnerOutflow({
                partnerAccountId: partnerAccount.id,
                amount: amt,
                currency: ccy,
                fromAccountId,
                note,
              }),
        {
          success: mode === "inflow" ? "Пополнение записано" : "Выдача записана",
          errorPrefix: "Не удалось",
        }
      );
      if (res.ok) {
        reset();
        onDone?.();
        onClose?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const isInflow = mode === "inflow";
  const Icon = isInflow ? ArrowDownLeft : ArrowUpRight;
  const accent = isInflow ? "emerald" : "rose";
  const accentCls = isInflow
    ? "bg-emerald-600 hover:bg-emerald-700"
    : "bg-rose-600 hover:bg-rose-700";
  const title = isInflow
    ? `${partnerName || "Партнёр"} → внёс`
    : `${partnerName || "Партнёр"} → забрал`;
  const subtitle = isInflow
    ? `Одностороннее: только баланс на ${partnerAccount?.name || "счёте"}, нашу кассу не трогаем`
    : `Парное: ${partnerAccount?.name || "счёт"} − amt, и наша касса − amt`;

  return (
    <Modal open={!!open} onClose={handleClose} title={title} subtitle={subtitle} width="md">
      {USE_NEW_LEDGER && (
        <div className="mx-5 mt-4 px-3.5 py-2.5 rounded-[10px] bg-amber-50 border border-amber-200 text-[12.5px] text-amber-900">
          <span className="font-semibold">Partner-движения отключены в режиме v2 ledger.</span>{" "}
          v2 recordPartnerInflow/Outflow ещё не реализованы. Попроси админа выключить{" "}
          <code className="px-1 bg-amber-100 rounded">VITE_USE_NEW_LEDGER</code>.
        </div>
      )}
      <div className="p-5 space-y-3">
        <div className={`flex items-center gap-2 px-3 py-2 rounded-[10px] bg-${accent}-50 border border-${accent}-200`}>
          <Icon className={`w-4 h-4 text-${accent}-700`} />
          <span className={`text-[12px] font-semibold text-${accent}-800`}>
            {partnerAccount?.name} · {ccy}
          </span>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Сумма
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[12px] font-bold">
              {curSymbol(ccy)}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              autoFocus
              className="w-full pl-8 pr-3 py-2.5 bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] text-[14px] tabular-nums outline-none"
            />
          </div>
        </div>

        {!isInflow && (
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              С какой кассы выдаём ({ccy})
            </label>
            {eligibleAccounts.length === 0 ? (
              <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-[8px] px-3 py-2">
                Нет активных счетов в {ccy}. Создай счёт в нужной валюте.
              </div>
            ) : (
              <select
                value={fromAccountId}
                onChange={(e) => setFromAccountId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
              >
                <option value="">— выбери счёт —</option>
                {eligibleAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.officeName} · {a.name} · {curSymbol(a.currency)}{fmt(a.bal, a.currency)}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div>
          <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Комментарий (опционально)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={isInflow ? "Коротко зачем" : "Например: вернул долг кешем"}
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
          />
        </div>
      </div>

      <div className="px-5 py-3.5 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={handleClose}
          disabled={busy}
          className="px-3 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[12.5px] font-semibold hover:bg-slate-200"
        >
          Отмена
        </button>
        <button
          onClick={submit}
          disabled={busy || USE_NEW_LEDGER || (!isInflow && eligibleAccounts.length === 0)}
          title={USE_NEW_LEDGER ? "Отключено в режиме v2 ledger" : undefined}
          className={`px-4 py-2 rounded-[10px] text-white text-[12.5px] font-bold ${accentCls} disabled:opacity-60`}
        >
          {busy ? "Записываю…" : isInflow ? "Записать пополнение" : "Записать выдачу"}
        </button>
      </div>
    </Modal>
  );
}
