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
import { withToast } from "../../lib/supabaseWrite.js";
import { createTopup } from "../../lib/dealOperations.js";

export default function TopUpModal({ account, onClose }) {
  const { t } = useTranslation();
  const { topUp, balanceOf } = useAccounts();
  const { currentUser } = useAuth();
  const { addEntry: logAudit } = useAudit();

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [source, setSource] = useState("external");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (account) {
      setAmount("");
      setNote("");
      // Дефолт source:
      //  • если баланс счёта нулевой → "opening" (первичный остаток после
      //    создания счёта с opening_balance=0 — обычный сценарий)
      //  • иначе по типу: bank → bank, crypto → crypto, иначе external
      const bal = balanceOf(account.id);
      const def =
        bal === 0
          ? "opening"
          : account.type === "bank"
          ? "bank"
          : account.type === "crypto"
          ? "crypto"
          : "external";
      setSource(def);
    }
  }, [account, balanceOf]);

  if (!account) return null;

  const amt = parseFloat(amount) || 0;
  const canSubmit = amt > 0;
  const currentBalance = balanceOf(account.id);

  const handleSubmit = async () => {
    if (!canSubmit || busy) return;
    const noteWithSource = note.trim()
      ? `[${source}] ${note.trim()}`
      : `[${source}]`;

    // source="opening" → DB source_kind='opening' (отдельно от 'topup' в
    // журнале и истории счёта). Остальные (external/bank/crypto) — source_kind='topup',
    // метаданные источника остаются в note.
    const sourceKind = source === "opening" ? "opening" : "topup";
    const successMsg = source === "opening" ? "Opening balance recorded" : "Top up recorded";

    if (isSupabaseConfigured) {
      setBusy(true);
      try {
        const res = await withToast(
          () => createTopup({ accountId: account.id, amount: amt, note: noteWithSource, sourceKind }),
          { success: successMsg, errorPrefix: "Top up failed" }
        );
        if (res.ok) {
          logAudit({
            action: "create",
            entity: "topup",
            entityId: String(res.result || ""),
            summary: `${source === "opening" ? "Opening balance" : "Top up"} ${account.name}: +${curSymbol(account.currency)}${fmt(amt, account.currency)} ${account.currency} · source: ${source}`,
          });
          onClose();
        }
      } finally {
        setBusy(false);
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
        <div className="bg-surface-soft rounded-card border border-border-soft px-4 py-3">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">
            {t("current_balance")}
          </div>
          <div className="text-[20px] font-bold tabular-nums tracking-tight text-ink">
            {curSymbol(account.currency)}
            {fmt(currentBalance, account.currency)}{" "}
            <span className="text-[12px] text-muted font-medium">{account.currency}</span>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-muted mb-1.5 tracking-wide uppercase">
            {t("topup_amount")}
          </label>
          <div
            className={`relative flex items-baseline gap-2 bg-surface-soft rounded-card border-2 transition-all px-4 py-3 ${
              amount ? "border-emerald-400" : "border-border-soft"
            }`}
          >
            <span className="text-muted-soft text-[18px] font-semibold">{curSymbol(account.currency)}</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
              placeholder="0"
              autoFocus
              className="flex-1 bg-transparent outline-none text-ink placeholder:text-muted-soft tabular-nums text-[22px] font-bold tracking-tight min-w-0"
            />
            <span className="text-muted-soft text-[12px] font-bold tracking-wider">{account.currency}</span>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-muted mb-1.5 tracking-wide uppercase">
            Source
          </label>
          <div className="inline-flex bg-surface-sunk p-0.5 rounded-card w-full gap-0.5 flex-wrap">
            {[
              { id: "opening", label: "Opening" },
              { id: "external", label: "External" },
              { id: "bank", label: "Bank" },
              { id: "crypto", label: "Crypto" },
            ].map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setSource(o.id)}
                className={`flex-1 px-3 py-2 text-[12px] font-semibold rounded-button transition-all ${
                  source === o.id ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-muted mb-1.5 tracking-wide uppercase">
            {t("topup_note")}
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="—"
            className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-card px-3 py-2.5 text-[13px] outline-none transition-colors"
          />
        </div>
      </div>

      <div className="px-5 py-4 border-t border-border-soft flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-card bg-surface-sunk text-ink-soft text-[13px] font-semibold hover:bg-surface-sunk transition-colors"
        >
          {t("cancel")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || busy}
          className={`px-4 py-2 rounded-card text-[13px] font-semibold transition-colors ${
            canSubmit && !busy
              ? "bg-success text-white hover:bg-emerald-600"
              : "bg-surface-sunk text-muted-soft cursor-not-allowed"
          }`}
        >
          {busy ? "Processing…" : t("topup_confirm")}
        </button>
      </div>
    </Modal>
  );
}
