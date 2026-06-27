// src/components/cashier/ledger/DealTimeField.jsx
// Аккуратное поле «дата · время» для строки сделки. Триггер с иконкой часов +
// читаемая подпись; клик → компактный поповер (дата + время + «Сейчас») через
// портал, fixed-позиционирование от ячейки, открытие вверх при нехватке места.
// Значение — Date. По умолчанию «сейчас».

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock } from "lucide-react";

const p2 = (n) => String(n).padStart(2, "0");
const fmtLabel = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const toTimeInput = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;

export default function DealTimeField({ value, onChange }) {
  const date = value || new Date();
  const cellRef = useRef(null);
  const popRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);

  const reposition = () => {
    if (!cellRef.current) return;
    const r = cellRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 232 - 8));
    const popH = popRef.current?.offsetHeight || 150;
    const up = r.bottom + popH > window.innerHeight - 8 && r.top - 8 > window.innerHeight - r.bottom;
    setPlace(up ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
  };
  useLayoutEffect(() => {
    if (open) reposition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const h = () => reposition();
    const onDoc = (e) => {
      if (popRef.current && !popRef.current.contains(e.target) && !cellRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    const onEsc = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("resize", h);
    window.addEventListener("scroll", h, true);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("resize", h);
      window.removeEventListener("scroll", h, true);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const setTimePart = (v) => {
    const [h, mi] = (v || "").split(":").map(Number);
    if (Number.isNaN(h)) return;
    const nd = new Date(date);
    nd.setHours(h, mi || 0, 0, 0);
    onChange?.(nd);
  };

  return (
    <>
      <button
        ref={cellRef}
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="w-full flex items-center justify-center px-1 min-h-[31px] hover:bg-[#f3f5ff] transition-colors"
        title="Время сделки"
      >
        <span className="font-mono text-[12px] text-[#454a66] tabular-nums">{fmtLabel(date)}</span>
      </button>

      {open &&
        place &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            className="fixed z-[130] w-[180px] bg-surface border border-[#dde0ea] rounded-[12px] shadow-[0_20px_48px_-18px_rgba(16,24,40,.4)] p-2.5"
            style={{ left: place.left, top: place.top, bottom: place.bottom }}
          >
            <div className="flex gap-2 items-center">
              <input
                type="time"
                value={toTimeInput(date)}
                onChange={(e) => setTimePart(e.target.value)}
                className="flex-1 min-w-0 border border-[#dde0ea] rounded-[8px] px-2 py-1.5 text-[13px] font-mono outline-none focus:border-[#5b6cff]"
              />
              <button
                type="button"
                onClick={() => onChange?.(new Date())}
                title="Текущее время"
                className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-[8px] text-ink-soft hover:bg-surface-soft"
              >
                <Clock className="w-4 h-4 opacity-70" strokeWidth={2} />
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
