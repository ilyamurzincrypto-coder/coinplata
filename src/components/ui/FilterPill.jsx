// src/components/ui/FilterPill.jsx
//
// Filter pill — фильтр-кнопка с опциональным счётчиком.
//
// <FilterPill active label="Все" count={47} onClick={...} />
import React from "react";

export default function FilterPill({
  label,
  count = null,
  active = false,
  onClick = null,
  icon: Icon = null,
  className = "",
  ...rest
}) {
  return (
    <button
      {...rest}
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-pill text-caption font-medium transition-colors duration-150 ease-apple ${
        active
          ? "bg-ink text-white"
          : "bg-surface text-ink border border-border hover:bg-surface-soft"
      } ${className}`.trim()}
    >
      {Icon && <Icon size={12} strokeWidth={2.2} />}
      {label}
      {count != null && (
        <span className="font-mono text-[10px] opacity-60 tabular">{count}</span>
      )}
    </button>
  );
}
