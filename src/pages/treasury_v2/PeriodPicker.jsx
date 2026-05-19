// src/pages/treasury_v2/PeriodPicker.jsx
import React from "react";
import { useTranslation } from "../../i18n/translations.jsx";

// Returns { from, to } ISO strings for a preset name. `now` injectable for tests.
// `to` = END of the current UTC day, not the exact instant — иначе сделка,
// созданная через минуту после рендера, оказывается «позже to» и выпадает из
// transactionTree (видна только после перезагрузки страницы).
export function presetWindow(preset, now = new Date()) {
  const endOfToday = new Date(now);
  endOfToday.setUTCHours(23, 59, 59, 999);
  const to = endOfToday.toISOString();
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

// The window immediately preceding `win`, same length: prev.to == win.from.
export function previousWindow(win) {
  const fromMs = new Date(win.from).getTime();
  const toMs = new Date(win.to).getTime();
  const len = toMs - fromMs;
  return { from: new Date(fromMs - len).toISOString(), to: new Date(fromMs).toISOString() };
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
          className={`px-2.5 py-1 rounded-button text-[12px] font-medium transition-colors ${value === p ? "bg-ink text-white" : "bg-surface-sunk text-ink-soft hover:bg-surface-sunk"}`}
        >
          {t(`trv2_period_${p === "30d" ? "30d" : p}`)}
        </button>
      ))}
      <span className="text-[11px] text-muted-soft">
        {new Date(win.from).toISOString().slice(0, 10)} — {new Date(win.to).toISOString().slice(0, 10)} ({t("trv2_period_days").replace("{n}", String(days))})
      </span>
    </div>
  );
}
