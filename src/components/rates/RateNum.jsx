// src/components/rates/RateNum.jsx
// Число курса: целая часть яркая, дробная (от запятой) — бледнее. Клик по числу
// копирует значение в буфер (через onCopy родителя → тост). JetBrains Mono.

import React from "react";

export default function RateNum({ value, onCopy, className = "" }) {
  if (!value || value === "—") {
    return <span className={`font-mono text-muted-soft ${className}`}>—</span>;
  }
  const i = value.indexOf(",");
  const int = i < 0 ? value : value.slice(0, i);
  const dec = i < 0 ? "" : value.slice(i);
  return (
    <button
      type="button"
      onClick={() => onCopy?.(value)}
      title="Скопировать"
      className={`w-full text-right font-mono font-semibold tabular-nums tracking-tight cursor-pointer rounded-[7px] transition-colors hover:text-[#11b07a] ${className}`}
    >
      <span>{int}</span>
      {dec && <span className="opacity-55">{dec}</span>}
    </button>
  );
}
