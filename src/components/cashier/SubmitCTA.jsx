// src/components/cashier/SubmitCTA.jsx
// Split-button: primary "Create deal" + dropdown с альтернативными actions.

import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { useTranslation } from "../../i18n/translations.jsx";

export default function SubmitCTA({
  onSubmit,
  onSubmitDraft,
  onSubmitAndNotify,
  loading = false,
  disabled = false,
  disabledTitle,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const isDisabled = disabled || loading;

  return (
    <div
      ref={ref}
      className="relative inline-flex items-stretch shadow-sm"
      title={disabled && disabledTitle ? disabledTitle : undefined}
    >
      <button
        type="button"
        onClick={isDisabled ? undefined : onSubmit}
        disabled={isDisabled}
        className={
          "inline-flex items-center gap-1.5 px-4 py-2 rounded-l-[var(--radius-section)] " +
          "text-[12.5px] font-bold uppercase tracking-wider " +
          (isDisabled
            ? "bg-slate-200 text-slate-400 cursor-not-allowed "
            : "bg-indigo-600 hover:bg-indigo-700 text-white ")
        }
      >
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        <span>{loading ? t("deal_loading") : t("submit_create_deal")}</span>
      </button>
      <button
        type="button"
        onClick={isDisabled ? undefined : () => setOpen((v) => !v)}
        disabled={isDisabled}
        aria-label="More actions"
        className={
          "inline-flex items-center px-2 py-2 border-l rounded-r-[var(--radius-section)] " +
          (isDisabled
            ? "bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed "
            : "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-700 ")
        }
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && !isDisabled && (
        <div className="absolute right-0 bottom-full mb-1 z-20 bg-white border border-slate-200 shadow-lg rounded-[var(--radius-cell)] py-1 min-w-[220px]">
          <button
            type="button"
            onClick={() => { setOpen(false); onSubmitDraft?.(); }}
            className="block w-full text-left px-3 py-2 text-[12.5px] text-slate-700 hover:bg-slate-50"
          >
            {t("submit_save_draft")}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); onSubmitAndNotify?.(); }}
            className="block w-full text-left px-3 py-2 text-[12.5px] text-slate-700 hover:bg-slate-50"
          >
            {t("submit_create_and_notify")}
          </button>
        </div>
      )}
    </div>
  );
}
