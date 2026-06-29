// src/components/rates/RateNum.jsx
// Число курса в терминальном стиле: моноширинный, tabular-nums, правое
// выравнивание. ХВОСТОВЫЕ НУЛИ после запятой — бледным (46,5̲0̲ · 0,99̲70̲), само
// значение не меняем. Клик копирует значение в буфер (через onCopy → тост).

import React from "react";

// Делим строку на «значащую часть» и «хвостовые нули после запятой».
// "46,50" → ["46,5","0"] · "0,9970" → ["0,99","70"] · "1 200"/"46,25" → [val,""]
function splitFaintZeros(value) {
  const m = String(value).match(/^(.*?,\d*?)(0+)$/);
  return m ? [m[1], m[2]] : [value, ""];
}

export default function RateNum({ value, onCopy, className = "" }) {
  if (!value || value === "—") {
    return <span className={`font-mono text-[#aeb4bb] ${className}`}>—</span>;
  }
  const [head, zeros] = splitFaintZeros(value);
  return (
    <button
      type="button"
      onClick={() => onCopy?.(value)}
      title="Скопировать"
      className={`w-full text-right font-mono font-medium tabular-nums tracking-tight cursor-pointer transition-colors hover:text-[#0c9c6b] focus-visible:outline-none focus-visible:text-[#0c9c6b] ${className}`}
    >
      <span>{head}</span>
      {zeros && <span className="text-[#aeb4bb]">{zeros}</span>}
    </button>
  );
}
