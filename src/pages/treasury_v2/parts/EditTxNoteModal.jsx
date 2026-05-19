// src/pages/treasury_v2/parts/EditTxNoteModal.jsx
// Edit a transaction's free-text note/comment via ledger.update_tx_metadata (whitelist
// patch — `comment` is an allowed key). The Dr/Cr lines are immutable; to change amounts
// reverse the deal ("Отменить сделку") and create it again. update_tx_metadata bumps the
// data version via invokeLedger, so the Журнал refreshes on its own.
import React, { useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { emitToast } from "../../../lib/toast.jsx";
import { rpcUpdateTxMetadataV2 } from "../../../lib/newLedger.js";

export default function EditTxNoteModal({ tx, onClose }) {
  const { t } = useTranslation();
  const [note, setNote] = useState(tx?.metadata?.comment || "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await rpcUpdateTxMetadataV2({ txId: tx.id, patch: { comment: note.trim() } });
      emitToast("success", t("trv2_tx_note_saved"));
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
          <h3 className="text-[14px] font-bold">{t("trv2_tx_note_title")}</h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-sunk"><X className="w-4 h-4" /></button>
        </header>
        <div className="p-5 space-y-3">
          <p className="text-[12px] text-muted">{tx.description || tx.id}</p>
          <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={3}
            placeholder={t("trv2_tx_note_ph")}
            className="w-full bg-surface-soft border border-border-soft rounded-button px-2.5 py-2 text-[12.5px] outline-none" />
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-button text-[12.5px] text-ink-soft hover:bg-surface-sunk">{t("trv2_pm_reverse_cancel")}</button>
            <button onClick={save} disabled={busy}
              className="px-3 py-1.5 rounded-button text-[12.5px] font-semibold bg-ink text-white disabled:opacity-40">
              {busy ? "…" : t("trv2_tx_note_save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
