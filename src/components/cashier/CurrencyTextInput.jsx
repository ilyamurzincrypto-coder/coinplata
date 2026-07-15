// src/components/cashier/CurrencyTextInput.jsx
// Input с маской по decimals выбранной валюты.
// При blur форматирует число по valueDecimals, но в state кладёт raw string
// (DealForm-state хранит amounts как string чтобы не терять trailing zeros).

import React, { useEffect, useRef } from "react";
import { useCurrencies } from "../../store/currencies.jsx";

export default function CurrencyTextInput({
  value,
  onChange,
  currencyCode,
  placeholder = "0",
  ariaLabel,
  className = "",
  align = "right",
  onKeyDown,
  inputRef,
  disabled = false,
}) {
  const { dict } = useCurrencies();
  const decimals = (dict[currencyCode]?.decimals ?? 2);
  const localRef = useRef(null); // хук должен вызываться безусловно (rules-of-hooks)
  const ref = inputRef || localRef;

  // Allow only digits + one decimal separator (`.` или `,`).
  // Replace `,` to `.` для consistency.
  const handleChange = (e) => {
    let raw = e.target.value;
    raw = raw.replace(/,/g, ".");
    // Запретить multiple dots
    const parts = raw.split(".");
    if (parts.length > 2) raw = parts[0] + "." + parts.slice(1).join("");
    // Запретить non-numeric
    raw = raw.replace(/[^\d.]/g, "");
    // Ограничить decimals по валюте
    if (decimals === 0) {
      raw = raw.replace(".", "");
    } else {
      const m = raw.match(/^(\d*)(\.(\d*))?$/);
      if (m && m[3] && m[3].length > decimals) {
        raw = m[1] + "." + m[3].slice(0, decimals);
      }
    }
    onChange(raw);
  };

  const handleBlur = () => {
    if (!value) return;
    const num = Number(value);
    if (!Number.isFinite(num)) return;
    onChange(num.toFixed(decimals));
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      value={value || ""}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      className={
        `w-full bg-transparent border-0 outline-none ` +
        `text-body tabular-nums ${align === "right" ? "text-right" : "text-left"} ` +
        `placeholder:text-muted-soft ` +
        `focus:bg-white focus:ring-1 focus:ring-accent/20 rounded-[var(--radius-cell)] px-2 py-1.5 ` +
        `disabled:text-muted-soft ${className}`
      }
    />
  );
}
