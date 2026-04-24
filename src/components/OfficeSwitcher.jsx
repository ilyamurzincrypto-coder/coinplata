// src/components/OfficeSwitcher.jsx
// Hover-open office switcher в apple-style. Dark theme (slate-900),
// плавная анимация (cubic-bezier), scroll при большом числе офисов.
//
// UX:
//   - Наведение на trigger → dropdown раскрывается через 80ms delay (чтобы
//     не срабатывал на случайном прохождении мыши)
//   - Уход с trigger+menu → закрывается через 200ms (даёт время добежать
//     мышью до меню не закрыв его)
//   - Клик по опции → apply + instant close
//   - ESC / клик вне → close
//   - Выбранный офис подсвечен белым на чёрном фоне

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Building2, ChevronDown, Check } from "lucide-react";

export default function OfficeSwitcher({ value, onChange, offices }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const openTimerRef = useRef(null);
  const closeTimerRef = useRef(null);

  const scheduleOpen = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (open) return;
    openTimerRef.current = setTimeout(() => {
      setOpen(true);
      openTimerRef.current = null;
    }, 80);
  }, [open]);

  const scheduleClose = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (!open) return;
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, 200);
  }, [open]);

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

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const current = (offices || []).find((o) => o.id === value);
  const currentLabel = current?.name || "Select office";

  const handlePick = (id) => {
    if (onChange) onChange(id);
    // Close instantly after pick — no delay
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`group w-full flex items-center gap-2 px-3 py-1.5 rounded-[10px] border transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
          open
            ? "bg-slate-900 border-slate-900 text-white shadow-[0_6px_20px_-8px_rgba(15,23,42,0.45)]"
            : "bg-white border-slate-200 text-slate-900 hover:border-slate-300 hover:shadow-sm"
        }`}
      >
        <Building2
          className={`w-3.5 h-3.5 shrink-0 transition-colors ${
            open ? "text-emerald-400" : "text-slate-400"
          }`}
        />
        <span className="text-[13px] font-semibold truncate flex-1 text-left">
          {currentLabel}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
            open ? "rotate-180 text-white" : "text-slate-400"
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
          className="bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-[12px] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)] p-1 max-h-[340px] overflow-y-auto"
          style={{
            boxShadow:
              "0 0 0 1px rgba(255,255,255,0.04) inset, 0 16px 40px -12px rgba(0,0,0,0.6)",
          }}
        >
          {(offices || []).length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-slate-500 italic">
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
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-[8px] text-[12.5px] text-left transition-colors duration-150 ${
                    active
                      ? "bg-white text-slate-900 font-semibold"
                      : "text-slate-200 hover:bg-slate-800/80"
                  }`}
                >
                  <Building2
                    className={`w-3 h-3 shrink-0 ${
                      active ? "text-emerald-600" : "text-slate-500"
                    }`}
                  />
                  <span className="flex-1 truncate">{off.name}</span>
                  {active && <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
