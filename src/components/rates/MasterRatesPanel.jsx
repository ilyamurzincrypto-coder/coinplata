// src/components/rates/MasterRatesPanel.jsx
// Тело офиса: строки валют против USDT. Колонки (как в коде): →USDT (X→USDT) и
// USDT→ (USDT→X). Терминальный вид: без чипов, нейтральные подписи, тусклая
// котируемая валюта (/USDT), копируемые числа. Read-only.

import React from "react";
import { formatRateValue } from "../../utils/ratesFormat.js";
import RateNum from "./RateNum.jsx";

const DEFAULT_QUOTES = ["USD", "TRY", "EUR"];
// minmax(0,1fr) по той же причине, что в кроссе: 1fr не сжимается под
// длинный лейбл и выталкивает числа за край карточки.
const GRID = { gridTemplateColumns: "minmax(0,1fr) 88px 88px" };

export default function MasterRatesPanel({ getRate, quotes, onCopy }) {
  const list = quotes && quotes.length ? quotes : DEFAULT_QUOTES;
  return (
    <div>
      {/* Колонки направлений — нейтральный uppercase (акцент только на live) */}
      <div className="grid items-center pt-3 pb-0.5" style={GRID}>
        <span />
        <span className="text-right text-[10.5px] text-faint">→ USDT</span>
        <span className="text-right text-[10.5px] text-faint">USDT →</span>
      </div>

      {list.map((q) => {
        const into = formatRateValue(q, "USDT", Number(getRate?.(q, "USDT"))); // X→USDT
        const out = formatRateValue("USDT", q, Number(getRate?.("USDT", q))); // USDT→X
        return (
          <div
            key={q}
            className="grid items-baseline py-2 border-t border-line"
            style={GRID}
          >
            <span className="text-[12.5px] text-muted whitespace-nowrap">
              {q}
            </span>
            <RateNum value={into} onCopy={onCopy} className="text-[17px] text-ink whitespace-nowrap" />
            <RateNum value={out} onCopy={onCopy} className="text-[17px] text-ink whitespace-nowrap" />
          </div>
        );
      })}
    </div>
  );
}
