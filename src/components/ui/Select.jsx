// src/components/ui/Select.jsx
// Поддерживает два формата options:
//   1) массив строк:              ["EN", "RU", "TR"]
//   2) массив {value, label}:     [{value: "all", label: "All"}, ...]
// Кастомный renderOption получает "сырой" option (строку или объект).

import React, { useState, useMemo } from "react";
import { ChevronDown, Check } from "lucide-react";

function normalizeOption(opt) {
  if (opt && typeof opt === "object" && "value" in opt) {
    return { value: opt.value, label: opt.label ?? String(opt.value), raw: opt };
  }
  return { value: opt, label: String(opt ?? ""), raw: opt };
}

export default function Select({
  value,
  onChange,
  options,
  icon,
  compact = false,
  renderOption,
  placeholder,
}) {
  const [open, setOpen] = useState(false);

  const normalizedOptions = useMemo(
    () => (options || []).map(normalizeOption),
    [options]
  );

  const currentLabel = useMemo(() => {
    const found = normalizedOptions.find((o) => o.value === value);
    if (found) {
      return renderOption ? renderOption(found.raw) : found.label;
    }
    // value не найден в options — показываем что есть (primitive) или placeholder
    if (value === null || value === undefined || value === "") return placeholder;
    return renderOption ? renderOption(value) : String(value);
  }, [normalizedOptions, value, renderOption, placeholder]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className={`w-full flex items-center justify-between gap-2 bg-white border border-border-soft hover:border-border rounded-card transition-colors ${
          compact ? "px-2.5 py-1.5 text-[13px]" : "px-3 py-2.5 text-[14px]"
        } text-ink focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {icon}
          <span className="truncate">{currentLabel}</span>
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-soft transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-border-soft rounded-card shadow-lg shadow-soft py-1 max-h-60 overflow-auto">
          {normalizedOptions.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                onMouseDown={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-surface-soft flex items-center justify-between ${
                  isSelected ? "text-ink font-medium" : "text-ink-soft"
                }`}
              >
                <span>{renderOption ? renderOption(opt.raw) : opt.label}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-ink" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
