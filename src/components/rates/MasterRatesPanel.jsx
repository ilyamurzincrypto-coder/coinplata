// src/components/rates/MasterRatesPanel.jsx
// Тело офиса: строки валют против USDT. Колонки (как в коде): →USDT (X→USDT) и
// USDT→ (USDT→X). Терминальный вид: без чипов, нейтральные подписи, тусклая
// котируемая валюта (/USDT), копируемые числа. Read-only.

import React from "react";
import { formatRateValue } from "../../utils/ratesFormat.js";
import RateNum from "./RateNum.jsx";

const DEFAULT_QUOTES = ["USD", "TRY", "EUR"];
const GRID = { gridTemplateColumns: "1fr 74px 74px" };

export default function MasterRatesPanel({ getRate, quotes, onCopy }) {
  const list = quotes && quotes.length ? quotes : DEFAULT_QUOTES;
  return (
    <div>
      {/* Колонки направлений — нейтральный uppercase (акцент только на live) */}
      <div className="grid items-center pl-[26px] pr-2 pb-1" style={GRID}>
        <span />
        <span className="text-right text-[8.5px] font-semibold tracking-[0.8px] uppercase text-[#aeb4bb]">→USDT</span>
        <span className="text-right text-[8.5px] font-semibold tracking-[0.8px] uppercase text-[#aeb4bb]">USDT→</span>
      </div>

      {list.map((q) => {
        const into = formatRateValue(q, "USDT", Number(getRate?.(q, "USDT"))); // X→USDT
        const out = formatRateValue("USDT", q, Number(getRate?.("USDT", q))); // USDT→X
        return (
          <div
            key={q}
            className="grid items-baseline pl-[26px] pr-2 py-[5px] hover:bg-[rgba(18,22,26,0.022)] transition-colors"
            style={GRID}
          >
            <span className="text-[12.5px] font-semibold tracking-[-0.1px] text-[#15191d] whitespace-nowrap">
              {q}
              <span className="text-[#aeb4bb] font-medium">/USDT</span>
            </span>
            <RateNum value={into} onCopy={onCopy} className="text-[13px] text-[#15191d]" />
            <RateNum value={out} onCopy={onCopy} className="text-[13px] text-[#6a717a]" />
          </div>
        );
      })}
    </div>
  );
}
