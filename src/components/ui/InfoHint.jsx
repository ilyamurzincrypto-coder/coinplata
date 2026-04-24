// src/components/ui/InfoHint.jsx
// Расширенная подсказка: hover по ⓘ-иконке показывает popover с текстом.
// В отличие от browser native title (маленький, задержка, обрезается) —
// большой, читаемый, сразу появляется. Работает и на mobile (tap).

import React, { useState, useRef, useEffect } from "react";

export default function InfoHint({ children, label, size = "sm", placement = "top" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const iconSize = size === "md" ? "w-3.5 h-3.5 text-[11px]" : "w-3 h-3 text-[10px]";
  const popClass =
    placement === "bottom"
      ? "top-full mt-1.5 left-1/2 -translate-x-1/2"
      : "bottom-full mb-1.5 left-1/2 -translate-x-1/2";

  return (
    <span ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className={`inline-flex items-center justify-center ${iconSize} font-bold rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300 hover:text-slate-900 cursor-help select-none leading-none`}
        aria-label={label || "Info"}
      >
        ⓘ
      </button>
      {open && (
        <span
          className={`absolute ${popClass} z-50 w-[280px] px-3 py-2 rounded-[10px] bg-slate-900 text-white text-[12px] leading-relaxed shadow-[0_12px_32px_-8px_rgba(15,23,42,0.35)] pointer-events-none`}
        >
          {label && (
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              {label}
            </span>
          )}
          {children}
          <span
            className={`absolute ${placement === "bottom" ? "-top-1" : "-bottom-1"} left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-900 rotate-45`}
          />
        </span>
      )}
    </span>
  );
}
