// src/components/rates/CrossRatesPanel.jsx
// Кросс-курсы (кеш-кеш) офиса между его валютами, через USDT. Показываем ОБА
// направления каждой пары (USD→TRY И TRY→USD) — каждое со своим значением.
// Конвенция хранения: TRY/RUB котируются «валюта за USDT» (46,2 = TRY за USDT),
// USD/EUR — «USDT за валюту» (1,142 = USDT за EUR). Чтобы направления не врали,
// считаем через «USDT за единицу валюты» (usdtPer). Москва (один RUB) — без кросса.

import React from "react";
import { isPercentPair } from "../../utils/ratesFormat.js";

// Валюты, котируемые «USDT за X» (крепче/паритет USDT): читаемое = usdtPer.
const STRONG = new Set(["USD", "EUR"]);

// USDT за 1 единицу валюты X.
function usdtPer(x, getRate) {
  if (x === "USDT") return 1;
  const raw = Number(getRate?.("USDT", x));
  if (!Number.isFinite(raw) || raw <= 0) return NaN;
  if (isPercentPair("USDT", x)) return 1 / raw; // USD ~ паритет
  const readable = raw < 1 ? 1 / raw : raw; // «читаемое» >1
  return STRONG.has(x) ? readable : 1 / readable;
}

// Формат значения в свою сторону (без реципрока): и крупные (46,5), и мелкие (0,0215).
function fmtCross(n) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  let d;
  if (n >= 100) d = 2;
  else if (n >= 10) d = 3;
  else if (n >= 1) d = 4;
  else if (n >= 0.1) d = 4;
  else if (n >= 0.01) d = 5;
  else d = 6;
  let s = n.toFixed(d).replace(/0+$/, "").replace(/\.$/, "");
  return s.replace(".", ",");
}

function uniquePairs(ccys) {
  const out = [];
  for (let i = 0; i < ccys.length; i++)
    for (let j = i + 1; j < ccys.length; j++) out.push([ccys[i], ccys[j]]);
  return out;
}

export default function CrossRatesPanel({ getRate, ccys }) {
  const fiats = (ccys || []).filter((c) => c !== "USDT");

  // Для каждой уникальной пары — обе стороны подряд (forward слева, reverse справа).
  const rows = [];
  uniquePairs(fiats).forEach(([a, b]) => {
    const pa = usdtPer(a, getRate);
    const pb = usdtPer(b, getRate);
    if (!Number.isFinite(pa) || !Number.isFinite(pb) || pa <= 0 || pb <= 0) return;
    rows.push({ from: a, to: b, rate: pa / pb });
    rows.push({ from: b, to: a, rate: pb / pa });
  });

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
              {fmtCross(rate)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
