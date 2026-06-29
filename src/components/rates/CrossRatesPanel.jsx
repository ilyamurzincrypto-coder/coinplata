// src/components/rates/CrossRatesPanel.jsx
// Кросс-курсы офиса: строка на пару (USD / TRY), оба направления — → прямой
// (a→b) и ← обратный (b→a). Через USDT (orientation-aware). Москва (один RUB) —
// без кросса. Терминальный вид: секция-hairline, нейтральные стрелки, копируемо.
// Порядок пар, направления и расчёт — без изменений.

import React from "react";
import { isPercentPair } from "../../utils/ratesFormat.js";
import RateNum from "./RateNum.jsx";

const STRONG = new Set(["USD", "EUR"]); // котируются «USDT за X»

function usdtPer(x, getRate) {
  if (x === "USDT") return 1;
  const raw = Number(getRate?.("USDT", x));
  if (!Number.isFinite(raw) || raw <= 0) return NaN;
  if (isPercentPair("USDT", x)) return 1 / raw;
  const readable = raw < 1 ? 1 / raw : raw;
  return STRONG.has(x) ? readable : 1 / readable;
}

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

const GRID = { gridTemplateColumns: "1fr 74px 74px" };

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
          className="grid items-baseline pl-[26px] pr-2 py-[5px] hover:bg-[rgba(18,22,26,0.022)] transition-colors"
          style={GRID}
        >
          <span className="text-[12.5px] font-semibold text-[#15191d] whitespace-nowrap">
            {a}
            <span className="text-[#aeb4bb] font-medium">/{b}</span>
          </span>
          <span className="flex items-baseline justify-end gap-1">
            <span className="text-[#aeb4bb] text-[11px]" aria-hidden>→</span>
            <RateNum value={fmtCross(fwd)} onCopy={onCopy} className="text-[12.5px] text-[#15191d] !w-auto" />
          </span>
          <span className="flex items-baseline justify-end gap-1">
            <span className="text-[#aeb4bb] text-[11px]" aria-hidden>←</span>
            <RateNum value={fmtCross(rev)} onCopy={onCopy} className="text-[12.5px] text-[#6a717a] !w-auto" />
          </span>
        </div>
      ))}
    </div>
  );
}
