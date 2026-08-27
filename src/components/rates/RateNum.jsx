// src/components/rates/RateNum.jsx
// Число курса: Onest + tabular-nums (tnum), правое выравнивание. Моноширинный
// JetBrains Mono убран в редизайне — колонки держит tnum самого Onest.
//
// ХВОСТОВЫЕ НУЛИ БОЛЬШЕ НЕ БЛЕДНЫЕ: все цифры полноразмерные и одного цвета.
// Правило копеек действует и здесь — 46,80 это одно число, а не «46,8 плюс
// что-то серое»; выцветание хвоста читалось как «часть значения неточная».

import React from "react";

export default function RateNum({ value, onCopy, className = "" }) {
  if (!value || value === "—") {
    return <span className={`tabular-nums text-[#aeb4bb] ${className}`}>—</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onCopy?.(value)}
      title="Скопировать"
      className={`w-full text-right font-light tabular-nums tracking-[-0.01em] cursor-pointer transition-colors hover:text-[#0c9c6b] focus-visible:outline-none focus-visible:text-[#0c9c6b] ${className}`}
    >
      {value}
    </button>
  );
}
