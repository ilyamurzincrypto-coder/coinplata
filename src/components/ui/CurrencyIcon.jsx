// src/components/ui/CurrencyIcon.jsx
//
// Цветная иконка валюты — brand-цвет + символ. Используется ВЕЗДЕ где есть
// валюта (балансы, курсы, формы сделок, отчёты).
//
// Два режима:
//   <CurrencyIcon ccy="USDT" />                  — одиночная (балансы)
//   <CurrencyIcon ccy="USDT" pair="TRY" />       — парная (курсы, сделки)
//
// size:
//   sm   — 18px (внутри строк)
//   md   — 28px (для парных в курсах)
//   lg   — 36px (одиночная в балансах) — default для одиночной
//   xl   — 44px (hero-блоки)
import React from "react";

export const CCY_COLOR = {
  USDT: "#26A17B",  // Tether brand teal-green
  USDC: "#2775CA",
  USD:  "#2E7D32",  // тёмно-зелёный (отличим от USDT)
  TRY:  "#E30A17",  // Turkish flag red
  EUR:  "#003399",  // Euro flag blue
  RUB:  "#5B6BC0",
  GBP:  "#C8102E",
  CHF:  "#DA291C",
  BTC:  "#F7931A",
  ETH:  "#627EEA",
  TON:  "#0098EA",
};

export const CCY_SYMBOL = {
  USDT: "₮",
  USDC: "₵",
  USD:  "$",
  TRY:  "₺",
  EUR:  "€",
  RUB:  "₽",
  GBP:  "£",
  CHF:  "₣",
  BTC:  "₿",
  ETH:  "Ξ",
  TON:  "T",
};

const SIZE_MAP = {
  xs: { box: 11, text: "text-[7px]"  },
  sm: { box: 18, text: "text-[9px]"  },
  md: { box: 28, text: "text-[12px]" },
  lg: { box: 36, text: "text-sm"     },
  xl: { box: 44, text: "text-base"   },
};

function Single({ ccy, size = "lg", className = "" }) {
  const s = SIZE_MAP[size] || SIZE_MAP.lg;
  const bg = CCY_COLOR[ccy] || "#8B8F95";
  const sym = CCY_SYMBOL[ccy] || ccy?.slice(0, 1);
  return (
    <div
      className={`rounded-full flex items-center justify-center text-white font-bold shrink-0 ${s.text} ${className}`.trim()}
      style={{ width: s.box, height: s.box, background: bg }}
      aria-label={ccy}
    >
      {sym}
    </div>
  );
}

// Pair — две перекрывающиеся иконки.
//   ringColorClass — Tailwind border-color класс под фон карточки.
//     На favorited-фоне обводка должна быть в цвет fav-bg, иначе белая
//     обводка торчит на жёлтом. По умолчанию border-surface (white).
//   overlap — насколько вторая иконка перекрывает первую (для xs=12px
//     уменьшаем, иначе вылазит за рамку).
function Pair({ from, to, size = "sm", className = "", ringColorClass = "border-surface" }) {
  const overlap = size === "xs" ? "-ml-1" : "-ml-1.5";
  return (
    <div className={`inline-flex items-center ${className}`}>
      <Single ccy={from} size={size} className={`border-[1.5px] ${ringColorClass}`} />
      <Single ccy={to}   size={size} className={`border-[1.5px] ${ringColorClass} ${overlap}`} />
    </div>
  );
}

export default function CurrencyIcon({ ccy, pair, size, className, ringColorClass }) {
  if (pair) return <Pair from={ccy} to={pair} size={size} className={className} ringColorClass={ringColorClass} />;
  return <Single ccy={ccy} size={size} className={className} />;
}
