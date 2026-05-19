// src/components/cashier/CurrencyPicker.jsx
// Compact dropdown для выбора currency. Использует useCurrencies dict.

import React from "react";
import { useCurrencies } from "../../store/currencies.jsx";

export default function CurrencyPicker({
  value,
  onChange,
  ariaLabel,
  onKeyDown,
  inputRef,
  disabled = false,
  className = "",
}) {
  const { codes } = useCurrencies();
  return (
    <select
      ref={inputRef}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      aria-label={ariaLabel}
      disabled={disabled}
      className={
        `bg-transparent border-0 outline-none text-[13px] font-semibold tabular-nums ` +
        `focus:bg-white focus:ring-1 focus:ring-accent/20 rounded-[var(--radius-cell)] ` +
        `px-2 py-1.5 cursor-pointer w-full ` +
        `disabled:cursor-not-allowed disabled:opacity-50 ${className}`
      }
    >
      <option value="">—</option>
      {codes.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
  );
}
