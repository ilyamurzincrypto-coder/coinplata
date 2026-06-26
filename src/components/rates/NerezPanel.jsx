// src/components/rates/NerezPanel.jsx
// Панель НЕРЕЗ TOD/TOM внутри карточки RU-офиса. Матрица: Прод./Покуп. × Т-Т/Т-М/М-М.
// Значения копируемые. Данные — снимок specialRates (kind=nerez).

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

export default function NerezPanel({ specialRates, onCopy }) {
  const nerez = (specialRates || []).filter((s) => s && s.kind === "nerez");
  if (!nerez.length) return null;

  const lookup = {};
  let pair = "USDT/RUB";
  nerez.forEach((s) => {
    lookup[`${String(s.side || "").toLowerCase()}_${String(s.settle || "").toUpperCase()}`] = s.value;
    if (s.pair) pair = s.pair;
  });

  return (
    <div className="mt-2 bg-[#f4f5fa] border border-[#e7e9f1] rounded-[12px] px-2.5 py-1.5">
      <div className="text-[9.5px] font-bold tracking-[1.4px] text-[#8a8fa6] uppercase mb-1">
        {pair.replace("/", " ↔ ")} · НЕРЕЗ
      </div>
      <div className="grid items-center gap-y-0.5 gap-x-2" style={GRID}>
        <span />
        {SETTLES.map(([code, label]) => (
          <span key={code} className="text-right text-[10.5px] font-semibold text-[#8a8fa6]" title={code}>
            {label}
          </span>
        ))}
        {SIDES.map(([key, label]) => (
          <React.Fragment key={key}>
            <span className="text-[12px] font-semibold text-[#454a68]">{label}</span>
            {SETTLES.map(([code]) => (
              <RateNum
                key={code}
                value={fmt(lookup[`${key}_${code}`])}
                onCopy={onCopy}
                className="text-[13px]"
              />
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
