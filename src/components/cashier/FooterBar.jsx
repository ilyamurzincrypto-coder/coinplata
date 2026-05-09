// src/components/cashier/FooterBar.jsx
// Sticky bottom 64px footer: LivePreview слева + SubmitCTA справа.
// Также включает undo/redo buttons (перенесены из stage 2.5 footer).

import React from "react";
import { Undo2, Redo2 } from "lucide-react";
import LivePreview from "./LivePreview.jsx";
import SubmitCTA from "./SubmitCTA.jsx";
import { useTranslation } from "../../i18n/translations.jsx";

export default function FooterBar({
  legs,
  totalIn,
  totalOut,
  conditions,
  hasOverdraft,
  hasShortage,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSubmit,
  onSubmitDraft,
  onSubmitAndNotify,
  submitDisabled,
  submitDisabledReason,
  loading,
  validation,
}) {
  const { t } = useTranslation();
  return (
    <div
      className="px-4 border-t border-slate-200 bg-slate-50/40 flex items-center gap-3"
      style={{ minHeight: "var(--footer-bar-height)" }}
    >
      {/* Undo/Redo */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Отменить (Ctrl/Cmd+Z)"
          className="p-1.5 rounded-[var(--radius-cell)] text-slate-500 hover:bg-slate-200 disabled:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Повторить (Ctrl/Cmd+Shift+Z)"
          className="p-1.5 rounded-[var(--radius-cell)] text-slate-500 hover:bg-slate-200 disabled:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Live preview — растягивается */}
      <div className="flex-1 min-w-0">
        <LivePreview
          legs={legs}
          totalIn={totalIn}
          totalOut={totalOut}
          conditions={conditions}
          hasOverdraft={hasOverdraft}
          hasShortage={hasShortage}
        />
      </div>

      {/* Submit */}
      <SubmitCTA
        onSubmit={onSubmit}
        onSubmitDraft={onSubmitDraft}
        onSubmitAndNotify={onSubmitAndNotify}
        loading={loading}
        disabled={submitDisabled}
        disabledTitle={submitDisabledReason || t("submit_disabled_tooltip")}
        validation={validation}
      />
    </div>
  );
}
