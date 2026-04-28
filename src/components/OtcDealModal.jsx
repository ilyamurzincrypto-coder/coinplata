// src/components/OtcDealModal.jsx
// OTC сделка с контрагентом (партнёром) — упрощённая форма обмена валюты.
// Сценарий: приняли RUB → партнёр прислал USDT. Без fee/profit/AML.
// Поддерживает backdate (создание задним числом). Пишется в БД через
// rpcCreateOtcDeal (0069 RPC), создаёт deal + 2 movements.

import React, { useState, useEffect, useMemo } from "react";
import { ArrowDown, AlertCircle, Calendar, Users } from "lucide-react";
import Modal from "./ui/Modal.jsx";
import GroupedAccountSelect from "./GroupedAccountSelect.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useAuth } from "../store/auth.jsx";
import { useAudit } from "../store/audit.jsx";
import { useRates } from "../store/rates.jsx";
import { fmt, curSymbol, multiplyAmount } from "../utils/money.js";
import { officeName } from "../store/data.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcCreateOtcDeal, withToast } from "../lib/supabaseWrite.js";

export default function OtcDealModal({ open, currentOffice, onClose, onCreated }) {
  const { accounts, balanceOf } = useAccounts();
  const { currentUser } = useAuth();
  const { addEntry: logAudit } = useAudit();
  const { getRate } = useRates();

  const activeAccounts = useMemo(() => accounts.filter((a) => a.active), [accounts]);

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [rate, setRate] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [note, setNote] = useState("");
  const [occurredAt, setOccurredAt] = useState(""); // datetime-local string
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setFromId("");
      setToId("");
      setFromAmount("");
      setToAmount("");
      setRate("");
      setCounterparty("");
      setNote("");
      setOccurredAt("");
    }
  }, [open]);

  const from = activeAccounts.find((a) => a.id === fromId);
  const to = activeAccounts.find((a) => a.id === toId);
  const sameAccount = fromId && toId && fromId === toId;
  const fromBalance = from ? balanceOf(from.id) : 0;
  const fromAmt = parseFloat(String(fromAmount).replace(",", ".")) || 0;
  const toAmt = parseFloat(String(toAmount).replace(",", ".")) || 0;
  const rateNum = parseFloat(String(rate).replace(",", ".")) || 0;
  const insufficient = from && fromAmt > fromBalance;

  // Auto-pull rate from system если from и to валюты различаются
  useEffect(() => {
    if (from && to && from.currency !== to.currency && !rate) {
      const r = getRate(from.currency, to.currency);
      if (r && Number.isFinite(r) && r > 0) setRate(String(r));
    }
  }, [from, to, rate, getRate]);

  // Auto-fill toAmount = fromAmount * rate если rate задан и toAmount пуст
  useEffect(() => {
    if (fromAmt > 0 && rateNum > 0 && !toAmount && from && to) {
      const computed = multiplyAmount(fromAmt, rateNum, 2);
      setToAmount(String(computed));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromAmt, rateNum]);

  const canSubmit =
    from &&
    to &&
    !sameAccount &&
    fromAmt > 0 &&
    toAmt > 0 &&
    rateNum > 0 &&
    counterparty.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || busy || !isSupabaseConfigured) return;
    setBusy(true);
    try {
      const occurredIso = occurredAt
        ? new Date(occurredAt).toISOString()
        : null;
      const res = await withToast(
        () =>
          rpcCreateOtcDeal({
            officeId: from.officeId,
            fromAccountId: from.id,
            fromAmount: fromAmt,
            toAccountId: to.id,
            toAmount: toAmt,
            rate: rateNum,
            counterparty: counterparty.trim(),
            note: note.trim(),
            occurredAt: occurredIso,
          }),
        {
          success: occurredIso
            ? `OTC сделка оформлена задним числом`
            : "OTC сделка создана",
          errorPrefix: "OTC failed",
        }
      );
      if (res.ok) {
        logAudit({
          action: "create",
          entity: "transaction",
          entityId: String(res.result || ""),
          summary: `OTC ${counterparty.trim()}: ${fmt(fromAmt, from.currency)} ${from.currency} → ${fmt(toAmt, to.currency)} ${to.currency} @ ${rateNum}${occurredIso ? ` (бэкдейт ${occurredAt})` : ""}`,
        });
        onCreated?.(res.result);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Сделка с контрагентом"
      subtitle="OTC обмен с партнёром — без fee/profit. Можно задним числом."
      width="lg"
    >
      <div className="p-5 space-y-3">
        {/* Counterparty */}
        <div>
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 mb-1.5 tracking-wide uppercase">
            <Users className="w-3.5 h-3.5" />
            Контрагент / Партнёр
          </label>
          <input
            type="text"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            placeholder="Имя партнёра / Название компании"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] outline-none transition-colors"
          />
        </div>

        {/* From */}
        <div>
          <label className="block text-[11px] font-bold text-rose-700 mb-1.5 tracking-wide uppercase">
            Отдаём
          </label>
          <GroupedAccountSelect
            accounts={activeAccounts}
            value={fromId}
            onChange={setFromId}
            placeholder="Выбрать счёт списания"
          />
          {from && (
            <div className="mt-1.5 text-[11px] text-slate-500 tabular-nums">
              {officeName(from.officeId)} · Баланс:{" "}
              <span className="font-bold text-slate-700">
                {curSymbol(from.currency)}
                {fmt(fromBalance, from.currency)} {from.currency}
              </span>
            </div>
          )}
          {from && (
            <div className="mt-2 relative flex items-baseline gap-2 bg-rose-50/60 rounded-[12px] border-2 border-rose-200 px-4 py-3">
              <span className="text-rose-500 text-[18px] font-semibold">
                {curSymbol(from.currency)}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={fromAmount}
                onChange={(e) =>
                  setFromAmount(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
                }
                placeholder="0"
                className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[20px] font-bold tracking-tight min-w-0"
              />
              <span className="text-rose-500 text-[12px] font-bold tracking-wider">
                {from.currency}
              </span>
            </div>
          )}
          {insufficient && (
            <div className="mt-1.5 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1 inline-flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Недостаточно средств на счёте
            </div>
          )}
        </div>

        {/* Arrow */}
        <div className="flex justify-center py-1">
          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
            <ArrowDown className="w-3.5 h-3.5 text-slate-500" />
          </div>
        </div>

        {/* To */}
        <div>
          <label className="block text-[11px] font-bold text-emerald-700 mb-1.5 tracking-wide uppercase">
            Получаем
          </label>
          <GroupedAccountSelect
            accounts={activeAccounts.filter((a) => a.id !== fromId)}
            value={toId}
            onChange={setToId}
            placeholder="Выбрать счёт зачисления"
          />
          {to && (
            <div className="mt-2 relative flex items-baseline gap-2 bg-emerald-50/60 rounded-[12px] border-2 border-emerald-200 px-4 py-3">
              <span className="text-emerald-600 text-[18px] font-semibold">
                {curSymbol(to.currency)}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={toAmount}
                onChange={(e) =>
                  setToAmount(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
                }
                placeholder="0"
                className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[20px] font-bold tracking-tight min-w-0"
              />
              <span className="text-emerald-600 text-[12px] font-bold tracking-wider">
                {to.currency}
              </span>
            </div>
          )}
        </div>

        {/* Rate */}
        {from && to && (
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1.5 tracking-wide uppercase">
              Курс ({from.currency} → {to.currency})
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={rate}
              onChange={(e) =>
                setRate(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
              }
              placeholder="0.00"
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[14px] font-bold tabular-nums outline-none"
            />
            <p className="text-[10.5px] text-slate-500 mt-1">
              {fromAmt > 0 && rateNum > 0 && (
                <>
                  {fmt(fromAmt, from.currency)} {from.currency} × {rateNum} ={" "}
                  <span className="font-bold text-slate-700">
                    {fmt(multiplyAmount(fromAmt, rateNum, 2), to.currency)} {to.currency}
                  </span>
                </>
              )}
            </p>
          </div>
        )}

        {/* Backdate */}
        <div>
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 mb-1.5 tracking-wide uppercase">
            <Calendar className="w-3.5 h-3.5" />
            Дата (опционально — оставь пусто для текущей)
          </label>
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
          />
          <p className="text-[10.5px] text-slate-500 mt-1">
            Сделка задним числом — useful для дозаписи прошедших OTC обменов.
          </p>
        </div>

        {/* Note */}
        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1.5 tracking-wide uppercase">
            Заметка
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="—"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
          />
        </div>
      </div>

      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors disabled:opacity-60"
        >
          Отмена
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || busy}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            canSubmit && !busy
              ? "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {busy ? "Создание…" : occurredAt ? "Создать (бэкдейт)" : "Создать сделку"}
        </button>
      </div>
    </Modal>
  );
}
