// src/components/ui/DateSelector.jsx
// Селектор даты для шапки «Балансов»: «Сегодня» по умолчанию + выбор конкретной
// даты (поповер с быстрой кнопкой «Сегодня» и нативным date-input). Пока только
// UI — значение хранится локально, на данные ещё не влияет.

import React, { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown } from "lucide-react";

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function toInput(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function DateSelector({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const date = value || new Date();
  const today = new Date();
  const isToday = sameDay(date, today);
  const label = isToday ? "Сегодня" : `${date.getDate()} ${MONTHS[date.getMonth()]}`;

  const pick = (d) => {
    onChange?.(d);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-pill text-caption font-semibold transition-colors ${
          isToday ? "bg-surface-sunk text-ink" : "bg-accent-bg text-accent"
        } hover:bg-surface-soft`}
      >
        <Calendar className="w-3.5 h-3.5 opacity-70" strokeWidth={2} />
        <span>{label}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 opacity-60 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 z-50 w-[230px] bg-surface border border-border rounded-card shadow-modal p-2">
          <button
            type="button"
            onClick={() => pick(new Date())}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-button text-body-sm font-medium transition-colors ${
              isToday ? "bg-accent-bg text-accent" : "text-ink hover:bg-surface-soft"
            }`}
          >
            <Calendar className="w-3.5 h-3.5 opacity-70" strokeWidth={2} />
            Сегодня
          </button>
          <div className="mt-1 px-2.5 py-1.5">
            <span className="text-caption text-muted">Выбрать дату</span>
            <input
              type="date"
              value={toInput(date)}
              max={toInput(today)}
              onChange={(e) => {
                const [y, m, d] = (e.target.value || "").split("-").map(Number);
                if (y && m && d) pick(new Date(y, m - 1, d));
              }}
              className="mt-1 w-full border border-border rounded-input px-2 py-1.5 text-body-sm font-mono tabular-nums outline-none focus:border-accent"
            />
          </div>
        </div>
      )}
    </div>
  );
}
