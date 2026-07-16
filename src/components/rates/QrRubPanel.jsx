// src/components/rates/QrRubPanel.jsx
// QR-рубль (СБП/QR) на дашборде «Курсы», контейнер 2 (под НЕРЕЗ). ОТОБРАЖЕНИЕ.
// Якорь: 1 USDT в рублях = курс ЦБ USD/RUB (USDT≈USD) × (1 + спред). ЦБ — ТОЛЬКО
// к рублю. Ниже USD/EUR/TRY считаем через USDT: QR₽ за 1 вал = якорь × usdtPer(вал).
// Спред задаётся в РЕДАКТОРЕ курсов (общий localStorage); тут только показ.

import React from "react";
import { usdtPer } from "../../lib/rates.js";

// Спред QR — общий для дашборда и редактора. Один ключ → правка в редакторе видна тут.
export const QR_SPREAD_KEY = "qr_spread_pct_v1";
export const readQrSpread = () => { try { const v = localStorage.getItem(QR_SPREAD_KEY); return v == null ? "1" : v; } catch { return "1"; } };
export const writeQrSpread = (v) => { try { localStorage.setItem(QR_SPREAD_KEY, String(v)); } catch { /* noop */ } };
const pnum = (v) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const fmt = (v, dp = 2) => (Number.isFinite(Number(v)) ? Number(v).toFixed(dp).replace(".", ",") : "—");

const ROWS = [
  { cur: "USDT", flag: "₮" },
  { cur: "USD", flag: "🇺🇸" },
  { cur: "EUR", flag: "🇪🇺" },
  { cur: "TRY", flag: "🇹🇷" },
];

export default function QrRubPanel({ cbr, getRate, onCopy }) {
  // Read-only: спред задаётся в редакторе курсов. Читаем свежим каждый рендер.
  const spreadStr = readQrSpread();
  const spread = pnum(spreadStr);
  // Якорь: рублей за 1 USDT = ЦБ USD/RUB × (1+спред). ЦБ применяется только тут.
  const usdtBase = Number(cbr?.USD_RUB);
  const usdtItog = Number.isFinite(usdtBase) && usdtBase > 0 ? usdtBase * (1 + spread / 100) : NaN;
  // Остальное — через USDT: QR₽ за 1 вал = якорь × (USDT за 1 вал).
  const rows = ROWS.map((r) => {
    const up = r.cur === "USDT" ? 1 : usdtPer(r.cur, getRate); // USDT за 1 вал
    const qr = Number.isFinite(usdtItog) && Number.isFinite(up) && up > 0 ? usdtItog * up : NaN;
    return { ...r, up, qr };
  });
  const hasData = Number.isFinite(usdtItog);

  return (
    <div>
      <div className="flex items-center gap-2 pb-2 mb-1.5 border-b border-[rgba(18,22,26,0.08)]">
        <span className="text-[12.5px] font-bold tracking-tight text-[#15191d] truncate">
          QR ₽ <span className="text-[#aeb4bb] font-semibold">· ЦБ + спред</span>
        </span>
        <span className="ml-auto inline-flex items-baseline gap-1 shrink-0 text-[#6a717a]">
          <span className="text-[9px] uppercase tracking-wide text-[#aeb4bb] font-semibold">спред</span>
          <span className="font-mono tabular-nums text-[12px] font-bold">{spreadStr}</span>
          <span className="text-[10px] text-[#aeb4bb]">%</span>
        </span>
      </div>
      {/* Якорь: 1 USDT в рублях (ЦБ + спред) */}
      <div className="flex items-baseline justify-between mb-2 text-[10.5px]">
        <span className="text-[#aeb4bb]">1 ₮ = ЦБ {fmt(usdtBase)} +&nbsp;спред</span>
        <span className="font-mono tabular-nums font-bold text-[#15191d]">{fmt(usdtItog)} ₽</span>
      </div>
      <div className="grid items-baseline gap-y-1.5 gap-x-2" style={{ gridTemplateColumns: "minmax(60px,auto) 1fr 1fr" }}>
        <span />
        <span className="text-right text-[8.5px] font-semibold tracking-[0.8px] uppercase text-[#aeb4bb]">₮ за&nbsp;1</span>
        <span className="text-right text-[8.5px] font-semibold tracking-[0.8px] uppercase text-[#aeb4bb]">Курс QR&nbsp;₽</span>
        {rows.map((r) => (
          <React.Fragment key={r.cur}>
            <span className="font-mono text-[12px] font-semibold text-[#15191d] flex items-center gap-1.5">
              <span>{r.flag}</span>{r.cur}
            </span>
            <span className="text-right font-mono tabular-nums text-[12px] text-[#6a717a]">{fmt(r.up, 4)}</span>
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
        {!hasData && <span className="text-warning font-semibold">Курс ЦБ ещё не загрузился. </span>}
        ЦБ — только к рублю (1 ₮ = ЦБ USD/RUB × (1 + спред)). USD/EUR/TRY — через USDT. Спред — в редакторе курсов; в сделки не публикуется.
      </p>
    </div>
  );
}
