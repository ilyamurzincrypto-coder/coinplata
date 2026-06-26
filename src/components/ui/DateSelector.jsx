// src/components/ui/DateSelector.jsx
// Селектор даты для шапки «Балансов»: «Сегодня» по умолчанию + интерактивный
// календарь (сетка дней, переключение месяцев, подсветка сегодня/выбранного,
// будущее недоступно). Пока только UI — значение хранится локально.

import React, { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_FULL = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const dayKey = (d) => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
const sameDay = (a, b) => dayKey(a) === dayKey(b);
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

function monthGrid(viewMonth) {
  const first = startOfMonth(viewMonth);
  const dow = (first.getDay() + 6) % 7; // Пн=0 … Вс=6
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - dow);
  return Array.from({ length: 42 }, (_, i) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
  );
}

export default function DateSelector({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const date = value || new Date();
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(date));

  useEffect(() => {
    if (open) setViewMonth(startOfMonth(value || new Date()));
  }, [open, value]);

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

  const isToday = sameDay(date, today);
  const label = isToday ? "Сегодня" : `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  const pick = (d) => {
    onChange?.(d);
    setOpen(false);
  };

  const nextDisabled =
    viewMonth.getFullYear() > today.getFullYear() ||
    (viewMonth.getFullYear() === today.getFullYear() && viewMonth.getMonth() >= today.getMonth());
  const grid = monthGrid(viewMonth);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-pill text-caption font-semibold transition-colors ${
          isToday ? "bg-surface-sunk text-ink hover:bg-surface-soft" : "bg-accent-bg text-accent hover:bg-emerald-100"
        }`}
      >
        <Calendar className="w-3.5 h-3.5 opacity-70" strokeWidth={2} />
        <span>{label}</span>
        <ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 z-50 w-[268px] bg-surface border border-border rounded-card shadow-modal p-2.5">
          {/* Быстрая «Сегодня» */}
          <button
            type="button"
            onClick={() => pick(new Date())}
            className={`w-full flex items-center justify-center gap-2 px-2.5 py-1.5 mb-2 rounded-button text-body-sm font-semibold transition-colors ${
              isToday ? "bg-accent-bg text-accent" : "text-ink-soft hover:bg-surface-soft"
            }`}
          >
            <Calendar className="w-3.5 h-3.5 opacity-70" strokeWidth={2} />
            Сегодня
          </button>

          {/* Навигация по месяцам */}
          <div className="flex items-center justify-between px-1 mb-1.5">
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
              className="w-7 h-7 grid place-items-center rounded-button text-muted hover:text-ink hover:bg-surface-soft transition-colors"
              aria-label="Предыдущий месяц"
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={2.2} />
            </button>
            <span className="text-body-sm font-bold text-ink tabular-nums">
              {MONTHS_FULL[viewMonth.getMonth()]} {viewMonth.getFullYear()}
            </span>
            <button
              type="button"
              disabled={nextDisabled}
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              className="w-7 h-7 grid place-items-center rounded-button text-muted hover:text-ink hover:bg-surface-soft transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
              aria-label="Следующий месяц"
            >
              <ChevronRight className="w-4 h-4" strokeWidth={2.2} />
            </button>
          </div>

          {/* Дни недели */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map((w) => (
              <span key={w} className="text-center text-[10px] font-semibold text-muted-soft uppercase tracking-wide">
                {w}
              </span>
            ))}
          </div>

          {/* Сетка дней */}
          <div className="grid grid-cols-7 gap-0.5">
            {grid.map((d) => {
              const inMonth = d.getMonth() === viewMonth.getMonth();
              const future = dayKey(d) > dayKey(today);
              const selected = sameDay(d, date);
              const isCurDay = sameDay(d, today);
              return (
                <button
                  key={dayKey(d)}
                  type="button"
                  disabled={future}
                  onClick={() => pick(d)}
                  className={`h-8 grid place-items-center rounded-button text-[12.5px] font-mono tabular-nums transition-colors ${
                    selected
                      ? "bg-success text-white font-bold"
                      : future
                        ? "text-muted-soft/40 cursor-not-allowed"
                        : isCurDay
                          ? "bg-surface-sunk text-ink font-bold hover:bg-surface-soft"
                          : inMonth
                            ? "text-ink hover:bg-surface-soft"
                            : "text-muted-soft hover:bg-surface-soft"
                  }`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
