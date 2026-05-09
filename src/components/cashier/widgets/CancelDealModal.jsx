// src/components/cashier/widgets/CancelDealModal.jsx
// Replaces window.prompt с full UI modal для cancel workflow.
// Validation: reason >= 5 chars. Keyboard: Esc close, Cmd+Enter submit.

import React, { useEffect, useRef, useState } from "react";
import { X, Loader2, AlertTriangle } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";

const MIN_REASON = 5;

export default function CancelDealModal({
  isOpen,
  onClose,
  onConfirm,
  workflow,
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const textareaRef = useRef(null);
  const triggerRef = useRef(null);

  // Track triggering element для focus return
  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement;
      // autoFocus textarea
      setTimeout(() => textareaRef.current?.focus(), 0);
      setReason("");
      setErrorMsg(null);
      setBusy(false);
    } else if (triggerRef.current && typeof triggerRef.current.focus === "function") {
      triggerRef.current.focus();
    }
  }, [isOpen]);

  const valid = reason.trim().length >= MIN_REASON;

  const handleSubmit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await onConfirm(reason.trim());
      // onConfirm caller вызывает onClose
    } catch (err) {
      setErrorMsg(err.message || "Failed");
      setBusy(false);
    }
  };

  // Keyboard
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busy) onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, busy, valid, reason]);

  if (!isOpen) return null;

  const titleId = "cancel-modal-title";
  const descId = "cancel-modal-desc";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <div className="bg-white rounded-[var(--radius-section)] shadow-xl max-w-md w-full mx-4 flex flex-col">
        <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 id={titleId} className="text-[15px] font-bold text-slate-900">
            {t("cancel_modal_title")}
          </h2>
          <button
            type="button"
            onClick={busy ? undefined : onClose}
            disabled={busy}
            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-4 py-3 space-y-3" id={descId}>
          {workflow && (
            <div className="text-[12px] bg-slate-50 border border-slate-200 rounded-[var(--radius-cell)] px-2.5 py-1.5">
              <span className="text-slate-500">Deal </span>
              <span className="font-mono text-slate-700">
                {String(workflow.ledger_tx_id || workflow.deal_id || "").slice(0, 8)}…
              </span>
              {workflow.counterparty_name && (
                <>
                  <span className="text-slate-400 mx-1">·</span>
                  <span className="text-slate-700">{workflow.counterparty_name}</span>
                </>
              )}
              {workflow.status && (
                <>
                  <span className="text-slate-400 mx-1">·</span>
                  <span className="text-slate-600">{workflow.status}</span>
                </>
              )}
            </div>
          )}

          <div className="flex items-start gap-2 px-2.5 py-2 bg-amber-50 border border-amber-200 rounded-[var(--radius-cell)]">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-[12px] text-amber-900">{t("cancel_modal_warning")}</p>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              {t("cancel_modal_reason_label")}
            </label>
            <textarea
              ref={textareaRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("cancel_modal_reason_placeholder")}
              rows={3}
              minLength={MIN_REASON}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[var(--radius-cell)] px-2.5 py-2 text-[13px] outline-none resize-none"
            />
            <div className={`text-[10px] mt-1 ${valid ? "text-emerald-600" : "text-slate-400"}`}>
              {t("cancel_modal_reason_min_chars").replace("{{n}}", String(reason.trim().length))}
            </div>
          </div>

          {errorMsg && (
            <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-[var(--radius-cell)] px-2.5 py-1.5">
              {errorMsg}
            </div>
          )}
        </div>

        <footer className="px-4 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded-[var(--radius-cell)] bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12.5px] font-semibold disabled:opacity-50"
          >
            {t("cancel_modal_back_button")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!valid || busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-cell)] bg-rose-600 hover:bg-rose-700 text-white text-[12.5px] font-bold disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {t("cancel_modal_submit_button")}
          </button>
        </footer>
      </div>
    </div>
  );
}
