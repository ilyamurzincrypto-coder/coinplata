// src/components/deal-form/DealLegNested.jsx
//
// Вложенная карточка для multi-leg выдачи (или внесения) — рендерится
// под primary DealLeg для каждой дополнительной ноги.
//
//   • bg-surface-soft rounded-card-lg p-3.5
//   • Amount input 28px (компактнее чем 44px у primary)
//   • Inline rate input справа от ccy-pill (если показывать)
//   • Account-pill + balance hint
//   • ✕ кнопка удаления в правом верхнем углу
//
// Курс — inline input (для secondary leg каждый rate свой, primary
// использует общую чёрную капсулу выше).

import React from "react";
import { ChevronDown, X, Link as LinkIcon } from "lucide-react";
import CurrencyIcon from "../ui/CurrencyIcon.jsx";
import BalanceHint from "./BalanceHint.jsx";
import { useCurrencies } from "../../store/currencies.jsx";

export default function DealLegNested({
  legNumber,        // display, "Выдача №2" / "Внесение №2"
  direction,        // "in" | "out"
  fromCcy,          // base ccy для inline rate (curIn)
  amount,
  onAmountChange,
  rate,
  onRateChange,
  currency,
  currencyOptions,
  onCurrencyChange,
  accountId,
  accountOptions,
  onAccountChange,
  address,
  onAddressChange,
  onRemove,
}) {
  const { dict: currencyDict } = useCurrencies();
  const isCrypto = currencyDict[currency]?.type === "crypto";
  return (
    <div className="bg-surface-soft rounded-card-lg p-3.5 relative">
      {/* Header строка с номером и крестиком */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="text-tiny text-muted font-semibold uppercase tracking-wider">
          {legNumber}
        </div>
        <button
          type="button"
          onClick={onRemove}
          title="Удалить эту ногу"
          className="w-6 h-6 rounded-full flex items-center justify-center text-muted hover:text-danger hover:bg-danger-soft transition-colors"
        >
          <X className="w-3 h-3" strokeWidth={2.2} />
        </button>
      </div>

      {/* Amount + ccy-pill + inline rate — компактные */}
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="0"
          className="flex-1 min-w-0 text-[24px] leading-none tracking-[-0.02em] font-mono tabular font-bold text-ink placeholder:text-muted-soft bg-transparent outline-none border-0"
        />
        <CcyPillCompact
          ccy={currency}
          options={currencyOptions}
          onChange={onCurrencyChange}
        />
      </div>

      {/* Rate row: «× rate» inline */}
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-tiny text-muted font-semibold">
          {fromCcy} ×
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={rate}
          onChange={(e) => onRateChange(e.target.value)}
          placeholder="0.0000"
          className="flex-1 min-w-0 h-7 px-2 rounded-input bg-surface text-ink font-mono tabular text-body-sm font-bold placeholder:text-muted-soft border-0 ring-1 ring-inset ring-transparent focus:ring-accent focus:shadow-input-focus focus:outline-none transition-all"
        />
      </div>

      {/* Account + balance hint */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <AccountPillCompact
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

      {/* Crypto address — только для crypto OUT */}
      {isCrypto && direction === "out" && onAddressChange && (
        <div className="mt-2.5 flex items-center gap-2 h-9 px-2.5 rounded-input bg-surface ring-1 ring-inset ring-border focus-within:ring-accent focus-within:shadow-input-focus transition-all">
          <LinkIcon className="w-3 h-3 text-muted shrink-0" strokeWidth={2.2} />
          <input
            type="text"
            value={address || ""}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder="Адрес кошелька клиента"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent text-caption font-mono text-ink placeholder:text-muted-soft outline-none border-0"
          />
        </div>
      )}
    </div>
  );
}

// Compact версии pill'ов — поменьше padding'ов чем у primary.
function CcyPillCompact({ ccy, options, onChange }) {
  return (
    <label className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-pill bg-surface hover:bg-surface-sunk cursor-pointer transition-colors shrink-0 relative">
      <CurrencyIcon ccy={ccy} size="sm" />
      <span className="font-mono font-bold text-body-sm text-ink">{ccy}</span>
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

function AccountPillCompact({ accountId, options, currency, onChange }) {
  const filtered = options.filter((a) => a.currency === currency && a.active !== false);
  const selected = filtered.find((a) => a.id === accountId);
  return (
    <label className="inline-flex items-center gap-1.5 h-7 px-2 rounded-pill bg-surface hover:bg-surface-sunk cursor-pointer transition-colors relative">
      <CurrencyIcon ccy={currency} size="sm" />
      <span className="text-caption font-semibold text-ink">
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
