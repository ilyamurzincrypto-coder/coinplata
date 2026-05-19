// src/components/cashier/LegSidePill.jsx
// IN/OUT pill для leg row. Toggle при клике (между in ↔ out).

import React from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

const STYLES = {
  in: {
    bg: "bg-success-soft",
    border: "border-success/20",
    text: "text-success",
    Icon: ArrowDownLeft,
    label: "IN",
  },
  out: {
    bg: "bg-danger-soft",
    border: "border-danger/20",
    text: "text-danger",
    Icon: ArrowUpRight,
    label: "OUT",
  },
};

export default function LegSidePill({ side, onToggle, disabled = false }) {
  const s = STYLES[side] || STYLES.in;
  const Icon = s.Icon;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      title={side === "in" ? "Клиент даёт нам" : "Мы даём клиенту"}
      className={
        `inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-cell)] ` +
        `border ${s.bg} ${s.border} ${s.text} ` +
        `text-[11px] font-bold uppercase tracking-wider ` +
        `disabled:opacity-50 disabled:cursor-not-allowed ` +
        `hover:opacity-80 transition-opacity`
      }
    >
      <Icon className="w-3 h-3" />
      <span>{s.label}</span>
    </button>
  );
}
