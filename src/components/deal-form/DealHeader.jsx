// src/components/deal-form/DealHeader.jsx
// Top-bar новой формы сделки. Phase 2: client autocomplete с dropdown.
// onSelectClient прокидывается наверх (для Phase 3 — auto-referral toggle).

import React from "react";
import { Minus, X } from "lucide-react";
import DealClientAutocomplete from "./DealClientAutocomplete.jsx";

export default function DealHeader({
  counterparty,
  onCounterpartyChange,
  onSelectClient,
  onClose,
  onMinimize,
}) {
  return (
    <div className="px-7 pt-5 pb-4 border-b border-border-soft flex items-center justify-between gap-3">
      <DealClientAutocomplete
        value={counterparty}
        onChange={onCounterpartyChange}
        onSelectClient={onSelectClient}
        autoFocus
      />
      <div className="flex items-center gap-1 shrink-0">
        {onMinimize && (
          <button
            type="button"
            onClick={onMinimize}
            title="Свернуть"
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-surface-soft transition-colors"
          >
            <Minus className="w-4 h-4" strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Закрыть (Esc)"
          className="w-8 h-8 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-surface-soft transition-colors"
        >
          <X className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
