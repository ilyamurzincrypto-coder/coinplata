// src/components/deal-form/DealLeg.jsx
//
// Одна нога формы сделки — IN («Клиент даёт») или OUT («Мы отдаём»).
// Phase 1: одна нога, без multi-leg, без balance hints (будут в Phase 2).
//
// Структура:
//   • Header блока: номер ● + лейбл + (опц.) кнопка «Ещё внесение»
//   • Big amount input (44px mono) + ccy-pill справа
//   • Account-pill ниже + (TODO Phase 2: balance hint)

import React from "react";
import { ChevronDown } from "lucide-react";
import CurrencyIcon from "../ui/CurrencyIcon.jsx";
import BalanceHint from "./BalanceHint.jsx";

export default function DealLeg({
  number,           // "1" | "2" (просто display)
  label,            // "Клиент даёт" | "Мы отдаём"
  direction,        // "in" | "out" — для BalanceHint
  amount,
  onAmountChange,
  currency,
  currencyOptions,  // ["USDT", "USD", "TRY", "EUR", ...]
  onCurrencyChange,
  accountId,
  accountOptions,   // [{ id, name, currency, ... }]
  onAccountChange,
  onAddLeg,         // Phase 1: только prop, реально не рендерим multi-leg
  addLegLabel = "Ещё",
}) {
  return (
    <div className="px-7 py-5 border-b border-border-soft">
      {/* Header блока */}
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-ink text-white text-[11px] font-bold font-mono tabular">
            {number}
          </span>
          <span className="text-micro text-muted uppercase">{label}</span>
        </div>
        {onAddLeg && (
          <button
            type="button"
            onClick={onAddLeg}
            className="text-caption text-accent hover:text-accent-hover font-semibold"
            title="Добавить ещё одну ногу"
          >
            + {addLegLabel}
          </button>
        )}
      </div>

      {/* Big amount + ccy-pill */}
      <div className="flex items-center gap-3 mb-3">
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="0"
          className="flex-1 min-w-0 text-[44px] leading-none font-mono tabular font-bold text-ink placeholder:text-muted-soft bg-transparent outline-none border-0"
        />
        <CcyPill
          ccy={currency}
          options={currencyOptions}
          onChange={onCurrencyChange}
        />
      </div>

      {/* Account-pill + balance hint */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <AccountPill
          accountId={accountId}
          options={accountOptions}
          currency={currency}
          onChange={onAccountChange}
        />
        <BalanceHint
          accountId={accountId}
          amount={amount}
          direction={direction}
          currency={currency}
        />
      </div>
    </div>
  );
}

// ── Currency pill (компактный select-style с круглой иконкой) ─────────
function CcyPill({ ccy, options, onChange }) {
  return (
    <label className="inline-flex items-center gap-2 h-10 px-3 rounded-pill bg-surface-soft hover:bg-surface-sunk cursor-pointer transition-colors shrink-0 relative">
      <CurrencyIcon ccy={ccy} size="sm" />
      <span className="font-mono font-bold text-body text-ink">{ccy}</span>
      <ChevronDown className="w-3 h-3 text-muted" strokeWidth={2.2} />
      <select
        value={ccy}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer"
      >
        {options.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  );
}

// ── Account pill (показывает имя счёта или placeholder) ───────────────
function AccountPill({ accountId, options, currency, onChange }) {
  const filtered = options.filter((a) => a.currency === currency && a.active !== false);
  const selected = filtered.find((a) => a.id === accountId);
  return (
    <label className="inline-flex items-center gap-2 h-8 px-2.5 rounded-pill bg-surface-soft hover:bg-surface-sunk cursor-pointer transition-colors relative">
      <CurrencyIcon ccy={currency} size="sm" />
      <span className="text-body-sm font-semibold text-ink">
        {selected ? selected.name : "Выбрать счёт"}
      </span>
      <ChevronDown className="w-3 h-3 text-muted" strokeWidth={2.2} />
      <select
        value={accountId || ""}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer"
      >
        <option value="">— не выбран —</option>
        {filtered.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
    </label>
  );
}
