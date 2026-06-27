// src/components/rates/NerezPanel.jsx
// Панель НЕРЕЗ TOD/TOM внутри карточки RU-офиса. Матрица: Прод./Покуп. × Т-Т/Т-М/М-М.
// Значения копируемые. Данные — снимок specialRates (kind=nerez).

import React from "react";
import { Landmark, Clock } from "lucide-react";
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
      {/* Заголовок блока — в офис-стиле (как город) */}
      <div className="flex items-center justify-between gap-2.5 px-1 pb-2 mb-1.5 border-b border-[#e7e9f1]">
        <span className="flex items-center gap-2 min-w-0">
          <Landmark className="w-3.5 h-3.5 text-[#0fa56f] shrink-0" strokeWidth={2.2} />
          <span className="text-[14.5px] font-bold tracking-tight text-ink truncate">
            {pair.replace("/", " ↔ ")} · НЕРЕЗ
          </span>
        </span>
        {fresh && (
          <span
            className="inline-flex items-center gap-1.5 shrink-0 text-[11px] font-semibold text-[#8a8fa6] bg-[#f4f5fa] border border-[#e7e9f1] px-2.5 py-[3px] rounded-full"
            title="Когда обновлён НЕРЕЗ"
          >
            <Clock className="w-3 h-3 opacity-85" strokeWidth={2.2} />
            {fresh}
          </span>
        )}
      </div>
      <div className="grid items-center gap-y-0.5 gap-x-2 px-1" style={GRID}>
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
