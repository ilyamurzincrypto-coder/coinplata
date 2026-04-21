// src/components/ui/DateRangePicker.jsx
// Компактный picker в стиле Aviasales: preset-segmented (Today / Week / Month / All)
// + опциональный dropdown для custom range (from, to dates).
// Возвращает { preset, from, to } — strings YYYY-MM-DD или null если preset явный.

import React, { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import SegmentedControl from "./SegmentedControl.jsx";
import { useTranslation } from "../../i18n/translations.jsx";

const PRESETS = [
  { id: "today", key: "dr_today" },
  { id: "week", key: "dr_week" },
  { id: "month", key: "dr_month" },
  { id: "custom", key: "dr_custom" },
];

// Возвращает range для preset
export function rangeForPreset(preset) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  if (preset === "today") return { from: todayStr, to: todayStr };
  if (preset === "week") {
    const d = new Date(today);
    d.setDate(d.getDate() - 6);
    return { from: d.toISOString().slice(0, 10), to: todayStr };
  }
  if (preset === "month") {
    const d = new Date(today);
    d.setDate(1);
    return { from: d.toISOString().slice(0, 10), to: todayStr };
  }
  return { from: null, to: null }; // custom / all
}

// Проверка попадания даты в диапазон
export function inRange(dateStr, range) {
  if (!range || (!range.from && !range.to)) return true; // all
  if (!dateStr) return false;
  if (range.from && dateStr < range.from) return false;
  if (range.to && dateStr > range.to) return false;
  return true;
}

export default function DateRangePicker({ value, onChange }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(value?.from || "");
  const [customTo, setCustomTo] = useState(value?.to || "");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const handlePreset = (preset) => {
    if (preset === "custom") {
      setOpen(true);
      return;
    }
    const r = rangeForPreset(preset);
    onChange({ preset, from: r.from, to: r.to });
  };

  const applyCustom = () => {
    onChange({ preset: "custom", from: customFrom || null, to: customTo || null });
    setOpen(false);
  };

  const currentPreset = value?.preset || "week";

  return (
    <div ref={ref} className="relative inline-flex items-center gap-2">
      <SegmentedControl
        options={PRESETS.map((p) => ({ id: p.id, name: t(p.key) }))}
        value={currentPreset}
        onChange={handlePreset}
        size="sm"
      />

      {currentPreset === "custom" && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-[12px] font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 transition-colors"
        >
          <Calendar className="w-3 h-3 text-slate-400" />
          {value?.from || "…"} — {value?.to || "…"}
          <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}

      {open && (
        <div className="absolute top-full right-0 mt-1 z-40 bg-white border border-slate-200 rounded-[12px] shadow-xl shadow-slate-900/10 p-4 w-72">
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase tracking-wider">
                From
              </label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase tracking-wider">
                To
              </label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] outline-none transition-colors"
              />
            </div>
            <button
              onClick={applyCustom}
              className="w-full px-3 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
            >
              {t("dr_apply")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
