// src/components/OfficeSwitcher.jsx
// Click-open office switcher в apple-style. Dark theme (slate-900),
// плавная анимация (cubic-bezier), scroll при большом числе офисов.
//
// UX:
//   - Клик по trigger → dropdown открывается/закрывается (toggle)
//   - Клик по опции → apply + instant close
//   - ESC / клик вне → close
//   - Выбранный офис подсвечен белым на чёрном фоне
//
// Раньше открывался на hover с задержками (80ms open / 200ms close) — юзеры
// случайно раскрывали при пробеге мыши; теперь только явный клик.

import React, { useState, useRef, useEffect } from "react";
import { Building2, ChevronDown, Check } from "lucide-react";

export default function OfficeSwitcher({ value, onChange, offices }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Закрытие по клику вне + Esc
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const current = (offices || []).find((o) => o.id === value);
  const currentLabel = current?.name || "Select office";

  const handlePick = (id) => {
    if (onChange) onChange(id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`group w-full flex items-center gap-2 px-3 py-1.5 rounded-card border transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
          open
            ? "bg-ink border-ink text-white shadow-[0_6px_20px_-8px_rgba(15,23,42,0.45)]"
            : "bg-white border-border-soft text-ink hover:border-border hover:shadow-sm"
        }`}
      >
        <Building2
          className={`w-3.5 h-3.5 shrink-0 transition-colors ${
            open ? "text-success" : "text-muted-soft"
          }`}
        />
        <span className="text-body-sm font-semibold truncate flex-1 text-left">
          {currentLabel}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
            open ? "rotate-180 text-white" : "text-muted-soft"
          }`}
        />
      </button>

      {/* Dropdown — apple-style с лёгким scale+translate+blur */}
      <div
        aria-hidden={!open}
        className={`absolute right-0 mt-2 min-w-full w-[220px] origin-top-right transition-all ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
          open
            ? "opacity-100 scale-100 translate-y-0 pointer-events-auto duration-300"
            : "opacity-0 scale-95 -translate-y-1 pointer-events-none duration-200"
        }`}
        style={{ zIndex: 50 }}
      >
        <div
          className="bg-ink/95 backdrop-blur-xl border border-slate-800 rounded-card shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)] p-1 max-h-[340px] overflow-y-auto"
          style={{
            boxShadow:
              "0 0 0 1px rgba(255,255,255,0.04) inset, 0 16px 40px -12px rgba(0,0,0,0.6)",
          }}
        >
          {(offices || []).length === 0 ? (
            <div className="px-3 py-2 text-caption text-muted italic">
              No offices
            </div>
          ) : (
            (offices || []).map((off) => {
              const active = off.id === value;
              return (
                <button
                  key={off.id}
                  type="button"
                  onClick={() => handlePick(off.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-button text-caption text-left transition-colors duration-150 ${
                    active
                      ? "bg-white text-ink font-semibold"
                      : "text-white/80 hover:bg-ink/80"
                  }`}
                >
                  <Building2
                    className={`w-3 h-3 shrink-0 ${
                      active ? "text-success" : "text-muted"
                    }`}
                  />
                  <span className="flex-1 truncate">{off.name}</span>
                  {active && <Check className="w-3.5 h-3.5 text-success shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
