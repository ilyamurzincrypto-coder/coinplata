// src/components/rates/RatesMarginEditor.jsx
// Редактор курсов в виде макета rates-edit-drawer: секции НАЛ↔TRY (рынок + 2
// маржи → покупка/продажа), USDT (покупка/продажа вручную), КРОСС (авто, RO),
// Импорт. Модель: rate = market + buy_margin; продажа = market − sell_margin.
// Данные — реальные пары стора (global), сохранение через onSetMargins
// (set_pair_margins). Порядок/набор пар не выдумываем — берём из pairs.

import React, { useMemo, useState } from "react";

const ru = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const dp = Math.abs(v) < 2 ? 4 : 2;
  return v.toLocaleString("ru-RU", { minimumFractionDigits: dp, maximumFractionDigits: dp });
};
// Приглушённые хвостовые нули в readonly-числах.
function Zeros({ value }) {
  const s = ru(value);
  const m = String(s).match(/^(.*?,\d*?)(0+)$/);
  if (!m) return <span>{s}</span>;
  return (
    <span>
      {m[1]}
      <span className="text-[#aeb4bb]">{m[2]}</span>
    </span>
  );
}

function Pair({ a, b }) {
  return (
    <span className="text-[13px] font-semibold text-[#15191d] whitespace-nowrap">
      {a}
      <span className="text-[#aeb4bb] font-medium">/{b}</span>
    </span>
  );
}

// Плоское поле-подчёркивание (моно, правое выравнивание), commit по blur/Enter.
function Inp({ value, onCommit, sign = null, width = "w-[60px]" }) {
  const [draft, setDraft] = useState(null);
  const shown = draft != null ? draft : Number.isFinite(Number(value)) ? ru(value) : "";
  const commit = () => {
    if (draft == null) return;
    const n = Number(String(draft).replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(n)) onCommit(n);
    setDraft(null);
  };
  return (
    <span className="inline-flex items-center gap-1 justify-end">
      {sign && <span className="font-mono text-[12px] font-bold text-[#aeb4bb]">{sign}</span>}
      <input
        inputMode="decimal"
        value={shown}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.,-]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        className={`${width} bg-transparent border-0 border-b border-[rgba(18,22,26,0.15)] rounded-none px-1 py-0.5 text-[12.5px] font-mono tabular-nums font-semibold text-right text-[#15191d] outline-none hover:border-[#6a717a] focus:border-[#0c9c6b]`}
      />
    </span>
  );
}

function Sect({ label, src }) {
  return (
    <div className="flex items-center gap-2.5 pt-5 pb-2">
      <span className="text-[10px] font-extrabold tracking-[1.4px] uppercase text-[#6a717a]">{label}</span>
      {src && <span className="text-[10.5px] text-[#aeb4bb]">· {src}</span>}
      <span className="flex-1 h-px bg-[rgba(18,22,26,0.08)]" />
    </div>
  );
}

const FIATS = ["USD", "EUR", "GBP", "CHF", "RUB"];

export default function RatesMarginEditor({
  pairs, // [{from,to}]
  getMarketRate,
  getBuyMargin,
  getSellMargin,
  getRate,
  onSetMargins,
  onOpenImport,
}) {
  const buckets = useMemo(() => {
    const auto = [];
    const usdt = [];
    const cross = [];
    const other = [];
    pairs.forEach((p) => {
      const { from, to } = p;
      if (to === "TRY" && from !== "USDT" && from !== "TRY" && FIATS.includes(from)) auto.push(p);
      else if (from === "USDT") usdt.push(p);
      else if (from !== "USDT" && to !== "USDT" && from !== "TRY" && to !== "TRY") cross.push(p);
      else other.push(p);
    });
    return { auto, usdt, cross, other };
  }, [pairs]);

  const set = (from, to, patch) => onSetMargins?.(from, to, patch);

  // Грид НАЛ↔TRY: пара | рынок | +марж.пок | −марж.прод | покупка | продажа
  const AUTO_GRID = { gridTemplateColumns: "1fr 96px 78px 78px 76px 76px" };
  // Грид USDT/КРОСС: пара | покупка | продажа
  const TWO_GRID = { gridTemplateColumns: "1fr 1fr 1fr" };

  return (
    <div className="text-[#15191d]">
      {/* ── НАЛ ↔ TRY ── */}
      {buckets.auto.length > 0 && (
        <>
          <Sect label="Нал ↔ TRY" src="tolunaylar + маржа" />
          <div className="grid items-center pb-1.5 text-[8.5px] font-bold uppercase tracking-[0.7px] text-[#aeb4bb]" style={AUTO_GRID}>
            <span>пара</span>
            <span className="text-right">рынок</span>
            <span className="text-right">маржа пок.</span>
            <span className="text-right">маржа прод.</span>
            <span className="text-right">покупка</span>
            <span className="text-right">продажа</span>
          </div>
          {buckets.auto.map(({ from, to }) => {
            const m = Number(getMarketRate(from, to));
            const bm = Number(getBuyMargin(from, to));
            const sm = Number(getSellMargin(from, to));
            return (
              <div key={`${from}_${to}`} className="grid items-center py-2 border-t border-[rgba(18,22,26,0.08)]" style={AUTO_GRID}>
                <Pair a={from} b={to} />
                <span className="text-right font-mono text-[12.5px] text-[#6a717a]">
                  <Inp value={m} onCommit={(n) => set(from, to, { market: n })} width="w-[64px]" />
                  <span className="block text-[8.5px] text-[#aeb4bb] font-sans pr-1">tolunaylar</span>
                </span>
                <span className="text-right">
                  <Inp value={bm} sign="+" onCommit={(n) => set(from, to, { buyMargin: n })} />
                </span>
                <span className="text-right">
                  <Inp value={sm} sign="−" onCommit={(n) => set(from, to, { sellMargin: n })} />
                </span>
                <span className="text-right font-mono tabular-nums text-[13px] font-bold">
                  <Zeros value={m + bm} />
                </span>
                <span className="text-right font-mono tabular-nums text-[13px] text-[#6a717a]">
                  <Zeros value={m - sm} />
                </span>
              </div>
            );
          })}
        </>
      )}

      {/* ── USDT (покупка/продажа вручную) ── */}
      {buckets.usdt.length > 0 && (
        <>
          <Sect label="USDT" src="утро, вручную" />
          <div className="grid items-center pb-1.5 text-[8.5px] font-bold uppercase tracking-[0.7px] text-[#aeb4bb]" style={TWO_GRID}>
            <span>пара</span>
            <span className="text-right">покупка</span>
            <span className="text-right">продажа</span>
          </div>
          {buckets.usdt.map(({ from, to }) => {
            const m = Number(getMarketRate(from, to));
            const bm = Number(getBuyMargin(from, to));
            const sm = Number(getSellMargin(from, to));
            return (
              <div key={`${from}_${to}`} className="grid items-center py-2 border-t border-[rgba(18,22,26,0.08)]" style={TWO_GRID}>
                <Pair a={from} b={to} />
                {/* покупка = market + buy_margin (== rate сделок). Правка → buy_margin */}
                <span className="text-right">
                  <Inp value={m + bm} onCommit={(n) => set(from, to, { buyMargin: n - m })} width="w-[72px]" />
                </span>
                {/* продажа = market − sell_margin. Правка → sell_margin */}
                <span className="text-right">
                  <Inp value={m - sm} onCommit={(n) => set(from, to, { sellMargin: m - n })} width="w-[72px]" />
                </span>
              </div>
            );
          })}
        </>
      )}

      {/* ── КРОСС (авто, read-only) ── */}
      {buckets.cross.length > 0 && (
        <>
          <Sect label="Кросс" src="через USDT, авто" />
          <div className="grid items-center pb-1.5 text-[8.5px] font-bold uppercase tracking-[0.7px] text-[#aeb4bb]" style={TWO_GRID}>
            <span>пара</span>
            <span className="text-right">покупка</span>
            <span className="text-right">продажа</span>
          </div>
          {buckets.cross.map(({ from, to }) => {
            const r = Number(getRate(from, to));
            return (
              <div key={`${from}_${to}`} className="grid items-center py-2 border-t border-[rgba(18,22,26,0.08)]" style={TWO_GRID}>
                <Pair a={from} b={to} />
                <span className="text-right font-mono tabular-nums text-[13px]">
                  <Zeros value={r} />
                </span>
                <span className="text-right font-mono tabular-nums text-[12.5px] text-[#6a717a] relative">
                  <Zeros value={r > 0 ? 1 / r : 0} />
                  <span className="ml-1 text-[9px] text-[#aeb4bb]">авто</span>
                </span>
              </div>
            );
          })}
        </>
      )}

      {/* ── Прочие пары (чтобы ничего не потерять) ── */}
      {buckets.other.length > 0 && (
        <>
          <Sect label="Прочие" src="рынок + маржа" />
          <div className="grid items-center pb-1.5 text-[8.5px] font-bold uppercase tracking-[0.7px] text-[#aeb4bb]" style={TWO_GRID}>
            <span>пара</span>
            <span className="text-right">рынок</span>
            <span className="text-right">маржа</span>
          </div>
          {buckets.other.map(({ from, to }) => {
            const m = Number(getMarketRate(from, to));
            const bm = Number(getBuyMargin(from, to));
            return (
              <div key={`${from}_${to}`} className="grid items-center py-2 border-t border-[rgba(18,22,26,0.08)]" style={TWO_GRID}>
                <Pair a={from} b={to} />
                <span className="text-right">
                  <Inp value={m} onCommit={(n) => set(from, to, { market: n })} width="w-[72px]" />
                </span>
                <span className="text-right">
                  <Inp value={bm} sign="+" onCommit={(n) => set(from, to, { buyMargin: n })} width="w-[64px]" />
                </span>
              </div>
            );
          })}
        </>
      )}

      {/* ── Импорт ── */}
      <Sect label="Импорт" src="утренний текст / xlsx" />
      <button
        type="button"
        onClick={onOpenImport}
        className="mt-1 text-[12px] font-bold text-[#15191d] bg-[rgba(18,22,26,0.05)] hover:bg-[rgba(18,22,26,0.09)] rounded-[8px] px-4 py-2 transition-colors"
      >
        Открыть импорт
      </button>
    </div>
  );
}
