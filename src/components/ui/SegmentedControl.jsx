// src/components/ui/SegmentedControl.jsx
//
// Apple-style segmented control. Активный сегмент — белая «карточка» с
// эмеральдовой рамкой и тенью (визуально парный с кнопкой «Новая сделка»
// на дашборде). Неактивные — приглушённые slate без бордера.

import React from "react";

export default function SegmentedControl({ options, value, onChange, size = "md" }) {
  const padding = size === "sm" ? "p-1" : "p-1.5";
  const btnSize =
    size === "sm" ? "px-3 py-1.5 text-[12.5px]" : "px-4 py-2 text-[13.5px]";
  return (
    <div className={`inline-flex bg-surface-sunk rounded-card relative ${padding}`}>
      {options.map((opt) => {
        const id = opt.id ?? opt;
        const label = opt.name ?? opt;
        const isActive = id === value;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`relative z-10 ${btnSize} font-semibold rounded-card transition-all duration-200 ${
              isActive
                ? "bg-white text-ink ring-2 ring-emerald-400 shadow-[0_4px_14px_-4px_rgba(16,185,129,0.35)]"
                : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
