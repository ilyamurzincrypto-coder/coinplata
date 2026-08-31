// src/components/rates/MasterRatesPanel.jsx
// Тело офиса: строки валют против USDT. Колонки (как в коде): →USDT (X→USDT) и
// USDT→ (USDT→X). Терминальный вид: без чипов, нейтральные подписи, тусклая
// котируемая валюта (/USDT), копируемые числа. Read-only.
//
// r12: наведение на заголовок колонки расшифровывает валюту в полную пару
// кроссфейдом. Порядок колонок ЗДЕСЬ обратный блочной панели, поэтому пара
// строится дескриптором колонки, а не по индексу — см. hoverReveal.jsx.

import React from "react";
import { formatRateValue } from "../../utils/ratesFormat.js";
import RateNum from "./RateNum.jsx";
import { COL_INTO, COL_OUT, Reveal, useRevealHover } from "./hoverReveal.jsx";

const DEFAULT_QUOTES = ["USD", "TRY", "EUR"];
// Порядок колонок переходной панели: сначала «→ USDT», потом «USDT →».
const COLS = [COL_INTO, COL_OUT];
// minmax(0,1fr) по той же причине, что в кроссе: 1fr не сжимается под
// длинный лейбл и выталкивает числа за край карточки.
// 88px → 70px: полной паре «EUR → USDT» не хватало 35px до первого числа
// (измерено в браузере). Числа выровнены ВПРАВО, поэтому сужение колонки
// сдвигает только её невидимую левую границу — ни одна цифра не переехала.
const GRID = { gridTemplateColumns: "minmax(0,1fr) 70px 70px" };

export default function MasterRatesPanel({ getRate, quotes, onCopy }) {
  const list = quotes && quotes.length ? quotes : DEFAULT_QUOTES;
  const { revealed, bind } = useRevealHover();
  const shown = COLS.find((c) => c.key === revealed);

  return (
    <div>
      {/* Колонки направлений — нейтральный uppercase (акцент только на live) */}
      <div className="grid items-center pt-3 pb-0.5" style={GRID}>
        <span />
        {COLS.map((col) => (
          <span
            key={col.key}
            {...bind(col.key)}
            className={`text-right text-[10.5px] cursor-default transition-colors duration-300 ${
              revealed === col.key ? "text-ink" : "text-faint"
            }`}
          >
            {col.caption}
          </span>
        ))}
      </div>

      {list.map((q) => {
        const into = formatRateValue(q, "USDT", Number(getRate?.(q, "USDT"))); // X→USDT
        const out = formatRateValue("USDT", q, Number(getRate?.("USDT", q))); // USDT→X
        const byKey = { into, out };
        return (
          <div
            key={q}
            className="grid items-baseline py-2 border-t border-line"
            style={GRID}
          >
            {/* Свечения нет: на белом фоне белый ореол невидим. Роль
                «проявления» здесь играет контраст — пара приходит чернилами. */}
            <Reveal
              base={q}
              full={shown ? shown.pair(q) : ""}
              on={!!shown}
              className="text-[12.5px] text-muted"
              revealClass="text-ink"
            />
            {COLS.map((col) => (
              <RateNum
                key={col.key}
                value={byKey[col.key]}
                onCopy={onCopy}
                className={`text-[17px] text-ink whitespace-nowrap transition-opacity duration-[350ms] ${
                  revealed && revealed !== col.key ? "opacity-35" : "opacity-100"
                }`}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
