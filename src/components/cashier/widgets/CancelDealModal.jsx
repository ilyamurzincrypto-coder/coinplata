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
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <div className="bg-white rounded-[var(--radius-section)] shadow-xl max-w-md w-full mx-4 flex flex-col">
        <header className="px-4 py-3 border-b border-border-soft flex items-center justify-between">
          <h2 id={titleId} className="text-[15px] font-bold text-ink">
            {t("cancel_modal_title")}
          </h2>
          <button
            type="button"
            onClick={busy ? undefined : onClose}
            disabled={busy}
            className="p-1 text-muted-soft hover:text-ink-soft disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-4 py-3 space-y-3" id={descId}>
          {workflow && (
            <div className="text-caption bg-surface-soft border border-border-soft rounded-[var(--radius-cell)] px-2.5 py-1.5">
              <span className="text-muted">Deal </span>
              <span className="font-mono text-ink-soft">
                {String(workflow.ledger_tx_id || workflow.deal_id || "").slice(0, 8)}…
              </span>
              {workflow.counterparty_name && (
                <>
                  <span className="text-muted-soft mx-1">·</span>
                  <span className="text-ink-soft">{workflow.counterparty_name}</span>
                </>
              )}
              {workflow.status && (
                <>
                  <span className="text-muted-soft mx-1">·</span>
                  <span className="text-ink-soft">{workflow.status}</span>
                </>
              )}
            </div>
          )}

          <div className="flex items-start gap-2 px-2.5 py-2 bg-warning-soft border border-warning/20 rounded-[var(--radius-cell)]">
            <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
            <p className="text-caption text-warning">{t("cancel_modal_warning")}</p>
          </div>

          <div>
            <label className="block text-tiny font-bold text-muted uppercase tracking-wider mb-1">
              {t("cancel_modal_reason_label")}
            </label>
            <textarea
              ref={textareaRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("cancel_modal_reason_placeholder")}
              rows={3}
              minLength={MIN_REASON}
              className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-[var(--radius-cell)] px-2.5 py-2 text-body-sm outline-none resize-none"
            />
            <div className={`text-tiny mt-1 ${valid ? "text-success" : "text-muted-soft"}`}>
              {t("cancel_modal_reason_min_chars").replace("{{n}}", String(reason.trim().length))}
            </div>
          </div>

          {errorMsg && (
            <div className="text-caption text-danger bg-danger-soft border border-danger/20 rounded-[var(--radius-cell)] px-2.5 py-1.5">
              {errorMsg}
            </div>
          )}
        </div>

        <footer className="px-4 py-3 border-t border-border-soft flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded-[var(--radius-cell)] bg-surface-sunk hover:bg-surface-sunk text-ink-soft text-caption font-semibold disabled:opacity-50"
          >
            {t("cancel_modal_back_button")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!valid || busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-cell)] bg-danger hover:bg-rose-700 text-white text-caption font-bold disabled:bg-surface-sunk disabled:text-muted-soft disabled:cursor-not-allowed"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {t("cancel_modal_submit_button")}
          </button>
        </footer>
      </div>
    </div>
  );
}
