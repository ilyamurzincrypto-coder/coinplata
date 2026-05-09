// src/components/cashier/DealLegsTable.jsx
// Таблица legs[] с заголовком + + Add IN / + Add OUT кнопками снизу.
// Tab-flow: Cell-based refs[][], Tab/Shift+Tab перемещает по ячейкам в строке,
// Enter переходит на следующую строку (создаёт новую если нет).

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Plus, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import LegRow from "./LegRow.jsx";
import { useRates } from "../../store/rates.jsx";

// 7 grid-columns headers (Side, Currency, Amount, Rate, Source/Dest, Account, ⌫)
const HEADERS = ["", "Валюта", "Сумма", "Курс", "Тип", "Счёт", ""];
const NUM_CELLS = 6; // skip side(0) and trash(6) — focusable cells: 1..5

export default function DealLegsTable({
  legs,
  onUpdate,
  onRemove,
  onAddLeg,
  onToggleSide,
  inLegs,
  outLegs,
  officeId,
  clientBalances = {},   // {currency: number} — баланс клиента per currency
  errorsByLeg,           // Map<legId, Error[]> — per-leg field errors from validateTx
}) {
  const { getRate } = useRates();
  const refs = useRef({});

  const setCellRef = useCallback((rowIdx, colIdx, el) => {
    refs.current[`${rowIdx}_${colIdx}`] = el;
  }, []);

  // ── Tab-flow handler ──
  const onCellKeyDown = useCallback((e, rowIdx, colIdx) => {
    // Shift+Tab — назад; Tab — вперёд; Enter — следующая строка.
    const focusable = (r, c) => {
      const el = refs.current[`${r}_${c}`];
      if (el && !el.disabled) {
        el.focus();
        if (typeof el.select === "function") el.select();
        return true;
      }
      return false;
    };
    const next = (r, c) => {
      // Перебираем колонки 1..5, потом следующую строку
      for (let cc = c + 1; cc <= 5; cc++) {
        if (focusable(r, cc)) return true;
      }
      // Следующая строка с col 1
      for (let cc = 1; cc <= 5; cc++) {
        if (focusable(r + 1, cc)) return true;
      }
      return false;
    };
    const prev = (r, c) => {
      for (let cc = c - 1; cc >= 1; cc--) {
        if (focusable(r, cc)) return true;
      }
      for (let cc = 5; cc >= 1; cc--) {
        if (focusable(r - 1, cc)) return true;
      }
      return false;
    };
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) prev(rowIdx, colIdx);
      else next(rowIdx, colIdx);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Next row col-1; if no next row — add OUT и фокус
      if (!focusable(rowIdx + 1, 1)) {
        // Append OUT row если её нет, потом ждём mount + focus
        const hasOut = legs.some((l) => l.side === "out");
        const newSide = hasOut ? "out" : "out";
        onAddLeg(newSide);
        // Focus в next-tick
        setTimeout(() => focusable(rowIdx + 1, 1), 50);
      }
    }
  }, [legs, onAddLeg]);

  // ── Per-row market rate (для OUT legs) ──
  // Берём rate первой IN-leg.currency → leg.currency (если нет — из getRate)
  const inCurrency = useMemo(() => {
    return inLegs.length > 0 ? inLegs[0].currency : null;
  }, [inLegs]);

  return (
    <div className="border-t border-slate-200">
      {/* Header */}
      <div
        className="grid items-center px-3 py-2 bg-slate-50/60 border-b border-slate-200 text-label"
        style={{
          gridTemplateColumns: "70px 90px 1fr 110px 120px 1.4fr 32px",
          gap: "8px",
        }}
      >
        {HEADERS.map((h, i) => (
          <div key={i} className={i === 2 || i === 3 ? "text-right" : ""}>
            {h}
          </div>
        ))}
      </div>

      {/* Rows */}
      <div>
        {legs.map((leg, rowIdx) => {
          const marketRate =
            leg.side === "out" && inCurrency && leg.currency
              ? getRate(inCurrency, leg.currency)
              : null;
          const clientBal = leg.currency ? clientBalances[leg.currency] : null;
          const legErrors = errorsByLeg?.get(leg.id) || [];
          return (
            <LegRow
              key={leg.id}
              leg={leg}
              rowIndex={rowIdx}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onToggleSide={onToggleSide}
              onCellKeyDown={onCellKeyDown}
              setCellRef={setCellRef}
              officeId={officeId}
              marketRate={marketRate}
              canRemove={legs.length > 1}
              clientBalanceInCurrency={
                Number.isFinite(clientBal) ? clientBal : null
              }
              errors={legErrors}
            />
          );
        })}
      </div>

      {/* Add buttons */}
      <div className="px-3 py-2.5 flex items-center gap-2 border-t border-slate-100 bg-slate-50/30">
        <button
          type="button"
          onClick={() => onAddLeg("in")}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-cell)] bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-[11px] font-bold uppercase tracking-wider"
        >
          <Plus className="w-3 h-3" />
          <ArrowDownLeft className="w-3 h-3" />
          IN
        </button>
        <button
          type="button"
          onClick={() => onAddLeg("out")}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-cell)] bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-[11px] font-bold uppercase tracking-wider"
        >
          <Plus className="w-3 h-3" />
          <ArrowUpRight className="w-3 h-3" />
          OUT
        </button>

        {/* Counts summary */}
        <div className="ml-auto text-hint">
          {inLegs.length} IN · {outLegs.length} OUT
        </div>
      </div>
    </div>
  );
}
