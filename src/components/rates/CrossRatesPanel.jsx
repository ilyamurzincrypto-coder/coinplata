// src/components/rates/CrossRatesPanel.jsx
// Кросс-курсы (кеш-кеш) офиса — между валютами этого офиса, через USDT.
// ВАЖНО про конвенцию хранения: TRY/RUB котируются «валюта за USDT» (читаемое
// 46,2 = TRY за USDT), а USD/EUR — «USDT за валюту» (читаемое 1,142 = USDT за EUR,
// т.к. они крепче USDT). Поэтому считаем кросс через «USDT за 1 единицу валюты»
// (usdtPer) с учётом ориентации, иначе направления/значения врут.
// Bank-view: всегда сторона ≥1. Офис с одной фиат-валютой (Москва) кросса не имеет.

import React from "react";
import { isPercentPair, formatRateValue } from "../../utils/ratesFormat.js";

// Валюты, котируемые «USDT за X» (крепче/паритет USDT): читаемое = usdtPer.
const STRONG = new Set(["USD", "EUR"]);

// USDT за 1 единицу валюты X (приводим всё к одной шкале).
function usdtPer(x, getRate) {
  if (x === "USDT") return 1;
  const raw = Number(getRate?.("USDT", x));
  if (!Number.isFinite(raw) || raw <= 0) return NaN;
  if (isPercentPair("USDT", x)) return 1 / raw; // USD ~ паритет
  const readable = raw < 1 ? 1 / raw : raw; // «читаемое» >1
  return STRONG.has(x) ? readable : 1 / readable;
}

function uniquePairs(ccys) {
  const out = [];
  for (let i = 0; i < ccys.length; i++)
    for (let j = i + 1; j < ccys.length; j++) out.push([ccys[i], ccys[j]]);
  return out;
}

export default function CrossRatesPanel({ getRate, ccys }) {
  const fiats = (ccys || []).filter((c) => c !== "USDT");
  const rows = uniquePairs(fiats)
    .map(([a, b]) => {
      const pa = usdtPer(a, getRate);
      const pb = usdtPer(b, getRate);
      if (!Number.isFinite(pa) || !Number.isFinite(pb) || pb === 0) return null;
      let rate = pa / pb; // B за A
      let from = a;
      let to = b;
      if (rate > 0 && rate < 1) {
        rate = 1 / rate;
        from = b;
        to = a;
      }
      return { from, to, rate };
    })
    .filter((r) => r && Number.isFinite(r.rate) && r.rate > 0);

  if (rows.length === 0) return null; // один фиат (Москва) → кросса нет

  return (
    <div className="px-1 pt-0.5">
      <div className="flex items-center gap-2 px-2 pb-px">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-soft">
          Кросс
        </span>
        <span className="flex-1 h-px bg-border-soft" />
      </div>
      <div className="rounded-[8px] bg-surface-sunk/50 px-1.5 py-0.5 grid grid-cols-2 gap-x-3">
        {rows.map(({ from, to, rate }) => (
          <div key={`${from}_${to}`} className="flex items-center justify-between gap-1.5 px-1 py-px">
            <span className="font-mono text-[11px] text-muted whitespace-nowrap">
              {from}
              <span className="text-muted-soft mx-0.5">→</span>
              {to}
            </span>
            <span className="font-mono tabular-nums text-[11px] text-ink-soft">
              {formatRateValue(from, to, rate)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
