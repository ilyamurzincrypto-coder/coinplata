// src/components/ui/FloatingCalculator.jsx
// Плавающий мини-калькулятор в правом-нижнем углу. По клику разворачивается
// в popup с клавиатурой. Поддерживает арифметику (+ − × ÷ . и скобки через
// CalcInput.evalMath). Кнопка «Копировать» кладёт результат в clipboard.
//
// Состояние локальное (нет смысла persist'ить — это рабочий black-board).

import React, { useState } from "react";
import { Calculator, X, Copy, Check } from "lucide-react";
import { evalMath } from "./CalcInput.jsx";

const KEYS = [
  ["7", "8", "9", "÷"],
  ["4", "5", "6", "×"],
  ["1", "2", "3", "−"],
  [".", "0", "(", "+"],
  ["C", "⌫", ")", "="],
];

function applyKey(expr, k) {
  if (k === "C") return "";
  if (k === "⌫") return expr.slice(0, -1);
  if (k === "÷") return expr + "/";
  if (k === "×") return expr + "*";
  if (k === "−") return expr + "-";
  return expr + k;
}

export default function FloatingCalculator() {
  const [open, setOpen] = useState(false);
  const [expr, setExpr] = useState("");
  const [copied, setCopied] = useState(false);

  const result = evalMath(expr);

  const onKey = (k) => {
    if (k === "=") {
      if (result.ok) setExpr(String(result.value));
      return;
    }
    setExpr((prev) => applyKey(prev, k));
  };

  const copy = async () => {
    if (!result.ok) return;
    try {
      await navigator.clipboard.writeText(String(result.value));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  return (
    <div className="fixed bottom-5 right-5 z-[900]">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Калькулятор"
          className="w-12 h-12 rounded-full bg-ink text-white shadow-cta-glow hover:bg-black hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center"
        >
          <Calculator className="w-5 h-5" strokeWidth={2.2} />
        </button>
      ) : (
        <div className="w-[260px] bg-surface rounded-card-lg shadow-modal border border-border-soft overflow-hidden animate-[slideUp_120ms_ease-out]">
          <div className="px-3 py-2 border-b border-border-soft flex items-center justify-between bg-surface-sunk">
            <span className="text-tiny font-bold text-muted uppercase tracking-wider inline-flex items-center gap-1.5">
              <Calculator className="w-3.5 h-3.5" strokeWidth={2.2} />
              Калькулятор
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded text-muted hover:text-ink hover:bg-surface-soft transition-colors"
              aria-label="Закрыть"
            >
              <X className="w-3.5 h-3.5" strokeWidth={2.2} />
            </button>
          </div>
          <div className="p-3 space-y-2">
            <input
              type="text"
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              placeholder="100 + 50 * 2"
              className="w-full h-9 px-2 text-right font-mono tabular text-body-sm bg-surface-sunk rounded-button border border-transparent focus:border-accent focus:bg-surface focus:outline-none"
              autoFocus
            />
            <div className={`text-right font-mono tabular text-h3 h-6 ${result.ok ? "text-success" : "text-muted-soft"}`}>
              {result.ok ? `= ${result.value.toLocaleString(undefined, { maximumFractionDigits: 6 })}` : (expr ? "?" : "")}
            </div>
            <div className="grid grid-cols-4 gap-1">
              {KEYS.flat().map((k) => {
                const isOp = ["÷", "×", "−", "+", "="].includes(k);
                const isErase = k === "⌫" || k === "C";
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => onKey(k)}
                    className={`h-9 rounded-button text-body-sm font-bold font-mono tabular transition-colors ${
                      k === "=" ? "bg-ink text-white hover:bg-black"
                      : isErase ? "bg-danger-soft text-danger hover:bg-danger/10"
                      : isOp ? "bg-accent-bg text-accent hover:bg-accent/10"
                      : "bg-surface-sunk text-ink hover:bg-surface-soft"
                    }`}
                  >
                    {k}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={copy}
              disabled={!result.ok}
              className="w-full h-8 rounded-button text-caption font-semibold bg-surface-sunk text-ink-soft hover:bg-surface-soft disabled:opacity-40 transition-colors inline-flex items-center justify-center gap-1.5"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-success" strokeWidth={2.5} /> : <Copy className="w-3.5 h-3.5" strokeWidth={2} />}
              {copied ? "Скопировано" : "Копировать"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
