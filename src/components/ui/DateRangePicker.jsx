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
// Локальная YYYY-MM-DD (без UTC сдвига). Раньше использовали .toISOString()
// который при TZ != UTC выдавал вчерашний день и резал сегодняшние записи.
function localYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function rangeForPreset(preset) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = localYMD(today);
  if (preset === "today") return { from: todayStr, to: todayStr };
  if (preset === "week") {
    const d = new Date(today);
    d.setDate(d.getDate() - 6);
    return { from: localYMD(d), to: todayStr };
  }
  if (preset === "month") {
    const d = new Date(today);
    d.setDate(1);
    return { from: localYMD(d), to: todayStr };
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
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-button text-caption font-medium text-ink-soft bg-white border border-border-soft hover:border-border transition-colors"
        >
          <Calendar className="w-3 h-3 text-muted-soft" />
          {value?.from || "…"} — {value?.to || "…"}
          <ChevronDown className={`w-3 h-3 text-muted-soft transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}

      {open && (
        <div className="absolute top-full right-0 mt-1 z-40 bg-white border border-border-soft rounded-card shadow-xl shadow-soft p-4 w-72">
          <div className="space-y-3">
            <div>
              <label className="block text-tiny font-semibold text-muted mb-1 uppercase tracking-wider">
                From
              </label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-card px-3 py-2 text-body-sm outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-tiny font-semibold text-muted mb-1 uppercase tracking-wider">
                To
              </label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-card px-3 py-2 text-body-sm outline-none transition-colors"
              />
            </div>
            <button
              onClick={applyCustom}
              className="w-full px-3 py-2 rounded-card bg-ink text-white text-body-sm font-semibold hover:bg-ink transition-colors"
            >
              {t("dr_apply")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
