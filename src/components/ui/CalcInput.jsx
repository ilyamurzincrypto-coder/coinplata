// src/components/ui/CalcInput.jsx
// Numeric input с поддержкой арифметических выражений: можно набрать
// "100+50", "12.5*4", "(150-30)/2" — на Enter или blur выражение вычисляется,
// поле получает результат. Безопасный eval — только digits, + - * /, скобки,
// точка/запятая. Внешний API совместим с обычным <input>:
//   value, onChange(rawString), onCommit?(numericValue) — опциональный callback
//   при успешной evaluation. Если пользователь продолжает редактировать —
//   onChange прокидывает сырой текст.
//
// Использование:
//   <CalcInput value={amount} onChange={setAmount} onCommit={(n) => ...} />

import React, { useCallback } from "react";
import { Calculator } from "lucide-react";

const ALLOWED = /^[\d+\-*/().,\s]+$/;

export function evalMath(raw) {
  if (raw == null) return { ok: false, value: NaN };
  const s = String(raw).trim().replace(/\s+/g, "").replace(/,/g, ".");
  if (!s) return { ok: false, value: NaN };
  if (!ALLOWED.test(s)) return { ok: false, value: NaN };
  // Простое число — быстрый путь
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, value: NaN };
  }
  // Только арифметика — Function-eval безопасен после ALLOWED regex
  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict"; return (${s})`)();
    if (typeof v === "number" && Number.isFinite(v)) return { ok: true, value: v };
    return { ok: false, value: NaN };
  } catch {
    return { ok: false, value: NaN };
  }
}

export default function CalcInput({
  value,
  onChange,
  onCommit,
  className = "",
  inputClassName = "",
  showBadge = true,
  ...rest
}) {
  const isExpr = typeof value === "string" && /[+\-*/()]/.test(String(value).trim());
  const evald = isExpr ? evalMath(value) : null;

  const commit = useCallback(() => {
    const r = evalMath(value);
    if (r.ok) {
      const formatted = String(r.value);
      onChange?.(formatted);
      onCommit?.(r.value);
    }
  }, [value, onChange, onCommit]);

  const onKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
    rest.onKeyDown?.(e);
  };

  return (
    <span className={`relative inline-block ${className}`}>
      <input
        type="text"
        inputMode="decimal"
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
        onBlur={() => { commit(); rest.onBlur?.(); }}
        onKeyDown={onKey}
        className={inputClassName}
        {...rest}
      />
      {showBadge && isExpr && evald?.ok && (
        <span className="absolute -top-4 right-0 inline-flex items-center gap-0.5 text-tiny text-accent bg-accent-bg px-1.5 py-0.5 rounded-badge font-mono tabular shadow-sm pointer-events-none">
          <Calculator className="w-2.5 h-2.5" strokeWidth={2.5} />
          = {evald.value.toLocaleString(undefined, { maximumFractionDigits: 4 })}
        </span>
      )}
    </span>
  );
}
