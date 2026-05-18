// src/components/deal-form/DealHeader.jsx
// Top-bar новой формы сделки. Phase 1: simple input для имени клиента
// (без autocomplete, без chip) + кнопки close/minimize.
// Phase 2 — добавим DealClientAutocomplete (с dropdown + meta + ★ Реферал).

import React from "react";
import { Minus, X } from "lucide-react";

export default function DealHeader({
  counterparty,
  onCounterpartyChange,
  onClose,
  onMinimize,
}) {
  return (
    <div className="px-7 pt-5 pb-4 border-b border-border-soft flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <input
          type="text"
          value={counterparty}
          onChange={(e) => onCounterpartyChange(e.target.value)}
          placeholder="Имя клиента или контрагента"
          className="flex-1 max-w-md h-10 px-3.5 rounded-input bg-surface-sunk text-ink placeholder:text-muted-soft text-body border-0 ring-1 ring-inset ring-transparent focus:bg-surface focus:ring-accent focus:shadow-input-focus focus:outline-none transition-all duration-150 ease-apple"
          autoFocus
        />
      </div>
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
