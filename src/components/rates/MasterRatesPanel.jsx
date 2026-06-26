// src/components/rates/MasterRatesPanel.jsx
// Тело карточки офиса: строки валют против USDT. Колонки: →USDT (зелёная, X→USDT)
// и USDT→ (красная, USDT→X). Чип валюты + код + два копируемых числа. Read-only.

import React from "react";
import { formatRateValue } from "../../utils/ratesFormat.js";
import RateNum from "./RateNum.jsx";

const DEFAULT_QUOTES = ["USD", "TRY", "EUR"];
const GRID = { gridTemplateColumns: "1fr 76px 76px" };

// Символ + цвета чипа по валюте (light-тема макета coinpoint).
export const CCY_META = {
  USD: { sym: "$", bg: "rgba(17,176,122,.12)", fg: "#0d8f63" },
  TRY: { sym: "₺", bg: "rgba(226,83,109,.12)", fg: "#cf3d59" },
  EUR: { sym: "€", bg: "rgba(56,128,235,.12)", fg: "#2f6fd0" },
  RUB: { sym: "₽", bg: "rgba(139,108,240,.13)", fg: "#6f53d4" },
};

export default function MasterRatesPanel({ getRate, quotes, onCopy }) {
  const list = quotes && quotes.length ? quotes : DEFAULT_QUOTES;
  return (
    <div className="pt-0.5">
      {/* Заголовки направлений */}
      <div className="grid items-center px-2 pb-1" style={GRID}>
        <span />
        <span className="text-right text-[10.5px] font-bold tracking-wide text-[#0fa56f]">→USDT</span>
        <span className="text-right text-[10.5px] font-bold tracking-wide text-[#e2536d]">USDT→</span>
      </div>

      {list.map((q) => {
        const meta = CCY_META[q] || { sym: q[0], bg: "var(--surface-sunk)", fg: "#8a8fa6" };
        const into = formatRateValue(q, "USDT", Number(getRate?.(q, "USDT"))); // X→USDT
        const out = formatRateValue("USDT", q, Number(getRate?.("USDT", q))); // USDT→X
        return (
          <div
            key={q}
            className="grid items-center gap-2 px-2 py-[3px] rounded-[10px] transition-colors hover:bg-[#f4f5fa]"
            style={GRID}
          >
            <span className="flex items-center gap-2 min-w-0">
              <span
                className="w-[23px] h-[23px] rounded-[7px] grid place-items-center font-extrabold text-[12px] leading-none shrink-0"
                style={{ background: meta.bg, color: meta.fg }}
              >
                {meta.sym}
              </span>
              <span className="text-[13.5px] font-bold tracking-wide text-ink">{q}</span>
            </span>
            <RateNum value={into} onCopy={onCopy} className="text-[14px]" />
            <RateNum value={out} onCopy={onCopy} className="text-[14px]" />
          </div>
        );
      })}
    </div>
  );
}
