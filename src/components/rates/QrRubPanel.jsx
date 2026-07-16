// src/components/rates/QrRubPanel.jsx
// QR-рубль (СБП/QR) на дашборде «Курсы», контейнер 2 (под НЕРЕЗ).
// Курс QR₽ ↔ USDT/USD/EUR/TRY = курс ЦБ × (1 + наш спред %).
// v1 — ТОЛЬКО ОТОБРАЖЕНИЕ: спред вводится тут (localStorage), в сделки пока НЕ
// публикуется. USDT берём от ЦБ USD/RUB (у ЦБ нет USDT, USDT≈USD).

import React, { useState } from "react";

const SPREAD_KEY = "qr_spread_pct_v1";
const readSpread = () => { try { const v = localStorage.getItem(SPREAD_KEY); return v == null ? "1" : v; } catch { return "1"; } };
const writeSpread = (v) => { try { localStorage.setItem(SPREAD_KEY, String(v)); } catch { /* noop */ } };
const pnum = (v) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const fmt = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2).replace(".", ",") : "—");

// base = курс ЦБ X/RUB (рублей за 1 X). USDT — от USD_RUB.
const ROWS = [
  { cur: "USDT", flag: "₮", pairKey: "USD_RUB" },
  { cur: "USD", flag: "🇺🇸", pairKey: "USD_RUB" },
  { cur: "EUR", flag: "🇪🇺", pairKey: "EUR_RUB" },
  { cur: "TRY", flag: "🇹🇷", pairKey: "TRY_RUB" },
];

export default function QrRubPanel({ cbr, onCopy }) {
  const [spreadStr, setSpreadStr] = useState(readSpread);
  const spread = pnum(spreadStr);
  const rows = ROWS.map((r) => {
    const base = Number(cbr?.[r.pairKey]);
    const qr = Number.isFinite(base) && base > 0 ? base * (1 + spread / 100) : NaN;
    return { ...r, base, qr };
  });
  if (!rows.some((r) => Number.isFinite(r.base) && r.base > 0)) return null; // нет курса ЦБ

  return (
    <div>
      {/* Заголовок + поле спреда */}
      <div className="flex items-center gap-2 pb-2 mb-1.5 border-b border-[rgba(18,22,26,0.08)]">
        <span className="text-[12.5px] font-bold tracking-tight text-[#15191d] truncate">
          QR ₽ <span className="text-[#aeb4bb] font-semibold">· ЦБ + спред</span>
        </span>
        <span className="ml-auto inline-flex items-center gap-1 shrink-0">
          <input
            value={spreadStr}
            onChange={(e) => { setSpreadStr(e.target.value); writeSpread(e.target.value); }}
            inputMode="decimal"
            className="w-[48px] bg-white border border-[rgba(18,22,26,0.12)] rounded-[8px] h-6 px-1.5 font-mono tabular-nums text-[11.5px] text-right outline-none focus:border-[#0c9c6b]"
            title="Спред к курсу ЦБ, %"
          />
          <span className="text-[10px] text-[#aeb4bb]">%</span>
        </span>
      </div>
      <div className="grid items-baseline gap-y-1.5 gap-x-2" style={{ gridTemplateColumns: "minmax(66px,auto) 1fr 1fr" }}>
        <span />
        <span className="text-right text-[8.5px] font-semibold tracking-[0.8px] uppercase text-[#aeb4bb]">ЦБ</span>
        <span className="text-right text-[8.5px] font-semibold tracking-[0.8px] uppercase text-[#aeb4bb]">Курс QR</span>
        {rows.map((r) => (
          <React.Fragment key={r.cur}>
            <span className="font-mono text-[12px] font-semibold text-[#15191d] flex items-center gap-1.5">
              <span>{r.flag}</span>{r.cur}
            </span>
            <span className="text-right font-mono tabular-nums text-[12px] text-[#6a717a]">{fmt(r.base)}</span>
            <button
              type="button"
              onClick={() => Number.isFinite(r.qr) && onCopy?.(fmt(r.qr))}
              className="text-right font-mono tabular-nums text-[13px] font-bold text-[#0c9c6b] hover:opacity-70"
              title="Копировать"
            >
              {fmt(r.qr)}
            </button>
          </React.Fragment>
        ))}
      </div>
      <p className="text-[10px] text-[#aeb4bb] mt-2 pt-2 border-t border-[rgba(18,22,26,0.08)] leading-snug">
        QR-рубль = курс ЦБ × (1 + спред %). USDT — от ЦБ USD/RUB (USDT≈USD). Пока отображение; в сделки не публикуется.
      </p>
    </div>
  );
}
