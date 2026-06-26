// src/components/rates/CrossRatesPanel.jsx
// Панель «Кросс» внутри карточки офиса: обе стороны каждой пары валют офиса,
// через USDT (orientation-aware). Москва (один RUB) — без кросса.

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

export default function CrossRatesPanel({ getRate, ccys, onCopy }) {
  const fiats = (ccys || []).filter((c) => c !== "USDT");
  const rows = [];
  uniquePairs(fiats).forEach(([a, b]) => {
    const pa = usdtPer(a, getRate);
    const pb = usdtPer(b, getRate);
    if (!Number.isFinite(pa) || !Number.isFinite(pb) || pa <= 0 || pb <= 0) return;
    rows.push({ from: a, to: b, rate: pa / pb });
    rows.push({ from: b, to: a, rate: pb / pa });
  });
  if (rows.length === 0) return null;

  return (
    <div className="mt-2 bg-[#f4f5fa] border border-[#e7e9f1] rounded-[12px] px-2.5 py-1.5">
      <div className="text-[9.5px] font-bold tracking-[1.4px] text-[#8a8fa6] uppercase mb-1">
        Кросс
      </div>
      <div className="grid grid-cols-2 gap-x-[18px] gap-y-[2px]">
        {rows.map(({ from, to, rate }) => (
          <div key={`${from}_${to}`} className="flex items-baseline justify-between gap-2">
            <span className="text-[11.5px] font-semibold text-[#454a68] whitespace-nowrap">
              {from}
              <span className="text-[#8a8fa6] mx-px">→</span>
              {to}
            </span>
            <RateNum value={fmtCross(rate)} onCopy={onCopy} className="text-[12.5px] !w-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
