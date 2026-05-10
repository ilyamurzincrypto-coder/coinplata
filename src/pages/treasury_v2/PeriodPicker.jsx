// src/pages/treasury_v2/PeriodPicker.jsx
import React from "react";
import { useTranslation } from "../../i18n/translations.jsx";

// Returns { from, to } ISO strings for a preset name. `now` injectable for tests.
export function presetWindow(preset, now = new Date()) {
  const to = now.toISOString();
  const d = new Date(now);
  switch (preset) {
    case "today": { d.setUTCHours(0, 0, 0, 0); return { from: d.toISOString(), to }; }
    case "week": {
      const day = (d.getUTCDay() + 6) % 7; // Monday=0
      d.setUTCDate(d.getUTCDate() - day); d.setUTCHours(0, 0, 0, 0);
      return { from: d.toISOString(), to };
    }
    case "month": { d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); return { from: d.toISOString(), to }; }
    case "quarter": {
      const q = Math.floor(d.getUTCMonth() / 3) * 3;
      d.setUTCMonth(q, 1); d.setUTCHours(0, 0, 0, 0);
      return { from: d.toISOString(), to };
    }
    case "year": { d.setUTCMonth(0, 1); d.setUTCHours(0, 0, 0, 0); return { from: d.toISOString(), to }; }
    case "30d": default: { d.setUTCDate(d.getUTCDate() - 30); return { from: d.toISOString(), to }; }
  }
}

const PRESETS = ["today", "week", "month", "quarter", "year", "30d"];

export default function PeriodPicker({ value, onChange }) {
  const { t } = useTranslation();
  const win = presetWindow(value);
  const days = Math.round((new Date(win.to) - new Date(win.from)) / 86400000);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {PRESETS.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-2.5 py-1 rounded-[8px] text-[12px] font-medium transition-colors ${value === p ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
        >
          {t(`trv2_period_${p === "30d" ? "30d" : p}`)}
        </button>
      ))}
      <span className="text-[11px] text-slate-400">
        {new Date(win.from).toISOString().slice(0, 10)} — {new Date(win.to).toISOString().slice(0, 10)} ({t("trv2_period_days").replace("{n}", String(days))})
      </span>
    </div>
  );
}
