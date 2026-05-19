// src/components/cashier/RateCell.jsx
// Input для rate (только для OUT legs). Source — market по default.
// Когда юзер редактирует — переключаем rateManual=true автоматически.

import React from "react";
import { Edit2 } from "lucide-react";

export default function RateCell({
  value,
  onChange,
  onMarkManual,
  manual = false,
  marketRate,
  onKeyDown,
  inputRef,
  disabled = false,
  ariaLabel,
}) {
  const handleChange = (e) => {
    let raw = e.target.value;
    raw = raw.replace(/,/g, ".").replace(/[^\d.]/g, "");
    const parts = raw.split(".");
    if (parts.length > 2) raw = parts[0] + "." + parts.slice(1).join("");
    onChange(raw);
    if (!manual && onMarkManual) onMarkManual();
  };

  const handleResetMarket = () => {
    if (marketRate != null) {
      onChange(String(marketRate));
      if (manual && onMarkManual) onMarkManual(false);
    }
  };

  return (
    <div className="relative w-full flex items-center gap-1">
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={value || ""}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        placeholder={marketRate ? String(marketRate) : "rate"}
        aria-label={ariaLabel}
        disabled={disabled}
        className={
          `w-full bg-transparent border-0 outline-none ` +
          `text-body-sm tabular-nums text-right ` +
          `placeholder:text-muted-soft ` +
          `focus:bg-white focus:ring-1 focus:ring-accent/20 rounded-[var(--radius-cell)] px-2 py-1.5 ` +
          (manual ? "text-warning font-semibold " : "text-ink-soft ") +
          `disabled:opacity-50`
        }
      />
      {manual && marketRate != null && (
        <button
          type="button"
          onClick={handleResetMarket}
          title={`Сбросить на market: ${marketRate}`}
          className="absolute right-0 -translate-y-1/2 top-1/2 mr-0.5 p-0.5 text-warning hover:text-warning"
        >
          <Edit2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
