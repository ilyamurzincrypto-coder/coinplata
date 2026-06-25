// src/components/rates/NerezPanel.jsx
// Спец-курсы USDT↔RUB НЕРЕЗ (TOD/TOM) из снимка утреннего импорта (specialRates).
// Read-only: две стороны (Прод./Покуп.) × три расчёта (TOD-TOD/TOD-TOM/TOM-TOM).

import React from "react";

const SETTLES = [
  ["TOD-TOD", "T-T"],
  ["TOD-TOM", "T-M"],
  ["TOM-TOM", "M-M"],
];
const SIDES = [
  ["sell", "Прод."],
  ["buy", "Покуп."],
];
const GRID = { gridTemplateColumns: "52px 1fr 1fr 1fr" };

function fmt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2).replace(".", ",") : "—";
}

export default function NerezPanel({ specialRates }) {
  const nerez = (specialRates || []).filter((s) => s && s.kind === "nerez");
  if (!nerez.length) return null;

  const lookup = {};
  let pair = "USDT/RUB";
  nerez.forEach((s) => {
    const side = String(s.side || "").toLowerCase();
    const settle = String(s.settle || "").toUpperCase();
    lookup[`${side}_${settle}`] = s.value;
    if (s.pair) pair = s.pair;
  });

  return (
    <section className="px-1 pt-2">
      <div className="flex items-center gap-2 px-2 pb-1">
        <span className="text-micro font-bold uppercase tracking-wider text-muted-soft">
          {pair.replace("/", "↔")}
        </span>
        <span className="text-tiny font-mono text-muted-soft">TOD/TOM · НЕРЕЗ</span>
        <span className="flex-1 h-px bg-border-soft" />
      </div>

      <div className="rounded-[10px] bg-surface-sunk/60 px-2 py-1.5">
        {/* Заголовки расчётов */}
        <div className="grid items-center pb-1" style={GRID}>
          <span />
          {SETTLES.map(([code, label]) => (
            <span
              key={code}
              className="text-right text-tiny font-mono text-muted-soft"
              title={code}
            >
              {label}
            </span>
          ))}
        </div>
        {/* Строки сторон */}
        {SIDES.map(([key, label]) => (
          <div key={key} className="grid items-center py-0.5" style={GRID}>
            <span className="text-tiny font-semibold text-muted">{label}</span>
            {SETTLES.map(([code]) => (
              <span
                key={code}
                className="text-right font-mono tabular-nums text-body-sm text-ink-soft"
              >
                {fmt(lookup[`${key}_${code}`])}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
