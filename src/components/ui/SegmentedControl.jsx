// src/components/ui/SegmentedControl.jsx
import React from "react";

export default function SegmentedControl({ options, value, onChange, size = "md" }) {
  return (
    <div className={`inline-flex bg-slate-100 rounded-[11px] relative ${size === "sm" ? "p-0.5" : "p-1"}`}>
      {options.map((opt) => {
        const id = opt.id ?? opt;
        const label = opt.name ?? opt;
        const isActive = id === value;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`relative z-10 ${
              size === "sm" ? "px-3 py-1 text-[12px]" : "px-4 py-1.5 text-[13px]"
            } font-semibold rounded-[9px] transition-all ${
              isActive
                ? "bg-white text-slate-900 shadow-[0_1px_3px_rgba(0,0,0,0.08),0_0_0_0.5px_rgba(0,0,0,0.05)]"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
