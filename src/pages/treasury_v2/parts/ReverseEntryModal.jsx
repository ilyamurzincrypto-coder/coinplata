// src/pages/treasury_v2/parts/ReverseEntryModal.jsx
// Confirm-with-reason modal for reversing a posted transaction (a manual journal
// entry or a whole deal). Calls rpcReverseTransactionV2 — it triggers
// bumpDataVersion() via invokeLedger, so the Журнал refreshes on its own.
// `cascade` (default false): a manual entry reverses just itself; a deal is
// reversed with cascade=true so any auto-created workflow / settled legs unwind too.
import React, { useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { emitToast } from "../../../lib/toast.jsx";
import { rpcReverseTransactionV2 } from "../../../lib/newLedger.js";

export default function ReverseEntryModal({ tx, onClose, cascade = false }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length > 0;

  async function confirm() {
    if (!ok || busy) return;
    setBusy(true);
    try {
      await rpcReverseTransactionV2({ targetTxId: tx.id, reason: reason.trim(), cascade: !!cascade });
      emitToast("success", t("trv2_pm_reverse_done"));
      onClose();
    } catch (e) {
      const msg = String(e?.message || "");
      if (/42501|permission|authenticated|role/i.test(msg)) emitToast("error", t("trv2_pm_err_forbidden"));
      else emitToast("error", `${t("trv2_pm_err_generic")}: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-card-lg max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-3 border-b border-border-soft flex items-center justify-between">
          <h3 className="text-body font-bold">{cascade ? t("trv2_journal_undo_deal_title") : t("trv2_pm_reverse_title")}</h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-sunk"><X className="w-4 h-4" /></button>
        </header>
        <div className="p-5 space-y-3">
          <p className="text-caption text-muted">{tx.description || tx.id}</p>
          <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder={t("trv2_pm_reverse_reason_ph")}
            className="w-full bg-surface-soft border border-border-soft rounded-button px-2.5 py-2 text-caption outline-none" />
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-button text-caption text-ink-soft hover:bg-surface-sunk">{t("trv2_pm_reverse_cancel")}</button>
            <button onClick={confirm} disabled={!ok || busy}
              className="px-3 py-1.5 rounded-button text-caption font-semibold bg-danger text-white disabled:opacity-40">
              {t("trv2_pm_reverse_confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
