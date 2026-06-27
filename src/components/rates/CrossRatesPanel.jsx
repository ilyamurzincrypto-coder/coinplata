// src/components/rates/CrossRatesPanel.jsx
// Кросс-курсы офиса: строка на пару (USD / TRY), оба направления в строке —
// → прямой (a→b, зелёная стрелка) и ← обратный (b→a, приглушённая). Через USDT
// (orientation-aware). Москва (один RUB) — без кросса. Значения копируемые.

import React from "react";
import { ArrowRightLeft } from "lucide-react";
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

const GRID = { gridTemplateColumns: "minmax(62px,auto) 1fr 1fr" };

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
    <div className="mt-2 pt-1.5">
      <div className="flex items-center gap-1.5 px-1 pb-0.5">
        <ArrowRightLeft className="w-3 h-3 text-muted-soft" strokeWidth={2.2} />
        <span className="text-[9.5px] font-bold tracking-[1.2px] text-[#8a8fa6] uppercase">
          Кросс-курсы
        </span>
      </div>
      {rows.map(({ a, b, fwd, rev }) => (
        <div
          key={`${a}_${b}`}
          className="grid items-center gap-2 px-1 py-[5px] border-t border-[#eef0f4]"
          style={GRID}
        >
          <span className="text-[12px] font-semibold text-[#454a68] whitespace-nowrap">
            {a}
            <span className="text-muted-soft/70 mx-1 font-normal">/</span>
            {b}
          </span>
          <span className="flex items-baseline justify-end gap-1">
            <span className="text-[#0fa56f] font-bold text-[12px]" aria-hidden>→</span>
            <RateNum value={fmtCross(fwd)} onCopy={onCopy} className="text-[12.5px] text-ink !w-auto" />
          </span>
          <span className="flex items-baseline justify-end gap-1">
            <span className="text-muted-soft font-bold text-[12px]" aria-hidden>←</span>
            <RateNum value={fmtCross(rev)} onCopy={onCopy} className="text-[12.5px] text-muted !w-auto" />
          </span>
        </div>
      ))}
    </div>
  );
}
