// src/components/cashier/ChipPill.jsx
// Reusable pill-chip с states: default / active / disabled.
// Используется в ConditionsBar и OnDemandPanel.

import React from "react";
import { Check } from "lucide-react";

const STYLES = {
  default: {
    bg: "bg-slate-100 hover:bg-slate-200",
    text: "text-slate-600",
    border: "border-slate-200",
  },
  active: {
    bg: "bg-indigo-50 hover:bg-indigo-100",
    text: "text-indigo-700",
    border: "border-indigo-300",
  },
  disabled: {
    bg: "bg-slate-50",
    text: "text-slate-300",
    border: "border-slate-100",
  },
};

export default function ChipPill({
  active = false,
  disabled = false,
  onClick,
  children,
  title,
  showCheck = true,
}) {
  const variant = disabled ? "disabled" : active ? "active" : "default";
  const s = STYLES[variant];

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      title={title}
      className={
        `inline-flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-cell)] ` +
        `border ${s.bg} ${s.border} ${s.text} ` +
        `text-[12px] font-semibold transition-colors ` +
        `disabled:cursor-not-allowed`
      }
    >
      {showCheck && active && <Check className="w-3 h-3" />}
      <span>{children}</span>
    </button>
  );
}
