// src/components/rates/CrossRatesPanel.jsx
// Кросс-курсы офиса: строка на пару (USD / TRY), оба направления — → прямой
// (a→b) и ← обратный (b→a). Через USDT (orientation-aware). Москва (один RUB) —
// без кросса. Терминальный вид: секция-hairline, нейтральные стрелки, копируемо.
// Порядок пар, направления и расчёт — без изменений.

import React from "react";
import { usdtPer } from "../../lib/rates.js";
import RateNum from "./RateNum.jsx";

function fmtCross(n) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  let d;
  if (n >= 100) d = 2;
  else if (n >= 10) d = 3;
  else if (n >= 1) d = 4;
  else if (n >= 0.1) d = 4;
  else if (n >= 0.01) d = 5;
  else d = 6;
  return n.toFixed(d).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
}

function uniquePairs(ccys) {
  const out = [];
  for (let i = 0; i < ccys.length; i++)
    for (let j = i + 1; j < ccys.length; j++) out.push([ccys[i], ccys[j]]);
  return out;
}

const GRID = { gridTemplateColumns: "1fr 88px 88px" };

export default function CrossRatesPanel({ getRate, ccys, onCopy }) {
  const fiats = (ccys || []).filter((c) => c !== "USDT");
  const rows = uniquePairs(fiats)
    .map(([a, b]) => {
      const pa = usdtPer(a, getRate);
      const pb = usdtPer(b, getRate);
      if (!Number.isFinite(pa) || !Number.isFinite(pb) || pa <= 0 || pb <= 0) return null;
      return { a, b, fwd: pa / pb, rev: pb / pa };
    })
    .filter(Boolean);

  if (rows.length === 0) return null; // один фиат (Москва) → кросса нет

  return (
    <div>
      {/* Секция — мелкий label + hairline на всю ширину */}
      <div className="flex items-center gap-2 pl-[26px] pr-2 pt-2 pb-1">
        <span className="text-[8.5px] font-bold tracking-[1.3px] uppercase text-[#6a717a]">Кросс</span>
        <span className="flex-1 h-px bg-[rgba(18,22,26,0.08)]" />
      </div>
      {rows.map(({ a, b, fwd, rev }) => (
        <div
          key={`${a}_${b}`}
          className="grid items-baseline py-1.5 border-t border-line"
          style={GRID}
        >
          <span className="text-[12px] text-muted whitespace-nowrap">
            {a}
            <span className="text-faint"> / {b}</span>
          </span>
          <span className="flex items-baseline justify-end gap-1">
            
            <RateNum value={fmtCross(fwd)} onCopy={onCopy} className="text-[14px] text-[#6B675C]" />
          </span>
          <span className="flex items-baseline justify-end gap-1">
            
            <RateNum value={fmtCross(rev)} onCopy={onCopy} className="text-[14px] text-[#6B675C]" />
          </span>
        </div>
      ))}
    </div>
  );
}
