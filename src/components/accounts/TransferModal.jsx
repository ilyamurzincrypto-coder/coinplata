// src/components/accounts/TransferModal.jsx
// Перевод между счетами. Поддерживает cross-currency через явный rate.

import React, { useState, useEffect, useMemo } from "react";
import { ArrowRight, AlertCircle } from "lucide-react";
import Modal from "../ui/Modal.jsx";
import GroupedAccountSelect from "../GroupedAccountSelect.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useAuth } from "../../store/auth.jsx";
import { useAudit } from "../../store/audit.jsx";
import { useRates } from "../../store/rates.jsx";
import { useTranslation } from "../../i18n/translations.jsx";
import { fmt, curSymbol, multiplyAmount } from "../../utils/money.js";
import { officeName } from "../../store/data.js";
import { isSupabaseConfigured } from "../../lib/supabase.js";
import { rpcCreateTransfer, withToast } from "../../lib/supabaseWrite.js";

export default function TransferModal({ open, fromAccount, onClose }) {
  const { t } = useTranslation();
  const { accounts, transfer, balanceOf } = useAccounts();
  const { currentUser } = useAuth();
  const { addEntry: logAudit } = useAudit();
  const { getRate } = useRates();

  const activeAccounts = useMemo(() => accounts.filter((a) => a.active), [accounts]);

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [fromAmount, setFromAmount] = useState("");
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setFromId(fromAccount?.id || "");
      setToId("");
      setFromAmount("");
      setRate("");
      setNote("");
    }
  }, [open, fromAccount]);

  const from = activeAccounts.find((a) => a.id === fromId);
  const to = activeAccounts.find((a) => a.id === toId);
  const sameCurrency = from && to && from.currency === to.currency;
  const needsRate = from && to && from.currency !== to.currency;

  // Auto-pull rate для cross-currency
  useEffect(() => {
    if (needsRate && from && to && !rate) {
      const r = getRate(from.currency, to.currency);
      if (r) setRate(String(r));
    }
  }, [needsRate, from, to, rate, getRate]);

  const fromAmt = parseFloat(fromAmount) || 0;
  const rateNum = parseFloat(rate) || 0;

  // Расчёт toAmount
  const toAmount = useMemo(() => {
    if (!fromAmt) return 0;
    if (sameCurrency) return fromAmt;
    if (needsRate && rateNum > 0) return multiplyAmount(fromAmt, rateNum, 2);
    return 0;
  }, [fromAmt, sameCurrency, needsRate, rateNum]);

  // Validation
  const sameAccount = fromId && toId && fromId === toId;
  const fromBalance = from ? balanceOf(from.id) : 0;
  const insufficient = from && fromAmt > fromBalance;

  const canSubmit =
    from &&
    to &&
    !sameAccount &&
    fromAmt > 0 &&
    (sameCurrency || (needsRate && rateNum > 0));

  const handleSubmit = async () => {
    if (!canSubmit) return;

    if (isSupabaseConfigured) {
      const res = await withToast(
        () =>
          rpcCreateTransfer({
            fromAccountId: from.id,
            toAccountId: to.id,
            fromAmount: fromAmt,
            toAmount,
            rate: sameCurrency ? null : rateNum,
            note: note.trim(),
          }),
        { success: "Transfer recorded", errorPrefix: "Transfer failed" }
      );
      if (res.ok) {
        logAudit({
          action: "create",
          entity: "transfer",
          entityId: String(res.result || ""),
          summary: `${from.name} → ${to.name}: ${curSymbol(from.currency)}${fmt(fromAmt, from.currency)} ${from.currency}${sameCurrency ? "" : ` → ${curSymbol(to.currency)}${fmt(toAmount, to.currency)} ${to.currency} @ ${rateNum}`}`,
        });
        onClose();
      }
      return;
    }

    const rec = transfer({
      fromAccountId: from.id,
      toAccountId: to.id,
      fromAmount: fromAmt,
      toAmount,
      fromCurrency: from.currency,
      toCurrency: to.currency,
      rate: sameCurrency ? null : rateNum,
      note: note.trim(),
      createdBy: currentUser.id,
    });
    logAudit({
      action: "create",
      entity: "transfer",
      entityId: rec.id,
      summary: `${from.name} → ${to.name}: ${curSymbol(from.currency)}${fmt(fromAmt, from.currency)} ${from.currency}${sameCurrency ? "" : ` → ${curSymbol(to.currency)}${fmt(toAmount, to.currency)} ${to.currency} @ ${rateNum}`}`,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t("transfer_title")} width="lg">
      <div className="p-5 space-y-3">
        {/* From */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            {t("transfer_from")}
          </label>
          <GroupedAccountSelect
            accounts={activeAccounts}
            value={fromId}
            onChange={setFromId}
            placeholder={t("select_account")}
          />
          {from && (
            <div className="mt-1.5 text-[11px] text-slate-500 tabular-nums">
              {officeName(from.officeId)} · {t("current_balance")}:{" "}
              <span className="font-bold text-slate-700">
                {curSymbol(from.currency)}
                {fmt(fromBalance, from.currency)} {from.currency}
              </span>
            </div>
          )}
        </div>

        {/* Arrow indicator */}
        <div className="flex justify-center py-1">
          <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center">
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
          </div>
        </div>

        {/* To */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            {t("transfer_to")}
          </label>
          <GroupedAccountSelect
            accounts={activeAccounts.filter((a) => a.id !== fromId)}
            value={toId}
            onChange={setToId}
            placeholder={t("select_account")}
          />
        </div>

        {sameAccount && (
          <div className="text-[12px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {t("transfer_same_account")}
          </div>
        )}

        {/* Amount sent */}
        {from && (
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
              {t("transfer_amount_sent")}
            </label>
            <div
              className={`relative flex items-baseline gap-2 bg-slate-50 rounded-[12px] border-2 transition-all px-4 py-3 ${
                fromAmount ? (insufficient ? "border-amber-400" : "border-slate-400") : "border-slate-200"
              }`}
            >
              <span className="text-slate-400 text-[18px] font-semibold">{curSymbol(from.currency)}</span>
              <input
                type="text"
                inputMode="decimal"
                value={fromAmount}
                onChange={(e) => setFromAmount(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
                placeholder="0"
                className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[22px] font-bold tracking-tight min-w-0"
              />
              <span className="text-slate-400 text-[12px] font-bold tracking-wider">{from.currency}</span>
            </div>
            {insufficient && (
              <div className="mt-1.5 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1 inline-flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {t("transfer_insufficient")}
              </div>
            )}
          </div>
        )}

        {/* Rate для cross-currency */}
        {needsRate && (
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
              {t("transfer_rate")} ({from.currency} → {to.currency})
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
              placeholder="0.00"
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[14px] font-bold tabular-nums outline-none"
            />
            <p className="text-[11px] text-slate-500 mt-1">{t("transfer_cross_hint")}</p>
          </div>
        )}

        {/* Amount received (computed) */}
        {to && (fromAmt > 0) && (sameCurrency || (needsRate && rateNum > 0)) && (
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
              {t("transfer_amount_received")}
            </label>
            <div className="relative flex items-baseline gap-2 bg-emerald-50 rounded-[12px] border-2 border-emerald-300 px-4 py-3">
              <span className="text-emerald-600 text-[18px] font-semibold">{curSymbol(to.currency)}</span>
              <div className="flex-1 text-slate-900 tabular-nums text-[22px] font-bold tracking-tight">
                {fmt(toAmount, to.currency)}
              </div>
              <span className="text-emerald-600 text-[12px] font-bold tracking-wider">{to.currency}</span>
            </div>
          </div>
        )}

        {/* Note */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            {t("topup_note")}
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="—"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] outline-none transition-colors"
          />
        </div>
      </div>

      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors"
        >
          {t("cancel")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            canSubmit
              ? "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {t("transfer_confirm")}
        </button>
      </div>
    </Modal>
  );
}
