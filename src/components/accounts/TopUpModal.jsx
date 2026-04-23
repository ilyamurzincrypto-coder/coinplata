// src/components/accounts/TopUpModal.jsx
// Пополнение счёта — создаёт одно движение "in".

import React, { useState, useEffect } from "react";
import Modal from "../ui/Modal.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useAuth } from "../../store/auth.jsx";
import { useAudit } from "../../store/audit.jsx";
import { useTranslation } from "../../i18n/translations.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import { isSupabaseConfigured } from "../../lib/supabase.js";
import { rpcTopUp, withToast } from "../../lib/supabaseWrite.js";

export default function TopUpModal({ account, onClose }) {
  const { t } = useTranslation();
  const { topUp, balanceOf } = useAccounts();
  const { currentUser } = useAuth();
  const { addEntry: logAudit } = useAudit();

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [source, setSource] = useState("external");

  useEffect(() => {
    if (account) {
      setAmount("");
      setNote("");
      // Дефолт source по типу счёта: bank → bank, crypto → crypto, иначе external.
      const def =
        account.type === "bank"
          ? "bank"
          : account.type === "crypto"
          ? "crypto"
          : "external";
      setSource(def);
    }
  }, [account]);

  if (!account) return null;

  const amt = parseFloat(amount) || 0;
  const canSubmit = amt > 0;
  const currentBalance = balanceOf(account.id);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const noteWithSource = note.trim()
      ? `[${source}] ${note.trim()}`
      : `[${source}]`;

    if (isSupabaseConfigured) {
      const res = await withToast(
        () => rpcTopUp({ accountId: account.id, amount: amt, note: noteWithSource }),
        { success: "Top up recorded", errorPrefix: "Top up failed" }
      );
      if (res.ok) {
        logAudit({
          action: "create",
          entity: "topup",
          entityId: String(res.result || ""),
          summary: `Top up ${account.name}: +${curSymbol(account.currency)}${fmt(amt, account.currency)} ${account.currency} · source: ${source}`,
        });
        onClose();
      }
      return;
    }

    const mv = topUp({
      accountId: account.id,
      amount: amt,
      currency: account.currency,
      note: noteWithSource,
      createdBy: currentUser.id,
    });
    logAudit({
      action: "create",
      entity: "topup",
      entityId: mv.id,
      summary: `Top up ${account.name}: +${curSymbol(account.currency)}${fmt(amt, account.currency)} ${account.currency} · source: ${source}`,
    });
    onClose();
  };

  return (
    <Modal open={!!account} onClose={onClose} title={t("topup_title")} subtitle={account.name} width="md">
      <div className="p-5 space-y-4">
        <div className="bg-slate-50 rounded-[10px] border border-slate-200 px-4 py-3">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            {t("current_balance")}
          </div>
          <div className="text-[20px] font-bold tabular-nums tracking-tight text-slate-900">
            {curSymbol(account.currency)}
            {fmt(currentBalance, account.currency)}{" "}
            <span className="text-[12px] text-slate-500 font-medium">{account.currency}</span>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            {t("topup_amount")}
          </label>
          <div
            className={`relative flex items-baseline gap-2 bg-slate-50 rounded-[12px] border-2 transition-all px-4 py-3 ${
              amount ? "border-emerald-400" : "border-slate-200"
            }`}
          >
            <span className="text-slate-400 text-[18px] font-semibold">{curSymbol(account.currency)}</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
              placeholder="0"
              autoFocus
              className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[22px] font-bold tracking-tight min-w-0"
            />
            <span className="text-slate-400 text-[12px] font-bold tracking-wider">{account.currency}</span>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Source
          </label>
          <div className="inline-flex bg-slate-100 p-0.5 rounded-[10px] w-full gap-0.5">
            {[
              { id: "external", label: "External" },
              { id: "bank", label: "Bank" },
              { id: "crypto", label: "Crypto" },
            ].map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setSource(o.id)}
                className={`flex-1 px-3 py-2 text-[12px] font-semibold rounded-[8px] transition-all ${
                  source === o.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

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
              ? "bg-emerald-500 text-white hover:bg-emerald-600"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {t("topup_confirm")}
        </button>
      </div>
    </Modal>
  );
}
