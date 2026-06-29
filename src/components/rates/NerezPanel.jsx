// src/components/rates/NerezPanel.jsx
// Панель НЕРЕЗ TOD/TOM внутри RU-блока. Матрица: Прод./Покуп. × Т-Т/Т-М/М-М.
// Терминальный вид: hairline-заголовок, точка свежести, копируемые числа.
// Структура матрицы/порядок — без изменений.

import React from "react";
import RateNum from "./RateNum.jsx";

const SETTLES = [
  ["TOD-TOD", "Т-Т"],
  ["TOD-TOM", "Т-М"],
  ["TOM-TOM", "М-М"],
];
const SIDES = [
  ["sell", "Прод."],
  ["buy", "Покуп."],
];
const GRID = { gridTemplateColumns: "minmax(50px,auto) repeat(3,1fr)" };

function fmt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2).replace(".", ",") : "—";
}

export default function NerezPanel({ specialRates, onCopy, fresh }) {
  const nerez = (specialRates || []).filter((s) => s && s.kind === "nerez");
  if (!nerez.length) return null;

  const lookup = {};
  let pair = "USDT/RUB";
  nerez.forEach((s) => {
    lookup[`${String(s.side || "").toLowerCase()}_${String(s.settle || "").toUpperCase()}`] = s.value;
    if (s.pair) pair = s.pair;
  });

  return (
    <div>
      {/* Заголовок блока — hairline + точка свежести */}
      <div className="flex items-center gap-2 pb-2 mb-1.5 border-b border-[rgba(18,22,26,0.08)]">
        <span className="text-[12.5px] font-bold tracking-tight text-[#15191d] truncate">
          {pair.replace("/", " ↔ ")} <span className="text-[#aeb4bb] font-semibold">· НЕРЕЗ</span>
        </span>
        {fresh && (
          <span className="ml-auto inline-flex items-center gap-1.5 shrink-0 text-[10px] text-[#aeb4bb]">
            <span className="w-[5px] h-[5px] rounded-full bg-[#aeb4bb]" />
            {fresh}
          </span>
        )}
      </div>
      <div className="grid items-baseline gap-y-0.5 gap-x-2" style={GRID}>
        <span />
        {SETTLES.map(([code, label]) => (
          <span
            key={code}
            className="text-right text-[8.5px] font-semibold tracking-[0.8px] uppercase text-[#aeb4bb]"
            title={code}
          >
            {label}
          </span>
        ))}
        {SIDES.map(([key, label]) => (
          <React.Fragment key={key}>
            <span className="text-[12px] font-semibold text-[#6a717a]">{label}</span>
            {SETTLES.map(([code]) => (
              <RateNum
                key={code}
                value={fmt(lookup[`${key}_${code}`])}
                onCopy={onCopy}
                className="text-[13px] text-[#15191d]"
              />
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
