// src/components/rates/PairCoins.jsx
// Визуальный бейдж пары: две перекрывающиеся «монеты» (символ + мягкий тон
// валюты), белое кольцо для разделения на наложении. Чисто декоративно —
// aria-hidden. Цвета/символы из общего ccyMeta.

import React from "react";
import { ccyMeta } from "../balances/currencyMeta.js";

function Coin({ ccy }) {
  const m = ccyMeta(ccy);
  return (
    <span
      className="inline-grid place-items-center w-[19px] h-[19px] rounded-full ring-[1.5px] ring-white text-[10px] font-bold leading-none shrink-0"
      style={{ background: m.bg, color: m.fg }}
    >
      {m.sym}
    </span>
  );
}

export default function PairCoins({ a, b }) {
  return (
    <span className="inline-flex items-center shrink-0" aria-hidden>
      <Coin ccy={a} />
      <span className="-ml-[7px]">
        <Coin ccy={b} />
      </span>
    </span>
  );
}
