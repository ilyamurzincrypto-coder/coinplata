// src/components/rates/QrRubPanel.jsx
// QR-рубль (СБП/QR) на дашборде «Курсы», контейнер 2 (под НЕРЕЗ). ОТОБРАЖЕНИЕ.
// Якорь: 1 USDT в рублях = курс ЦБ USD/RUB (USDT≈USD) × (1 + спред). ЦБ — ТОЛЬКО
// к рублю. Ниже USD/EUR/TRY считаем через USDT: QR₽ за 1 вал = якорь × usdtPer(вал).
// Спред задаётся в РЕДАКТОРЕ курсов и живёт в rate_blocks.config (lib/qrSpread);
// тут только показ. localStorage больше не источник — см. шапку lib/qrSpread.js.

import React, { useEffect, useState } from "react";
import { usdtPer } from "../../lib/rates.js";
import { loadQrSpread, QR_SOURCE } from "../../lib/qrSpread.js";
const fmt = (v, dp = 2) => (Number.isFinite(Number(v)) ? Number(v).toFixed(dp).replace(".", ",") : "—");

const ROWS = [
  { cur: "USDT", flag: "₮" },
  { cur: "USD", flag: "🇺🇸" },
  { cur: "EUR", flag: "🇪🇺" },
  { cur: "TRY", flag: "🇹🇷" },
];

export default function QrRubPanel({ cbr, getRate, onCopy }) {
  // Read-only: спред задаётся в редакторе курсов, источник — база.
  const [spread, setSpread] = useState(null);
  const [source, setSource] = useState(QR_SOURCE.NONE);
  useEffect(() => {
    let alive = true;
    loadQrSpread().then((r) => { if (alive) { setSpread(r.value); setSource(r.source); } });
    return () => { alive = false; };
  }, []);
  const spreadStr = spread == null ? "—" : String(spread).replace(".", ",");
  // Якорь: рублей за 1 USDT = ЦБ USD/RUB × (1+спред). ЦБ применяется только тут.
  const usdtBase = Number(cbr?.USD_RUB);
  // Без спреда курс НЕ считается: показать якорь «как есть» значило бы выдать
  // ЦБ за курс приёма рублей. Лучше прочерк, чем чужое число.
  const usdtItog =
    spread != null && Number.isFinite(usdtBase) && usdtBase > 0 ? usdtBase * (1 + spread / 100) : NaN;
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
          <span className="tabular-nums text-[12px] font-bold">{spreadStr}</span>
          <span className="text-[10px] text-[#aeb4bb]">%</span>
        </span>
      </div>
      {/* Якорь: 1 USDT в рублях (ЦБ + спред) */}
      <div className="flex items-baseline justify-between mb-2 text-[10.5px]">
        <span className="text-[#aeb4bb]">1 ₮ = ЦБ {fmt(usdtBase)} +&nbsp;спред</span>
        <span className="tabular-nums font-bold text-[#15191d]">{fmt(usdtItog)} ₽</span>
      </div>
      <div className="grid items-baseline gap-y-1.5 gap-x-2" style={{ gridTemplateColumns: "minmax(60px,auto) 1fr 1fr" }}>
        <span />
        <span className="text-right text-[8.5px] font-semibold tracking-[0.8px] uppercase text-[#aeb4bb]">₮ за&nbsp;1</span>
        <span className="text-right text-[8.5px] font-semibold tracking-[0.8px] uppercase text-[#aeb4bb]">Курс QR&nbsp;₽</span>
        {rows.map((r) => (
          <React.Fragment key={r.cur}>
            <span className="tabular-nums text-[12px] font-semibold text-[#15191d] flex items-center gap-1.5">
              <span>{r.flag}</span>{r.cur}
            </span>
            <span className="text-right tabular-nums text-[12px] text-[#6a717a]">{fmt(r.up, 4)}</span>
            <button
              type="button"
              onClick={() => Number.isFinite(r.qr) && onCopy?.(fmt(r.qr))}
              className="text-right tabular-nums text-[13px] font-bold text-[#0c9c6b] hover:opacity-70"
              title="Копировать"
            >
              {fmt(r.qr)}
            </button>
          </React.Fragment>
        ))}
      </div>
      {/* Спред переехал в rate_blocks.config. Плашка остаётся только для двух
          нештатных случаев: база недоступна (показан кэш) или значения нет
          вовсе. В норме подписи нет — параметр общий и сомнений не вызывает. */}
      {source === QR_SOURCE.CACHE && (
        <p className="text-[11px] text-apps-warn mt-2.5">
          база недоступна — показано последнее известное значение
        </p>
      )}
      {source === QR_SOURCE.NONE && (
        <p className="text-[11px] text-apps-warn mt-2.5">
          спред не загружен — курс QR не рассчитан
        </p>
      )}
      <p className="text-[10px] text-[#aeb4bb] mt-2 pt-2 border-t border-[rgba(18,22,26,0.08)] leading-snug">
        {!hasData && <span className="text-warning font-semibold">Курс ЦБ ещё не загрузился. </span>}
        ЦБ — только к рублю (1 ₮ = ЦБ USD/RUB × (1 + спред)). USD/EUR/TRY — через USDT. Спред — в редакторе курсов; в сделки не публикуется.
      </p>
    </div>
  );
}
