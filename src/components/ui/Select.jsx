// src/components/ui/Select.jsx
import React, { useState } from "react";
import { ChevronDown, Check } from "lucide-react";

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
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className={`w-full flex items-center justify-between gap-2 bg-white border border-slate-200 hover:border-slate-300 rounded-[10px] transition-colors ${
          compact ? "px-2.5 py-1.5 text-[13px]" : "px-3 py-2.5 text-[14px]"
        } text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {icon}
          <span className="truncate">{renderOption ? renderOption(value) : value || placeholder}</span>
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-[10px] shadow-lg shadow-slate-900/10 py-1 max-h-60 overflow-auto">
          {options.map((opt) => (
            <button
              key={typeof opt === "object" ? opt.id || opt.value : opt}
              type="button"
              onMouseDown={() => {
                onChange(opt);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-slate-50 flex items-center justify-between ${
                opt === value ? "text-slate-900 font-medium" : "text-slate-700"
              }`}
            >
              <span>{renderOption ? renderOption(opt) : opt}</span>
              {opt === value && <Check className="w-3.5 h-3.5 text-slate-900" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
