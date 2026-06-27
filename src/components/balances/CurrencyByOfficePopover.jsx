// src/components/balances/CurrencyByOfficePopover.jsx
// Плавающий поповер «{CCY} · по офисам»: сумма по всем офисам + список офисов
// (текущий остаток + подстрока «утром X · ±Δ»). Позиционируется поверх карточки
// (absolute), стрелка указывает на выбранную колонку. Высоту карточки не меняет.

import React, { useEffect, useRef } from "react";
import { ccyMeta, fmtRu, splitParts } from "./currencyMeta.js";

function Num({ value, dp, className = "" }) {
  const { int, dec } = splitParts(fmtRu(value, dp));
  return (
    <span className={`font-mono tabular-nums ${className}`}>
      {int}
      {dec && <span className="opacity-[0.42]">{dec}</span>}
    </span>
  );
}

export default function CurrencyByOfficePopover({ view, pos, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.focus?.();
  }, [view?.ccy]);

  if (!view) return null;
  const { ccy, dp, total, offices } = view;
  const m = ccyMeta(ccy);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Остатки ${ccy} по офисам`}
      tabIndex={-1}
      onKeyDown={(e) => e.key === "Escape" && onClose?.()}
      className="absolute z-40 w-[300px] max-w-[calc(100%-28px)] bg-surface border border-[#dde0ea] rounded-[14px] outline-none animate-[fadeIn_140ms_ease-out]"
      style={{
        left: pos.left,
        top: pos.top,
        boxShadow:
          "0 20px 48px -16px rgba(16,24,40,.34), 0 4px 14px -6px rgba(16,24,40,.16)",
      }}
    >
      {/* Стрелка-указатель на выбранную колонку */}
      <span
        aria-hidden
        className="absolute w-3 h-3 bg-surface border-l border-t border-[#dde0ea] rotate-45"
        style={{ top: -7, left: pos.arrow }}
      />

      <div className="px-4 pt-3.5 pb-4">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[13px] font-extrabold text-ink">
            <span
              className="w-5 h-5 rounded-md grid place-items-center font-extrabold text-[10px] leading-none"
              style={{ background: m.bg, color: m.fg }}
            >
              {m.sym}
            </span>
            {ccy} · по офисам
          </span>
          <button
            type="button"
            onClick={onClose}
            title="Закрыть"
            className="w-6 h-6 rounded-[7px] grid place-items-center text-muted bg-surface border border-border hover:text-ink hover:border-[#dde0ea] transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="text-[9.5px] font-extrabold tracking-wide uppercase text-muted-soft mt-2.5 mb-0.5">
          Всего по всем офисам
        </div>
        <div className="text-[21px] font-bold text-ink tracking-tight mb-1.5">
          <span className="text-muted-soft mr-0.5">{m.sym}</span>
          <Num value={total} dp={dp} />
        </div>

        <div className="max-h-[228px] overflow-y-auto -mx-1 px-1">
          {offices.map((o) => {
            const d = o.tek - o.utro;
            const dcls = d > 0 ? "text-[#0b8a54]" : d < 0 ? "text-[#cf3b40]" : "text-muted";
            return (
              <div
                key={o.name}
                className="flex items-center justify-between gap-2.5 py-2.5 border-t border-border"
              >
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold text-ink-soft truncate">{o.name}</div>
                  <div className="text-[10.5px] font-semibold text-muted mt-0.5 font-mono">
                    {d === 0 ? (
                      "без изменений"
                    ) : (
                      <>
                        утром {fmtRu(o.utro, dp)} ·{" "}
                        <span className={dcls}>
                          {d > 0 ? "+" : "−"}
                          {fmtRu(Math.abs(d), dp)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-[14.5px] font-bold text-ink tracking-tight whitespace-nowrap">
                  <span className="text-muted-soft mr-0.5">{m.sym}</span>
                  <Num value={o.tek} dp={dp} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
